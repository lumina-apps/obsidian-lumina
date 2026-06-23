/**
 * 메인 스레드 ↔ embedding.worker.js 통신 브릿지.
 * 다중 Worker 풀 관리, Promise 기반 embed() API, 라운드로빈 분배, 캐시 공유를 담당합니다.
 */

import type { WorkerRequest } from '../../shared/types/rag.types';
import { generateUUID } from '../../shared/utils/uuid';
import { t } from '../../shared/locales/helpers';
import { WORKER_COMPRESSED_BASE64 } from './worker/workerCode';
import { decompressWorkerCode } from './utils/workerCodec';
import { EmbeddingCacheManager } from './utils/EmbeddingCacheManager';
import { WorkerPool, type EmbeddingProgressCallback, type WorkerInstance } from './utils/WorkerPool';

export class EmbeddingWorkerBridge {
	private workerPool = new WorkerPool();
	private cacheManager = new EmbeddingCacheManager();
	private isReady = false;
	private initPromiseResolve: (() => void) | null = null;
	private initPromiseReject: ((err: Error) => void) | null = null;

	private idleTimer: number | null = null;
	private initArgs: { modelName: string; cacheDir: string; pluginDir?: string; onProgress?: EmbeddingProgressCallback } | null = null;

	constructor() {}

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	/** Worker 풀 생성 및 모든 Worker에 모델 로드 */
	async init(
		modelName: string,
		cacheDir: string,
		pluginDir?: string,
		onProgress?: EmbeddingProgressCallback,
	): Promise<void> {
		this.initArgs = { modelName, cacheDir, pluginDir, onProgress };
		this.terminate();

		this.cacheManager.init(cacheDir, modelName);

		let workerCode: string;
		try {
			workerCode = await decompressWorkerCode(WORKER_COMPRESSED_BASE64);
		} catch (decompErr: unknown) {
			console.error('[EmbeddingWorker] decompression failed:', decompErr);
			throw new Error(
				`워커 코드 압축 해제 실패: ${decompErr instanceof Error ? decompErr.message : String(decompErr)}`,
			);
		}

		// Worker 수: 논리 코어 절반, 최소 1, 최대 4
		const hwConcurrency = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
			? navigator.hardwareConcurrency
			: 4;
		const workerCount = Math.max(1, Math.min(4, Math.floor(hwConcurrency / 2)));

		const blob = new Blob([workerCode], { type: 'application/javascript' });
		const workerCodeUrl = URL.createObjectURL(blob);

		try {
			await this.workerPool.init(
				workerCount,
				workerCodeUrl,
				{ cacheDir, modelName, pluginDir },
				onProgress,
			);
		} catch (e) {
			this.terminate();
			this.initPromiseReject?.(e instanceof Error ? e : new Error(String(e)));
			throw e;
		}

		this.isReady = true;
		this.resetIdleTimer();
		this.initPromiseResolve?.();
	}

	/** 모든 Worker 종료 */
	terminate(): void {
		if (this.idleTimer) {
			window.clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		this.workerPool.terminate();
		this.isReady = false;

		void this.cacheManager.persistCache().catch(() => {
			// 종료 중 캐시 저장 실패는 무시
		});
	}

	get ready(): boolean {
		return this.isReady && this.workerPool.ready;
	}

	/** 활성 Worker 수 */
	get activeWorkerCount(): number {
		return this.workerPool.activeWorkerCount;
	}

	private resetIdleTimer(): void {
		if (this.idleTimer) {
			window.clearTimeout(this.idleTimer);
		}
		// 5분(300,000ms) 미사용 시 워커 종료
		this.idleTimer = window.setTimeout(() => {
			console.log('[EmbeddingWorkerBridge] Idle timeout reached. Terminating workers to free memory.');
			this.terminate();
		}, 300000);
	}

	private async ensureReady(): Promise<void> {
		if (!this.ready && this.initArgs) {
			console.log('[EmbeddingWorkerBridge] Reviving workers from idle state...');
			await this.init(
				this.initArgs.modelName,
				this.initArgs.cacheDir,
				this.initArgs.pluginDir,
				this.initArgs.onProgress
			);
		}
	}

	// ─── Public API ───────────────────────────────────────────────────────────

	/** 텍스트 배열 → 임베딩 벡터 변환 (라운드로빈 병렬 처리) */
	async embed(texts: string[]): Promise<number[][]> {
		await this.ensureReady();
		if (!this.workerPool.ready || !this.isReady) {
			throw new Error(t('uiMessages.ragWorkerNotReady'));
		}
		if (texts.length === 0) return [];

		const results: Array<number[] | null> = new Array<number[] | null>(texts.length).fill(null);
		const toRequestTexts: string[] = [];
		const toRequestIndices: number[] = [];

		for (let i = 0; i < texts.length; i++) {
			const tstr = texts[i];
			const cached = this.cacheManager.get(tstr);
			if (cached !== undefined) {
				results[i] = cached;
			} else {
				toRequestTexts.push(tstr);
				toRequestIndices.push(i);
			}
		}

		if (toRequestTexts.length === 0) {
			return results as number[][];
		}

		const workerCount = this.workerPool.activeWorkerCount;

		if (toRequestTexts.length <= 8 || workerCount === 1) {
			const embeddings = await this.sendEmbedToWorker(
				this.workerPool.getNextWorker(),
				toRequestTexts,
			);
			for (let k = 0; k < toRequestIndices.length; k++) {
				results[toRequestIndices[k]] = embeddings[k];
				this.cacheManager.set(toRequestTexts[k], embeddings[k]);
			}
		} else {
			const chunkSize = Math.ceil(toRequestTexts.length / workerCount);
			const subTasks: Promise<{ offset: number; embeddings: number[][] }>[] = [];

			for (let w = 0; w < workerCount; w++) {
				const start = w * chunkSize;
				const end = Math.min(start + chunkSize, toRequestTexts.length);
				if (start >= end) break;

				const subTexts = toRequestTexts.slice(start, end);
				const worker = this.workerPool.getNextWorker();
				subTasks.push(
					this.sendEmbedToWorker(worker, subTexts).then((embs) => ({
						offset: start,
						embeddings: embs,
					})),
				);
			}

			const subResults = await Promise.all(subTasks);
			for (const { offset, embeddings } of subResults) {
				for (let k = 0; k < embeddings.length; k++) {
					const idx = toRequestIndices[offset + k];
					results[idx] = embeddings[k];
					this.cacheManager.set(toRequestTexts[offset + k], embeddings[k]);
				}
			}
		}

		this.cacheManager.trimCacheIfNecessary();

		this.resetIdleTimer();
		return results as number[][];
	}

	/** 특정 Worker에 embed 요청 전송 */
	private async sendEmbedToWorker(inst: WorkerInstance, texts: string[]): Promise<number[][]> {
		const requestId = generateUUID();
		return new Promise<number[][]>((resolve, reject) => {
			inst.embedRequests.add(requestId, resolve, reject);
			inst.worker.postMessage({ type: 'embed', requestId, texts } as WorkerRequest);
		});
	}

	/** 메모리 캐시 → 디스크 영속화 */
	public async persistCache(): Promise<void> {
		await this.cacheManager.persistCache();
	}

	/** ArrayBuffer 문서를 Worker에서 비동기 파싱합니다. */
	async parse(buffer: ArrayBuffer, ext: string): Promise<string> {
		await this.ensureReady();
		const inst = this.workerPool.getAnyReadyWorker();
		if (!inst || !this.isReady) {
			throw new Error(t('uiMessages.ragWorkerNotReady'));
		}
		const requestId = generateUUID();
		try {
			const result = await new Promise<string>((resolve, reject) => {
				inst.parseRequests.add(requestId, resolve, reject);
				inst.worker.postMessage({ type: 'parse', requestId, buffer, ext } as WorkerRequest, [buffer]);
			});
			return result;
		} finally {
			this.resetIdleTimer();
		}
	}
}