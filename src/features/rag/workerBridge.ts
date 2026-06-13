/**
 * workerBridge.ts
 *
 * 메인 스레드에서 embedding.worker.js 와 통신하는 브릿지.
 * - Worker 생성/종료 관리
 * - Promise 기반 embed() API 제공
 * - 진행률 콜백 지원 (모델 초기 로딩 시)
 * - init() 타임아웃: 60초 초과 시 자동 reject (무한 대기 방지)
 */

import { Platform } from 'obsidian';
import type { WorkerRequest, WorkerResponse } from '../../shared/types/rag.types';
import { t } from '../../shared/locales/helpers';


export type EmbeddingProgressCallback = (progress: number, status: string) => void;

/** 임베딩 모델 초기화 최대 대기 시간 (ms) */
const INIT_TIMEOUT_MS = 60_000;

interface IWorker {
	addEventListener(type: string, listener: (evt: MessageEvent) => void): void;
	terminate(): void;
	postMessage(message: unknown): void;
}

export class EmbeddingWorkerBridge {
	private worker: IWorker | null = null;
	private workerUrl: string | null = null;
	private pendingRequests = new Map<
		string,
		{ resolve: (embeddings: number[][]) => void; reject: (err: Error) => void }
	>();
	private onProgress: EmbeddingProgressCallback | null = null;
	private isReady = false;
	private readyPromise: Promise<void> | null = null;
	private readyResolve: (() => void) | null = null;
	private readyReject: ((err: Error) => void) | null = null;
	/** init() 타임아웃 타이머 ID */
	private initTimeoutId: number | null = null;

	// 요청 큐
	private embedQueue: Array<{ texts: string[], resolve: (res: number[][]) => void, reject: (err: Error) => void }> = [];
	private isProcessingQueue = false;

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	/**
	 * 워커를 생성하고 모델을 로드합니다.
	 * @param workerCode  실행할 워커의 소스 코드 문자열
	 * @param modelName   사용할 HuggingFace 모델
	 * @param cacheDir    모델 캐시 저장 절대 경로
	 * @param onProgress  모델 로딩 진행률 콜백 (0 ~ 1)
	 */
	async init(
		workerCode: string,
		modelName: string,
		cacheDir: string,
		pluginDir?: string,
		onProgress?: EmbeddingProgressCallback,
	): Promise<void> {
		if (this.worker) this.terminate();

		this.onProgress = onProgress ?? null;

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

		// 준비 완료를 기다리는 Promise 세팅
		this.readyPromise = new Promise<void>((resolve, reject) => {
			this.readyResolve = resolve;
			this.readyReject = reject;
		});

		// 타임아웃: 모델 로딩이 60초를 초과하면 자동 reject
		this.initTimeoutId = window.setTimeout(() => {
			this.initTimeoutId = null;
			this.readyReject?.(
				new Error(
					t('uiMessages.ragWorkerTimeout')
				),
			);
		}, INIT_TIMEOUT_MS) as unknown as number;

		// 워커에 초기화 요청
		this.send({ type: 'init', cacheDir, modelName, pluginDir });

		return this.readyPromise;
	}

	/** 워커를 정리합니다. 플러그인 unload 시 반드시 호출. */
	terminate(): void {
		if (!this.worker) return;
		// 타임아웃 클리어
		if (this.initTimeoutId) {
			window.clearTimeout(this.initTimeoutId);
			this.initTimeoutId = null;
		}
		this.send({ type: 'terminate' });
		this.worker.terminate();
		this.worker = null;

		if (this.workerUrl) {
			URL.revokeObjectURL(this.workerUrl);
			this.workerUrl = null;
		}

		this.isReady = false;
		this.pendingRequests.forEach(({ reject }) =>
			reject(new Error(t('uiMessages.ragWorkerTerm')))
		);
		this.pendingRequests.clear();
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

		return new Promise<number[][]>((resolve, reject) => {
			this.embedQueue.push({ texts, resolve, reject });
			void this.processQueue();
		});
	}

	private async processQueue() {
		if (this.isProcessingQueue || this.embedQueue.length === 0) return;
		this.isProcessingQueue = true;

		try {
			while (this.embedQueue.length > 0) {
				const { texts, resolve, reject } = this.embedQueue.shift()!;
				const requestId = crypto.randomUUID();

				await new Promise<number[][]>((res, rej) => {
					this.pendingRequests.set(requestId, { resolve: res, reject: rej });
					this.send({ type: 'embed', requestId, texts });
				}).then(resolve).catch(reject);
			}
		} finally {
			this.isProcessingQueue = false;
		}
	}

	// ─── Internals ────────────────────────────────────────────────────────────

	private send(msg: WorkerRequest): void {
		this.worker?.postMessage(msg);
	}

	private handleMessage(event: MessageEvent<WorkerResponse>): void {
		const msg = event.data;

		switch (msg.type) {
			case 'ready':
				// 타임아웃 클리어
				if (this.initTimeoutId) {
					window.clearTimeout(this.initTimeoutId);
					this.initTimeoutId = null;
				}
				this.isReady = true;
				this.readyResolve?.();
				break;

			case 'progress':
				this.onProgress?.(msg.progress, msg.status);
				break;

			case 'result': {
				const pending = this.pendingRequests.get(msg.requestId);
				if (pending) {
					pending.resolve(msg.embeddings);
					this.pendingRequests.delete(msg.requestId);
				}
				break;
			}

			case 'error': {
				const err = new Error(msg.message);
				if (msg.requestId === 'init') {
					// init 실패 시 타임아웃 클리어
					if (this.initTimeoutId) {
						window.clearTimeout(this.initTimeoutId);
						this.initTimeoutId = null;
					}
					this.readyReject?.(err);
				} else {
					const pending = this.pendingRequests.get(msg.requestId);
					if (pending) {
						pending.reject(err);
						this.pendingRequests.delete(msg.requestId);
					}
				}
				console.error('[EmbeddingWorker] error:', msg.message);
				break;
			}
		}
	}
}
