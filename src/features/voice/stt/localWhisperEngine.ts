/**
 * localWhisperEngine.ts
 *
 * 데스크톱 환경에서 외부 API 키나 비용 없이 완전히 무료/오프라인으로 동작하는
 * 온디바이스 Whisper STT 엔진입니다.
 * 기존 RAG 임베딩 워커와 메모리·스레드 충돌을 피하기 위해 독립 전용 Worker 인스턴스를 생성하고,
 * 일정 시간 유휴 상태가 지속되거나 destroy() 호출 시 즉시 종료합니다.
 */

import { App, Platform } from 'obsidian';
import { WORKER_COMPRESSED_BASE64 } from '../../../core/worker/workerCode';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import type { IWorker, WorkerResponse } from '../../../shared/types/rag.types';
import type { SttTranscriptionResult, TranscriptSegment } from '../../../shared/types/voice.types';
import { getVaultBasePath, joinSystemPath } from '../../../shared/utils/fileUtils';
import { generateUUID } from '../../../shared/utils/uuid';
import { decompressWorkerCode } from '../../../shared/utils/workerCodec';
import { decodeBlobToMono16k } from '../audio/audioChunker';
import type { ISttEngine, SttTranscribeOptions } from './sttTypes';

const IDLE_TERMINATE_MS = 3 * 60 * 1000;
const INIT_TIMEOUT_MS = 10 * 60 * 1000;

interface PendingWhisperJob {
	resolve: (res: { text: string; chunks: Array<{ timestamp: [number, number | null]; text: string }> }) => void;
	reject: (err: Error) => void;
}

/**
 * 독립 Web Worker 기반 무료 온디바이스 Whisper STT 엔진 (데스크톱 전용)
 */
export class LocalWhisperSttEngine implements ISttEngine {
	readonly id = 'stt-local-whisper';
	readonly label: string;

	private app: App;
	private modelName: string;
	private worker: IWorker | null = null;
	private workerUrl: string | null = null;
	private initPromise: Promise<void> | null = null;
	private isReady = false;
	private idleTimer: number | null = null;
	private pendingJobs = new Map<string, PendingWhisperJob>();
	private initResolve: (() => void) | null = null;
	private initReject: ((err: Error) => void) | null = null;
	private onInitProgress?: (pct: number, status: string) => void;

	constructor(app: App, modelName: string = 'Xenova/whisper-tiny') {
		this.app = app;
		this.modelName = modelName || 'Xenova/whisper-tiny';
		this.label = `Local Whisper (${this.modelName.split('/').pop() ?? this.modelName})`;
	}

	async transcribe(
		blob: Blob,
		_filename: string,
		options: SttTranscribeOptions = {},
	): Promise<SttTranscriptionResult> {
		if (Platform.isMobile) {
			throw new Error(t('voiceNote.notices.localWhisperMobileUnsupported'));
		}
		if (options.signal?.aborted) {
			const abortErr = new Error('Aborted');
			abortErr.name = 'AbortError';
			throw abortErr;
		}

		this.clearIdleTimer();
		this.onInitProgress = options.onProgress;

		await this.ensureWorkerReady(options.signal);

		const { samples, durationSec } = await decodeBlobToMono16k(blob);
		if (samples.length === 0) {
			this.resetIdleTimer();
			return { text: '', segments: [], engineLabel: this.label, durationSec: 0 };
		}

		const requestId = generateUUID();
		const offsetSec = options.offsetSec ?? 0;

		const rawResult = await new Promise<{
			text: string;
			chunks: Array<{ timestamp: [number, number | null]; text: string }>;
		}>((resolve, reject) => {
			if (!this.worker) {
				reject(new Error('Local Whisper worker is not active.'));
				return;
			}

			const abortHandler = () => {
				this.pendingJobs.delete(requestId);
				const err = new Error('Aborted');
				err.name = 'AbortError';
				reject(err);
			};

			if (options.signal) {
				if (options.signal.aborted) {
					abortHandler();
					return;
				}
				options.signal.addEventListener('abort', abortHandler, { once: true });
			}

			this.pendingJobs.set(requestId, {
				resolve: (res) => {
					options.signal?.removeEventListener('abort', abortHandler);
					resolve(res);
				},
				reject: (err) => {
					options.signal?.removeEventListener('abort', abortHandler);
					reject(err);
				},
			});

			// 메인 스레드에서 디코딩된 16kHz Float32Array를 zero-copy로 워커에 전달
			const transferable = samples.buffer;
			this.worker.postMessage(
				{
					type: 'whisper-transcribe',
					requestId,
					audioData: samples,
					language: options.language,
				},
				[transferable],
			);
		});

		this.resetIdleTimer();

		const segments: TranscriptSegment[] = [];
		for (const chunk of rawResult.chunks) {
			const chunkText = chunk.text.trim();
			if (!chunkText) continue;
			const start = Math.max(0, (chunk.timestamp?.[0] ?? 0) + offsetSec);
			const rawEnd = chunk.timestamp?.[1];
			const end = Math.max(start, (typeof rawEnd === 'number' ? rawEnd : start) + offsetSec);
			segments.push({ startSec: start, endSec: end, text: chunkText });
		}

		const fullText = rawResult.text.trim() || segments.map((s) => s.text).join(' ');
		if (segments.length === 0 && fullText) {
			segments.push({
				startSec: offsetSec,
				endSec: offsetSec + durationSec,
				text: fullText,
			});
		}

		return {
			text: fullText,
			segments,
			engineLabel: this.label,
			durationSec,
		};
	}

	/**
	 * 전용 Whisper Worker와 Blob URL, 진행 중인 요청을 즉시 해제합니다.
	 */
	destroy(): void {
		this.clearIdleTimer();
		const termErr = new Error('Local Whisper worker terminated.');
		for (const [, job] of this.pendingJobs) {
			job.reject(termErr);
		}
		this.pendingJobs.clear();
		this.initReject?.(termErr);
		this.initResolve = null;
		this.initReject = null;

		if (this.worker) {
			try {
				this.worker.postMessage({ type: 'terminate' });
				this.worker.terminate();
			} catch {
				// 이미 종료된 워커 무시
			}
			this.worker = null;
		}

		if (this.workerUrl) {
			URL.revokeObjectURL(this.workerUrl);
			this.workerUrl = null;
		}
		this.isReady = false;
		this.initPromise = null;
	}

	private async ensureWorkerReady(signal?: AbortSignal): Promise<void> {
		if (this.isReady && this.worker) return;
		if (this.initPromise) {
			await this.initPromise;
			return;
		}

		this.initPromise = this.spawnAndInitWorker(signal);
		try {
			await this.initPromise;
		} catch (err) {
			this.destroy();
			throw err;
		} finally {
			this.initPromise = null;
		}
	}

	private async spawnAndInitWorker(signal?: AbortSignal): Promise<void> {
		const workerCode = await decompressWorkerCode(WORKER_COMPRESSED_BASE64);
		if (signal?.aborted) {
			const abortErr = new Error('Aborted');
			abortErr.name = 'AbortError';
			throw abortErr;
		}

		const blob = new Blob([workerCode], { type: 'application/javascript' });
		this.workerUrl = URL.createObjectURL(blob);

		const WorkerCtor = window.Worker as unknown as new (url: string) => IWorker;
		const worker = new WorkerCtor(this.workerUrl);
		this.worker = worker;

		const readyPromise = new Promise<void>((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				reject(new Error('Local Whisper initialization timed out.'));
			}, INIT_TIMEOUT_MS);

			this.initResolve = () => {
				window.clearTimeout(timeout);
				resolve();
			};
			this.initReject = (err: Error) => {
				window.clearTimeout(timeout);
				reject(err);
			};

			if (signal) {
				const onAbort = () => {
					const err = new Error('Aborted');
					err.name = 'AbortError';
					this.initReject?.(err);
				};
				if (signal.aborted) {
					onAbort();
					return;
				}
				signal.addEventListener('abort', onAbort, { once: true });
			}
		});

		worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
			this.handleWorkerMessage(event.data);
		});

		worker.addEventListener('error', (ev: Event) => {
			const msg = ev instanceof ErrorEvent ? ev.message : 'Whisper worker error';
			debugLogger.logError('voice', new Error(msg));
			const err = new Error(msg);
			this.initReject?.(err);
			for (const [, job] of this.pendingJobs) {
				job.reject(err);
			}
			this.pendingJobs.clear();
		});

		const basePath = getVaultBasePath(this.app);
		const configDir = this.app.vault.configDir || '.obsidian';
		const cacheDir = joinSystemPath(basePath, configDir, 'plugins', 'lumina', 'storage', 'models');

		worker.postMessage({
			type: 'whisper-init',
			cacheDir,
			modelName: this.modelName,
		});

		await readyPromise;
		this.isReady = true;
	}

	private handleWorkerMessage(msg: WorkerResponse): void {
		switch (msg.type) {
			case 'progress':
				this.onInitProgress?.(msg.progress, msg.status);
				break;
			case 'whisper-ready':
				this.initResolve?.();
				this.initResolve = null;
				this.initReject = null;
				break;
			case 'whisper-result': {
				const job = this.pendingJobs.get(msg.requestId);
				if (job) {
					this.pendingJobs.delete(msg.requestId);
					job.resolve({ text: msg.text, chunks: msg.chunks });
				}
				break;
			}
			case 'error': {
				if (msg.requestId === 'whisper-init') {
					this.initReject?.(new Error(msg.message));
					this.initResolve = null;
					this.initReject = null;
					break;
				}
				const job = this.pendingJobs.get(msg.requestId);
				if (job) {
					this.pendingJobs.delete(msg.requestId);
					job.reject(new Error(msg.message));
				}
				break;
			}
		}
	}

	private clearIdleTimer(): void {
		if (this.idleTimer !== null) {
			window.clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	private resetIdleTimer(): void {
		this.clearIdleTimer();
		this.idleTimer = window.setTimeout(() => {
			debugLogger.logDebug('voice', 'Terminating idle local Whisper worker.');
			this.destroy();
		}, IDLE_TERMINATE_MS);
	}
}
