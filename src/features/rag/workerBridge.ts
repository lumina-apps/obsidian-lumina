/**
 * workerBridge.ts
 *
 * 메인 스레드에서 embedding.worker.js 와 통신하는 브릿지.
 * - Worker 생성/종료 관리
 * - Promise 기반 embed() API 제공
 * - 진행률 콜백 지원 (모델 초기 로딩 시)
 * - init() 타임아웃: 60초 초과 시 자동 reject (무한 대기 방지)
 */

import type { WorkerRequest, WorkerResponse, IWorker } from '../../shared/types/rag.types';
import { generateUUID } from '../../shared/utils/uuid';
import { t } from '../../shared/locales/helpers';
import { WORKER_COMPRESSED_BASE64 } from './worker/workerCode';
import { decompressWorkerCode } from './utils/workerCodec';
import { PendingRequestManager } from './utils/PendingRequestManager';
import { SerialQueue } from './utils/SerialQueue';

export type EmbeddingProgressCallback = (progress: number, status: string) => void;

/** 임베딩 모델 초기화 최대 대기 시간 (ms) */
const INIT_TIMEOUT_MS = 60_000;

/**
 * Promise에 타임아웃을 적용합니다.
 * timeoutMs를 초과하면 message로 reject합니다.
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

export class EmbeddingWorkerBridge {
	private worker: IWorker | null = null;
	private workerUrl: string | null = null;

	private embedRequests = new PendingRequestManager<number[][]>();
	private parseRequests = new PendingRequestManager<string>();
	private embedQueue: SerialQueue<string[], number[][]>;

	private onProgress: EmbeddingProgressCallback | null = null;
	private isReady = false;
	private readyResolve: (() => void) | null = null;
	private readyReject: ((err: Error) => void) | null = null;

	constructor() {
		this.embedQueue = new SerialQueue<string[], number[][]>(async (texts) => {
			const requestId = generateUUID();
			return new Promise<number[][]>((resolve, reject) => {
				this.embedRequests.add(requestId, resolve, reject);
				this.send({ type: 'embed', requestId, texts });
			});
		});
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	/**
	 * 워커를 생성하고 모델을 로드합니다.
	 * @param modelName   사용할 HuggingFace 모델
	 * @param cacheDir    모델 캐시 저장 절대 경로
	 * @param pluginDir   플러그인 로컬 디렉토리 URL (옵션)
	 * @param onProgress  모델 로딩 진행률 콜백 (0 ~ 1)
	 */
	async init(
		modelName: string,
		cacheDir: string,
		pluginDir?: string,
		onProgress?: EmbeddingProgressCallback,
	): Promise<void> {
		if (this.worker) this.terminate();

		this.onProgress = onProgress ?? null;

		let workerCode: string;
		try {
			workerCode = await decompressWorkerCode(WORKER_COMPRESSED_BASE64);
		} catch (decompErr) {
			console.error('[EmbeddingWorker] decompression failed:', decompErr);
			throw new Error(
				`워커 코드 압축 해제 실패: ${decompErr instanceof Error ? decompErr.message : String(decompErr)}`,
			);
		}

		// Electron 환경에서 file:// 절대 경로로 Worker 생성 시 Origin 에러 발생.
		// app://local/... 도 Origin이 다르기 때문에 SecurityError 발생.
		// 해결: 코드를 Blob URL로 만들어 Worker 생성.
		// process 폴리필과 import.meta.url 치환은 빌드타임에 esbuild에서 처리됩니다.
		const blob = new Blob([workerCode], { type: 'application/javascript' });
		this.workerUrl = URL.createObjectURL(blob);

		const WorkerCtor = window.Worker as unknown as new (url: string) => IWorker;
		this.worker = new WorkerCtor(this.workerUrl);
		this.worker.addEventListener('message', this.handleMessage.bind(this));
		this.worker.addEventListener('error', (e) => {
			console.error('[EmbeddingWorker] uncaught error:', e);
			const msg = e instanceof ErrorEvent ? e.message : t('uiMessages.ragWorkerInitErr');
			this.readyReject?.(new Error(`Worker 오류: ${msg}`));
		});

		const readyPromise = new Promise<void>((resolve, reject) => {
			this.readyResolve = resolve;
			this.readyReject = reject;
		});

		// 워커에 초기화 요청
		this.send({ type: 'init', cacheDir, modelName, pluginDir });

		return withTimeout(readyPromise, INIT_TIMEOUT_MS, t('uiMessages.ragWorkerTimeout'));
	}

	/** 워커를 정리합니다. 플러그인 unload 시 반드시 호출. */
	terminate(): void {
		if (!this.worker) return;

		this.send({ type: 'terminate' });
		this.worker.terminate();
		this.worker = null;

		if (this.workerUrl) {
			URL.revokeObjectURL(this.workerUrl);
			this.workerUrl = null;
		}

		this.isReady = false;

		const termErr = new Error(t('uiMessages.ragWorkerTerm'));
		this.embedRequests.rejectAll(termErr);
		this.parseRequests.rejectAll(termErr);
	}

	get ready(): boolean {
		return this.isReady;
	}

	// ─── Public API ───────────────────────────────────────────────────────────

	/**
	 * 텍스트 배열을 임베딩 벡터로 변환합니다.
	 * @returns number[][] — texts 순서와 동일한 벡터 배열
	 */
	async embed(texts: string[]): Promise<number[][]> {
		if (!this.worker || !this.isReady) {
			throw new Error(t('uiMessages.ragWorkerNotReady'));
		}
		if (texts.length === 0) return [];
		return this.embedQueue.enqueue(texts);
	}

	/**
	 * ArrayBuffer 문서를 워커 스레드에서 비동기 파싱합니다.
	 */
	async parse(buffer: ArrayBuffer, ext: string): Promise<string> {
		if (!this.worker || !this.isReady) {
			throw new Error(t('uiMessages.ragWorkerNotReady'));
		}
		const requestId = generateUUID();
		return new Promise<string>((resolve, reject) => {
			this.parseRequests.add(requestId, resolve, reject);
			this.worker!.postMessage({ type: 'parse', requestId, buffer, ext }, [buffer]);
		});
	}

	// ─── Internals ────────────────────────────────────────────────────────────

	private send(msg: WorkerRequest): void {
		this.worker?.postMessage(msg);
	}

	private handleMessage(event: MessageEvent<WorkerResponse>): void {
		const msg = event.data;

		switch (msg.type) {
			case 'ready':
				this.handleReady();
				break;

			case 'progress':
				this.onProgress?.(msg.progress, msg.status);
				break;

			case 'result':
				this.embedRequests.resolve(msg.requestId, msg.embeddings);
				break;

			case 'parseResult':
				this.parseRequests.resolve(msg.requestId, msg.text);
				break;

			case 'error':
				this.handleError(msg.requestId, msg.message);
				break;
		}
	}

	private handleReady(): void {
		this.isReady = true;
		this.readyResolve?.();
	}

	private handleError(requestId: string, message: string): void {
		const err = new Error(message);

		if (requestId === 'init') {
			this.readyReject?.(err);
		} else {
			const handledByEmbed = this.embedRequests.reject(requestId, err);
			if (!handledByEmbed) {
				this.parseRequests.reject(requestId, err);
			}
		}

		console.error('[EmbeddingWorker] error:', message);
	}
}