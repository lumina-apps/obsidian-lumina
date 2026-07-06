import type { IWorker, WorkerResponse } from '../../../shared/types/rag.types';
import { PendingRequestManager } from './PendingRequestManager';
import { withTimeout } from '../../../shared/utils/asyncUtils';
import { t } from '../../../shared/locales/helpers';
import { debugLogger } from '../../../shared/debugLogger';

export interface WorkerInstance {
	worker: IWorker;
	url: string;
	isReady: boolean;
	readyResolve?: () => void;
	readyReject?: (err: Error) => void;
	embedRequests: PendingRequestManager<number[][]>;
	parseRequests: PendingRequestManager<string>;
}

export type EmbeddingProgressCallback = (progress: number, status: string) => void;

const INIT_TIMEOUT_MS = 600_000;

export class WorkerPool {
	private workers: WorkerInstance[] = [];
	private workerCount = 0;
	private roundRobinIndex = 0;
	private isReady = false;

	public async init(
		workerCount: number,
		workerCodeUrl: string,
		initParams: { cacheDir: string; modelName: string; pluginDir?: string },
		onProgress?: EmbeddingProgressCallback,
	): Promise<void> {
		this.terminate();
		this.workerCount = workerCount;

		const WorkerCtor = window.Worker as unknown as new (url: string) => IWorker;

		try {
			for (let i = 0; i < this.workerCount; i++) {
				const worker = new WorkerCtor(workerCodeUrl);
				const instance: WorkerInstance = {
					worker,
					url: workerCodeUrl, // reusing same URL
					isReady: false,
					embedRequests: new PendingRequestManager<number[][]>(),
					parseRequests: new PendingRequestManager<string>(),
				};

				worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
					this.handleMessage(event, instance, onProgress);
				});
				worker.addEventListener('error', (e: Event) => {
					const msg = e instanceof ErrorEvent ? e.message : t('uiMessages.ragWorkerInitErr');
					debugLogger.logError('rag', new Error(`[EmbeddingWorker] worker #${i} uncaught error: ${msg}`));
					instance.readyReject?.(new Error(`Worker 오류: ${msg}`));
				});

				this.workers.push(instance);

				const workerReady = new Promise<void>((resolve, reject) => {
					instance.readyResolve = resolve;
					instance.readyReject = reject;
				});

				worker.postMessage({
					type: 'init',
					cacheDir: initParams.cacheDir,
					modelName: initParams.modelName,
					pluginDir: initParams.pluginDir,
				});

				await withTimeout(workerReady, INIT_TIMEOUT_MS, `Worker #${i} 초기화 타임아웃`);
			}
		} catch (e) {
			this.terminate();
			throw e;
		}

		this.isReady = true;
	}

	public terminate(): void {
		for (const inst of this.workers) {
			try {
				inst.worker.postMessage({ type: 'terminate' });
				inst.worker.terminate();
			} catch {
				// Worker가 이미 종료된 경우 무시
			}
			inst.embedRequests.rejectAll(new Error(t('uiMessages.ragWorkerTerm')));
			inst.parseRequests.rejectAll(new Error(t('uiMessages.ragWorkerTerm')));
		}
		this.workers = [];
		this.workerCount = 0;
		this.isReady = false;
	}

	public get ready(): boolean {
		return this.isReady;
	}

	public get activeWorkerCount(): number {
		return this.workers.filter((w) => w.isReady).length;
	}

	public getNextWorker(): WorkerInstance {
		const ready = this.workers.filter((w) => w.isReady);
		if (ready.length === 0) {
			throw new Error('사용 가능한 Worker가 없습니다.');
		}
		const inst = ready[this.roundRobinIndex % ready.length];
		this.roundRobinIndex++;
		return inst;
	}

	public getAnyReadyWorker(): WorkerInstance | undefined {
		return this.workers.find((w) => w.isReady);
	}

	private handleMessage(
		event: MessageEvent<WorkerResponse>,
		inst: WorkerInstance,
		onProgress?: EmbeddingProgressCallback,
	): void {
		const msg = event.data;

		switch (msg.type) {
			case 'ready':
				inst.isReady = true;
				inst.readyResolve?.();
				break;

			case 'progress':
				onProgress?.(msg.progress, msg.status);
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

		debugLogger.logError('rag', new Error(`[EmbeddingWorker] error: ${message}`));
	}
}
