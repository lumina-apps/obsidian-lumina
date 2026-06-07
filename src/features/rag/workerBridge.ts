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

// 모바일 호환성을 위해 정적 import 제거 후 동적 할당
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fs: any;
if (Platform.isDesktop) {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	fs = require('fs');
}

export type EmbeddingProgressCallback = (progress: number, status: string) => void;

/** 임베딩 모델 초기화 최대 대기 시간 (ms) */
const INIT_TIMEOUT_MS = 60_000;

export class EmbeddingWorkerBridge {
	private worker: Worker | null = null;
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
	private initTimeoutId: ReturnType<typeof setTimeout> | null = null;

	// 요청 큐
	private embedQueue: Array<{ texts: string[], resolve: (res: number[][]) => void, reject: (err: Error) => void }> = [];
	private isProcessingQueue = false;

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	/**
	 * 워커를 생성하고 모델을 로드합니다.
	 * @param workerPath  플러그인 디렉토리 내 embedding.worker.js 의 절대 파일 경로
	 * @param modelName   사용할 HuggingFace 모델
	 * @param cacheDir    모델 캐시 저장 절대 경로
	 * @param onProgress  모델 로딩 진행률 콜백 (0 ~ 1)
	 */
	async init(
		workerPath: string,
		modelName: string,
		cacheDir: string,
		onProgress?: EmbeddingProgressCallback,
	): Promise<void> {
		if (this.worker) this.terminate();

		this.onProgress = onProgress ?? null;

		// Electron 환경에서 file:// 절대 경로로 Worker 생성 시 Origin 에러 발생.
		// app://local/... 도 Origin이 다르기 때문에 SecurityError 발생.
		// 해결: fs로 읽어 Blob URL로 만들되, ESM 내부에 있는 import.meta.url 이
		// blob: 환경에서 TypeError를 유발하는 것을 막기 위해 더미 URL로 치환합니다.
		let finalPath = workerPath.startsWith('file://') ? workerPath.slice(7) : workerPath;
		if (finalPath.match(/^\/[a-zA-Z]:\//)) finalPath = finalPath.slice(1);
		let workerCode = fs.readFileSync(finalPath, 'utf-8');
		// import.meta.url이 blob: URL로 실행되면 URL 생성자 등에서 에러가 발생하므로 치환
		workerCode = workerCode.replace(/import\.meta\.url/g, '"app://obsidian.md/"');
		
		// Electron 환경의 Worker에서 process 가 null 이거나 process.on 이 없어 ONNX Runtime 이 크래시하는 현상 방지
		workerCode = `
			if (typeof process === 'undefined' || process === null) {
				self.process = { env: {}, on: function() {}, argv: [] };
			} else if (!process.on) {
				process.on = function() {};
			}
		` + workerCode;

		const blob = new Blob([workerCode], { type: 'application/javascript' });
		this.workerUrl = URL.createObjectURL(blob);

		this.worker = new Worker(this.workerUrl);
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
		this.initTimeoutId = setTimeout(() => {
			this.initTimeoutId = null;
			this.readyReject?.(
				new Error(
					t('uiMessages.ragWorkerTimeout')
				),
			);
		}, INIT_TIMEOUT_MS);

		// 워커에 초기화 요청
		this.send({ type: 'init', cacheDir, modelName });

		return this.readyPromise;
	}

	/** 워커를 정리합니다. 플러그인 unload 시 반드시 호출. */
	terminate(): void {
		if (!this.worker) return;
		// 타임아웃 클리어
		if (this.initTimeoutId) {
			clearTimeout(this.initTimeoutId);
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
			this.processQueue();
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
					clearTimeout(this.initTimeoutId);
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
						clearTimeout(this.initTimeoutId);
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
