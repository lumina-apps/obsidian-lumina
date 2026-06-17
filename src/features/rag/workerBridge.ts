/**
 * workerBridge.ts
 *
 * 메인 스레드에서 embedding.worker.js 와 통신하는 브릿지.
 * - 다중 Worker 인스턴스 풀 관리 (CPU 코어 수만큼 병렬 처리)
 * - Promise 기반 embed() API 제공
 * - 라운드로빈 분배 + 캐시 공유
 * - init() 타임아웃: 60초 초과 시 자동 reject (무한 대기 방지)
 */

import type { WorkerRequest, WorkerResponse, IWorker } from '../../shared/types/rag.types';
import { generateUUID } from '../../shared/utils/uuid';
import { t } from '../../shared/locales/helpers';
import { WORKER_COMPRESSED_BASE64 } from './worker/workerCode';
import { decompressWorkerCode } from './utils/workerCodec';
import { PendingRequestManager } from './utils/PendingRequestManager';

export type EmbeddingProgressCallback = (progress: number, status: string) => void;

/** 임베딩 모델 초기화 최대 대기 시간 (ms) */
const INIT_TIMEOUT_MS = 120_000;

/**
 * Promise에 타임아웃을 적용합니다.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => {
			reject(new Error(message));
		}, timeoutMs);

		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				window.clearTimeout(timer);
				reject(err);
			},
		);
	});
}

/** 개별 Worker 인스턴스와 요청 관리 */
interface WorkerInstance {
	worker: IWorker;
	url: string;
	isReady: boolean;
	readyResolve?: () => void;
	readyReject?: (err: Error) => void;
	embedRequests: PendingRequestManager<number[][]>;
	parseRequests: PendingRequestManager<string>;
}

export class EmbeddingWorkerBridge {
	private workers: WorkerInstance[] = [];
	private workerCount = 0;
	private roundRobinIndex = 0;

	// 텍스트 → embedding 캐시 (메모리 기반, 모든 Worker가 공유)
	private embedCache = new Map<string, number[]>();
	private readonly MAX_CACHE_ENTRIES = 100_000;

	// LRU용 접근 기록
	private embedAccess = new Map<string, number>();
	private accessCounter = 1;

	// 디스크 캐시 파일 경로
	private cacheFilePath: string | null = null;

	// 저장 세마포어
	private saveInProgress = false;
	private pendingSave = false;
	private saveWaiters: Array<() => void> = [];

	private onProgress: EmbeddingProgressCallback | null = null;
	private isReady = false;
	private initPromiseResolve: (() => void) | null = null;
	private initPromiseReject: ((err: Error) => void) | null = null;

	constructor() {}

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	/**
	 * Worker 풀을 생성하고 모든 Worker에 모델을 로드합니다.
	 */
	async init(
		modelName: string,
		cacheDir: string,
		pluginDir?: string,
		onProgress?: EmbeddingProgressCallback,
	): Promise<void> {
		this.terminate();

		// 캐시 파일 경로
		try {
			const safeName = modelName.replace(/[^a-zA-Z0-9._-]/g, '_');
			this.cacheFilePath = `${cacheDir.replace(/\\/g, '/')}/embed_cache_${safeName}.json`;
			void this.loadEmbedCache().catch((e) => {
				console.warn('[EmbeddingWorker] embed cache load failed:', e);
			});
		} catch (e) {
			this.cacheFilePath = null;
		}

		this.onProgress = onProgress ?? null;

		// Worker 코드 압축 해제
		let workerCode: string;
		try {
			workerCode = await decompressWorkerCode(WORKER_COMPRESSED_BASE64);
		} catch (decompErr) {
			console.error('[EmbeddingWorker] decompression failed:', decompErr);
			throw new Error(
				`워커 코드 압축 해제 실패: ${decompErr instanceof Error ? decompErr.message : String(decompErr)}`,
			);
		}

		// Worker 개수: 논리 코어 -1 (메인 스레드 여유분), 최소 1, 최대 4
		// ONNX WASM은 각 Worker가 numThreads를 사용하므로 너무 많은 Worker는 역효과
		const hwConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency)
			? navigator.hardwareConcurrency : 4;
		this.workerCount = Math.max(1, Math.min(4, Math.floor(hwConcurrency / 2)));
		console.log(`[EmbeddingWorker] Creating ${this.workerCount} worker instances`);

		const blob = new Blob([workerCode], { type: 'application/javascript' });
		const WorkerCtor = window.Worker as unknown as new (url: string) => IWorker;

		const initPromises: Promise<void>[] = [];

		for (let i = 0; i < this.workerCount; i++) {
			const url = URL.createObjectURL(blob);
			const worker = new WorkerCtor(url);
			const instance: WorkerInstance = {
				worker,
				url,
				isReady: false,
				embedRequests: new PendingRequestManager<number[][]>(),
				parseRequests: new PendingRequestManager<string>(),
			};

			worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
				this.handleMessage(event, instance);
			});
			worker.addEventListener('error', (e) => {
				console.error(`[EmbeddingWorker] worker #${i} uncaught error:`, e);
				const msg = e instanceof ErrorEvent ? e.message : t('uiMessages.ragWorkerInitErr');
				this.initPromiseReject?.(new Error(`Worker 오류: ${msg}`));
			});

			this.workers.push(instance);

			const workerReady = new Promise<void>((resolve, reject) => {
				instance.readyResolve = resolve;
				instance.readyReject = reject;
			});

			// init 전송
			worker.postMessage({
				type: 'init',
				cacheDir,
				modelName,
				pluginDir,
			} as WorkerRequest);

			initPromises.push(
				withTimeout(workerReady, INIT_TIMEOUT_MS, `Worker #${i} 초기화 타임아웃`),
			);
		}

		// 모든 Worker가 ready 될 때까지 대기
		try {
			await Promise.all(initPromises);
		} catch (e) {
			this.terminate();
			throw e;
		}

		this.isReady = true;
		this.initPromiseResolve?.();
		console.log(`[EmbeddingWorker] All ${this.workerCount} workers ready`);
	}

	/** 모든 Worker 정리 */
	terminate(): void {
		for (const inst of this.workers) {
			try {
				inst.worker.postMessage({ type: 'terminate' });
				inst.worker.terminate();
				URL.revokeObjectURL(inst.url);
			} catch (e) {
				// 무시
			}
			inst.embedRequests.rejectAll(new Error(t('uiMessages.ragWorkerTerm')));
			inst.parseRequests.rejectAll(new Error(t('uiMessages.ragWorkerTerm')));
		}
		this.workers = [];
		this.workerCount = 0;
		this.isReady = false;

		void this.persistCache().catch(() => {});
	}

	get ready(): boolean {
		return this.isReady;
	}

	/** 활성 Worker 개수 */
	get activeWorkerCount(): number {
		return this.workers.filter(w => w.isReady).length;
	}

	// ─── Public API ───────────────────────────────────────────────────────────

	/**
	 * 텍스트 배열을 임베딩 벡터로 변환합니다.
	 * 라운드로빈으로 Worker에 분배하여 병렬 처리.
	 */
	async embed(texts: string[]): Promise<number[][]> {
		if (this.workers.length === 0 || !this.isReady) {
			throw new Error(t('uiMessages.ragWorkerNotReady'));
		}
		if (texts.length === 0) return [];

		// 1) 캐시된 항목 분리
		const results: Array<number[] | null> = new Array(texts.length).fill(null);
		const toRequestTexts: string[] = [];
		const toRequestIndices: number[] = [];

		for (let i = 0; i < texts.length; i++) {
			const tstr = texts[i];
			const cached = this.getCachedEmbedding(tstr);
			if (cached) {
				results[i] = cached;
			} else {
				toRequestTexts.push(tstr);
				toRequestIndices.push(i);
			}
		}

		if (toRequestTexts.length === 0) {
			return results as number[][];
		}

		// 2) 요청을 각 Worker에 분산
		// 작은 배치는 하나의 Worker로, 큰 배치는 Worker 간에 나눔
		if (toRequestTexts.length <= 8 || this.workerCount === 1) {
			// 작은 요청: 단일 Worker로 처리
			const embeddings = await this.sendEmbedToWorker(
				this.getNextWorker(),
				toRequestTexts,
			);
			for (let k = 0; k < toRequestIndices.length; k++) {
				results[toRequestIndices[k]] = embeddings[k];
				this.setCachedEmbedding(toRequestTexts[k], embeddings[k]);
			}
		} else {
			// 큰 요청: Worker 간에 균등 분할
			const chunkSize = Math.ceil(toRequestTexts.length / this.workerCount);
			const subTasks: Promise<{ offset: number; embeddings: number[][] }>[] = [];

			for (let w = 0; w < this.workerCount; w++) {
				const start = w * chunkSize;
				const end = Math.min(start + chunkSize, toRequestTexts.length);
				if (start >= end) break;

				const subTexts = toRequestTexts.slice(start, end);
				const worker = this.getNextWorker();
				subTasks.push(
					this.sendEmbedToWorker(worker, subTexts).then(embs => ({
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
					this.setCachedEmbedding(toRequestTexts[offset + k], embeddings[k]);
				}
			}
		}

		// 캐시 크기 제한 정리
		if (this.embedCache.size > this.MAX_CACHE_ENTRIES) {
			let toRemove = Math.floor(this.MAX_CACHE_ENTRIES / 2);
			const it = this.embedCache.keys();
			while (toRemove-- > 0) {
				const key = it.next().value;
				if (!key) break;
				this.embedCache.delete(key);
			}
		}

		return results as number[][];
	}

	/** 캐시에서 꺼내고 접근 순서 갱신 */
	private getCachedEmbedding(key: string): number[] | undefined {
		const v = this.embedCache.get(key);
		if (!v) return undefined;
		this.embedAccess.set(key, this.accessCounter++);
		return v;
	}

	private setCachedEmbedding(key: string, embedding: number[]): void {
		try {
			this.embedCache.set(key, embedding);
			this.embedAccess.set(key, this.accessCounter++);
		} catch {}
	}

	/** 라운드로빈으로 Worker 선택 */
	private getNextWorker(): WorkerInstance {
		const ready = this.workers.filter(w => w.isReady);
		if (ready.length === 0) {
			throw new Error('사용 가능한 Worker가 없습니다.');
		}
		const inst = ready[this.roundRobinIndex % ready.length];
		this.roundRobinIndex++;
		return inst;
	}

	/** 특정 Worker에 임베딩 요청 전송 */
	private async sendEmbedToWorker(inst: WorkerInstance, texts: string[]): Promise<number[][]> {
		const requestId = generateUUID();
		return new Promise<number[][]>((resolve, reject) => {
			inst.embedRequests.add(requestId, resolve, reject);
			inst.worker.postMessage({ type: 'embed', requestId, texts } as WorkerRequest);
		});
	}

	/** 디스크에서 캐시 로드 */
	private async loadEmbedCache(): Promise<void> {
		if (!this.cacheFilePath) return;
		let fs: any;
		try {
			fs = (window as any).require ? (window as any).require('fs') : require('fs');
		} catch (e) {
			return;
		}
		try {
			const data = await fs.promises.readFile(this.cacheFilePath, 'utf-8');
			const parsed = JSON.parse(data);
			if (!Array.isArray(parsed)) return;
			for (const entry of parsed) {
				if (!entry || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
				this.embedCache.set(entry[0], entry[1]);
				this.embedAccess.set(entry[0], typeof entry[2] === 'number' ? entry[2] : this.accessCounter++);
			}
			let max = 0;
			for (const v of this.embedAccess.values()) if (v > max) max = v;
			this.accessCounter = max + 1;
		} catch (e) {
			console.warn('[EmbeddingWorker] loadEmbedCache failed:', e);
		}
	}

	/** 디스크에 캐시 저장 */
	private async saveEmbedCache(): Promise<void> {
		if (!this.cacheFilePath) return;
		let fs: any;
		let pathMod: any;
		try {
			fs = (window as any).require ? (window as any).require('fs') : require('fs');
			pathMod = (window as any).require ? (window as any).require('path') : require('path');
		} catch (e) {
			return;
		}
		try {
			const entries = Array.from(this.embedCache.keys()).map(k => ({ k, access: this.embedAccess.get(k) || 0 }));
			entries.sort((a, b) => (b.access - a.access));
			const toSaveKeys = entries.slice(0, this.MAX_CACHE_ENTRIES).map(e => e.k);
			const out: any[] = [];
			for (const k of toSaveKeys) {
				out.push([k, this.embedCache.get(k), this.embedAccess.get(k) || 0]);
			}
			const dir = pathMod.dirname(this.cacheFilePath);
			await fs.promises.mkdir(dir, { recursive: true });
			await fs.promises.writeFile(this.cacheFilePath, JSON.stringify(out), 'utf-8');
		} catch (e) {
			console.warn('[EmbeddingWorker] saveEmbedCache failed:', e);
		}
	}

	/** 메모리 캐시를 디스크에 영속화 */
	public async persistCache(): Promise<void> {
		if (!this.cacheFilePath) return;
		if (this.saveInProgress) {
			this.pendingSave = true;
			return new Promise<void>((resolve) => {
				this.saveWaiters.push(resolve);
			});
		}

		this.saveInProgress = true;
		try {
			await this.saveEmbedCache();
			while (this.pendingSave) {
				this.pendingSave = false;
				await this.saveEmbedCache();
			}
		} finally {
			this.saveInProgress = false;
			const waiters = this.saveWaiters.splice(0);
			for (const w of waiters) {
				try { w(); } catch {}
			}
		}
	}

	/**
	 * ArrayBuffer 문서를 Worker에서 비동기 파싱합니다.
	 * parse 요청은 첫 번째 ready Worker로 전송.
	 */
	async parse(buffer: ArrayBuffer, ext: string): Promise<string> {
		const inst = this.workers.find(w => w.isReady);
		if (!inst || !this.isReady) {
			throw new Error(t('uiMessages.ragWorkerNotReady'));
		}
		const requestId = generateUUID();
		return new Promise<string>((resolve, reject) => {
			inst.parseRequests.add(requestId, resolve, reject);
			inst.worker.postMessage({ type: 'parse', requestId, buffer, ext } as WorkerRequest, [buffer]);
		});
	}

	// ─── Message Handler ──────────────────────────────────────────────────────

	private handleMessage(event: MessageEvent<WorkerResponse>, inst: WorkerInstance): void {
		const msg = event.data;

		switch (msg.type) {
			case 'ready':
				inst.isReady = true;
				inst.readyResolve?.();
				console.log(`[EmbeddingWorker] Worker ready (${this.workers.filter(w => w.isReady).length}/${this.workers.length})`);
				break;

			case 'progress':
				this.onProgress?.(msg.progress, msg.status);
				break;

			case 'result':
				inst.embedRequests.resolve(msg.requestId, msg.embeddings);
				break;

			case 'parseResult':
				inst.parseRequests.resolve(msg.requestId, msg.text);
				break;

			case 'error':
				this.handleError(msg.requestId, msg.message, inst);
				break;
		}
	}

	private handleError(requestId: string, message: string, inst: WorkerInstance): void {
		const err = new Error(message);

		if (requestId === 'init') {
			inst.readyReject?.(err);
		} else {
			const handledByEmbed = inst.embedRequests.reject(requestId, err);
			if (!handledByEmbed) {
				inst.parseRequests.reject(requestId, err);
			}
		}

		console.error('[EmbeddingWorker] error:', message);
	}
}