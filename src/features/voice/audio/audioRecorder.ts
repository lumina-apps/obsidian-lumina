/**
 * audioRecorder.ts
 *
 * 브라우저/Electron/모바일 WebView 표준 MediaRecorder 및 Web Audio API 기반
 * 실시간 마이크 녹음, 파형 레벨 측정, RMS 무음 감지(VAD) 독립 WAV 청크 생성을 담당합니다.
 */

import {
	calculateRms,
	encodePcmToWav,
	isSilentBuffer,
	resampleLinearMono,
	TARGET_SAMPLE_RATE,
} from './audioChunker';

/** 녹음 종료 결과 */
export interface RecordedAudioResult {
	/** 전체 녹음 원본 Blob */
	fullBlob: Blob;
	/** 선택된 MIME 타입 */
	mimeType: string;
	/** 추천 파일 확장자 */
	extension: string;
	/** 전체 녹음 길이 (초) */
	durationSec: number;
}

/** 실시간 녹음 이벤트 콜백 모음 */
export interface AudioRecorderCallbacks {
	/** 실시간 오디오 입력 레벨 (0.0 ~ 1.0) */
	onLevel?: (level: number) => void;
	/** 경과 시간 업데이트 (초) */
	onElapsed?: (elapsedSec: number) => void;
	/** 발화 구간 종료 시 방출되는 독립 WAV 청크 (준실시간 자막/커서 입력용) */
	onSpeechChunk?: (chunk: { wavBlob: Blob; offsetSec: number; durationSec: number }) => void;
	/** 복구 백업용 주기적 녹음 조각 */
	onBackupTick?: (chunks: Blob[], mimeType: string, elapsedSec: number) => void;
}

/** 무음 판정 지속 시간 (ms) — 말을 멈춘 뒤 해당 시간이 지나면 문장 청크를 전송 */
const VAD_SILENCE_HANGOVER_MS = 1200;
/** 최대 단일 실시간 청크 길이 (ms) — 쉼 없이 오래 말할 때도 20초마다 분할 전송 */
const VAD_MAX_CHUNK_MS = 20000;
/** 최소 유효 발화 길이 (초) */
const VAD_MIN_SPEECH_SEC = 0.4;
/** 순수 무음만 누적 시 버퍼를 비워 메모리를 절약하는 임계 시간 (초) */
const VAD_IDLE_DROP_SEC = 2.5;
/** 복구 백업 저장 주기 (ms) */
const BACKUP_TICK_INTERVAL_MS = 15000;
/** 실시간 PCM 수집용 AudioWorklet 프로세서 등록 이름 */
const PCM_WORKLET_PROCESSOR_NAME = 'lumina-pcm-capture';

/**
 * AudioWorklet 스레드에서 128샘플 렌더 퀀텀을 4096샘플 프레임으로 모아
 * 메인 스레드(VAD 청킹)로 zero-copy 전송하는 인라인 프로세서 코드
 */
const PCM_WORKLET_PROCESSOR_CODE = `
class LuminaPcmCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this._buffer = new Float32Array(4096);
		this._offset = 0;
		this._stopped = false;
		this.port.onmessage = (ev) => {
			if (ev.data === 'stop') {
				this._stopped = true;
			}
		};
	}
	process(inputs) {
		if (this._stopped) return false;
		const input = inputs[0] && inputs[0][0];
		if (!input) return true;
		let idx = 0;
		while (idx < input.length) {
			const space = this._buffer.length - this._offset;
			const count = Math.min(space, input.length - idx);
			this._buffer.set(input.subarray(idx, idx + count), this._offset);
			this._offset += count;
			idx += count;
			if (this._offset >= this._buffer.length) {
				const frame = this._buffer;
				this.port.postMessage(frame, [frame.buffer]);
				this._buffer = new Float32Array(4096);
				this._offset = 0;
			}
		}
		return true;
	}
}
registerProcessor('${PCM_WORKLET_PROCESSOR_NAME}', LuminaPcmCaptureProcessor);
`;

/**
 * 현재 플랫폼(데스크톱 Electron / iOS / Android)이 지원하는 최적 오디오 MIME을 반환합니다.
 */
export function selectSupportedMimeType(): string {
	if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
		return '';
	}
	const candidates = [
		'audio/webm;codecs=opus',
		'audio/webm',
		'audio/mp4',
		'audio/ogg;codecs=opus',
	];
	for (const mime of candidates) {
		try {
			if (MediaRecorder.isTypeSupported(mime)) {
				return mime;
			}
		} catch {
			// 일부 환경의 isTypeSupported 예외 무시
		}
	}
	return '';
}

/**
 * MIME 타입에 대응하는 파일 확장자를 반환합니다.
 */
export function extensionForMimeType(mimeType: string): string {
	const lower = mimeType.toLowerCase();
	if (lower.includes('mp4') || lower.includes('aac') || lower.includes('m4a')) return 'm4a';
	if (lower.includes('ogg')) return 'ogg';
	if (lower.includes('wav')) return 'wav';
	if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
	return 'webm';
}

/**
 * 실시간 마이크 녹음 + 파형/VAD 청킹 컨트롤러
 */
export class VoiceAudioRecorder {
	private callbacks: AudioRecorderCallbacks;
	private stream: MediaStream | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private sourceNode: MediaStreamAudioSourceNode | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private workletBlobUrl: string | null = null;
	private silentGainNode: GainNode | null = null;

	private recordedChunks: Blob[] = [];
	private mimeType = 'audio/webm';
	private isPaused = false;
	private isRecording = false;
	private activeStartedAtMs = 0;
	private accumulatedMs = 0;

	private levelRafId: number | null = null;
	private elapsedTimerId: number | null = null;
	private backupTimerId: number | null = null;

	// 실시간 VAD용 PCM 버퍼 상태
	private pcmBuffers: Float32Array[] = [];
	private pcmSampleCount = 0;
	private chunkStartOffsetSec = 0;
	private speechDetectedInChunk = false;
	private lastSpeechAtMs = 0;
	private chunkStartedAtMs = 0;

	constructor(callbacks: AudioRecorderCallbacks = {}) {
		this.callbacks = callbacks;
	}

	/**
	 * 마이크 권한을 요청하고 녹음 및 실시간 파형·VAD 분석을 시작합니다.
	 */
	async start(): Promise<void> {
		if (this.isRecording) return;

		if (
			typeof navigator === 'undefined' ||
			!navigator.mediaDevices ||
			typeof navigator.mediaDevices.getUserMedia !== 'function'
		) {
			throw new Error('Microphone capture API is not available.');
		}

		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.recordedChunks = [];
		this.pcmBuffers = [];
		this.pcmSampleCount = 0;
		this.accumulatedMs = 0;
		this.isPaused = false;
		this.isRecording = true;

		const preferredMime = selectSupportedMimeType();
		this.mediaRecorder = preferredMime
			? new MediaRecorder(this.stream, { mimeType: preferredMime })
			: new MediaRecorder(this.stream);
		this.mimeType = this.mediaRecorder.mimeType || preferredMime || 'audio/webm';

		this.mediaRecorder.ondataavailable = (ev: BlobEvent) => {
			if (ev.data && ev.data.size > 0) {
				this.recordedChunks.push(ev.data);
			}
		};

		this.mediaRecorder.start(2000);
		this.activeStartedAtMs = Date.now();
		this.chunkStartedAtMs = this.activeStartedAtMs;
		this.lastSpeechAtMs = this.activeStartedAtMs;
		this.chunkStartOffsetSec = 0;
		this.speechDetectedInChunk = false;

		this.setupAudioAnalysis(this.stream);
		this.startTimers();
	}

	/**
	 * 녹음을 일시정지합니다.
	 */
	pause(): void {
		if (!this.isRecording || this.isPaused) return;
		this.accumulatedMs += Date.now() - this.activeStartedAtMs;
		this.isPaused = true;
		if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
			this.mediaRecorder.pause();
		}
		this.flushSpeechBufferIfReady(true);
		this.callbacks.onLevel?.(0);
	}

	/**
	 * 일시정지된 녹음을 재개합니다.
	 */
	resume(): void {
		if (!this.isRecording || !this.isPaused) return;
		this.isPaused = false;
		this.activeStartedAtMs = Date.now();
		this.chunkStartedAtMs = this.activeStartedAtMs;
		this.lastSpeechAtMs = this.activeStartedAtMs;
		if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
			this.mediaRecorder.resume();
		}
	}

	/**
	 * 녹음을 정상 종료하고 전체 오디오 Blob을 반환합니다.
	 */
	async stop(): Promise<RecordedAudioResult> {
		if (!this.isRecording) {
			return {
				fullBlob: new Blob([], { type: this.mimeType }),
				mimeType: this.mimeType,
				extension: extensionForMimeType(this.mimeType),
				durationSec: 0,
			};
		}

		const totalMs = this.getCurrentElapsedMs();
		this.flushSpeechBufferIfReady(true);

		await this.stopMediaRecorder();
		const fullBlob = new Blob(this.recordedChunks, { type: this.mimeType });
		const mime = this.mimeType;

		this.cleanupResources();

		return {
			fullBlob,
			mimeType: mime,
			extension: extensionForMimeType(mime),
			durationSec: Math.max(0, totalMs / 1000),
		};
	}

	/**
	 * 녹음을 취소하고 모든 스트림·컨텍스트·타이머를 즉시 해제합니다.
	 */
	cancel(): void {
		this.isRecording = false;
		this.isPaused = false;
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			try {
				this.mediaRecorder.stop();
			} catch {
				// 이미 정지된 MediaRecorder 무시
			}
		}
		this.recordedChunks = [];
		this.cleanupResources();
	}

	private getCurrentElapsedMs(): number {
		if (!this.isRecording) return 0;
		if (this.isPaused) return this.accumulatedMs;
		return this.accumulatedMs + (Date.now() - this.activeStartedAtMs);
	}

	private setupAudioAnalysis(stream: MediaStream): void {
		const AudioCtx =
			typeof AudioContext !== 'undefined'
				? AudioContext
				: typeof window !== 'undefined'
					? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
					: undefined;
		if (!AudioCtx) return;

		try {
			const ctx = new AudioCtx();
			this.audioContext = ctx;
			this.sourceNode = ctx.createMediaStreamSource(stream);
			this.analyser = ctx.createAnalyser();
			this.analyser.fftSize = 256;
			this.sourceNode.connect(this.analyser);

			// 실시간 VAD 청크용 PCM 수집 (AudioWorklet 지원 환경에서 비동기 연결)
			if (this.callbacks.onSpeechChunk) {
				void this.setupPcmWorklet(ctx, this.sourceNode);
			}
		} catch {
			// 오디오 분석기 초기화 실패 시에도 MediaRecorder 본녹음은 계속 유지
		}
	}

	/**
	 * deprecated된 ScriptProcessorNode 대신 AudioWorkletNode로 실시간 PCM 프레임을 수집합니다.
	 */
	private async setupPcmWorklet(
		ctx: AudioContext,
		sourceNode: MediaStreamAudioSourceNode,
	): Promise<void> {
		if (
			typeof AudioWorkletNode === 'undefined' ||
			!ctx.audioWorklet ||
			typeof ctx.audioWorklet.addModule !== 'function' ||
			typeof URL === 'undefined' ||
			typeof URL.createObjectURL !== 'function'
		) {
			return;
		}

		let workletUrl: string | null = null;
		try {
			const blob = new Blob([PCM_WORKLET_PROCESSOR_CODE], {
				type: 'application/javascript',
			});
			workletUrl = URL.createObjectURL(blob);
			this.workletBlobUrl = workletUrl;
			await ctx.audioWorklet.addModule(workletUrl);

			// 비동기 모듈 로드 중 녹음이 중단되었거나 컨텍스트가 교체된 경우 연결 생략
			if (!this.isRecording || this.audioContext !== ctx || this.sourceNode !== sourceNode) {
				return;
			}

			const workletNode = new AudioWorkletNode(ctx, PCM_WORKLET_PROCESSOR_NAME, {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				channelCount: 1,
			});
			const silentGain = ctx.createGain();
			silentGain.gain.value = 0;

			workletNode.port.onmessage = (ev: MessageEvent<unknown>) => {
				if (!this.isRecording || this.isPaused) return;
				if (ev.data instanceof Float32Array) {
					this.handlePcmFrame(ev.data, ctx.sampleRate);
				}
			};

			sourceNode.connect(workletNode);
			workletNode.connect(silentGain);
			silentGain.connect(ctx.destination);
			this.workletNode = workletNode;
			this.silentGainNode = silentGain;
		} catch {
			// AudioWorklet 미지원 또는 초기화 실패 시에도 MediaRecorder 본녹음은 계속 유지
		} finally {
			if (workletUrl && typeof URL.revokeObjectURL === 'function') {
				URL.revokeObjectURL(workletUrl);
			}
			if (this.workletBlobUrl === workletUrl) {
				this.workletBlobUrl = null;
			}
		}
	}

	private handlePcmFrame(frame: Float32Array, sampleRate: number): void {
		if (!this.callbacks.onSpeechChunk) return;

		const now = Date.now();
		const rms = calculateRms(frame);
		const isVoice = rms >= 0.012;

		if (isVoice) {
			if (!this.speechDetectedInChunk) {
				this.speechDetectedInChunk = true;
				this.chunkStartedAtMs = now;
				this.chunkStartOffsetSec = Math.max(0, this.getCurrentElapsedMs() / 1000 - frame.length / sampleRate);
			}
			this.lastSpeechAtMs = now;
		}

		this.pcmBuffers.push(frame);
		this.pcmSampleCount += frame.length;

		const bufferedSec = this.pcmSampleCount / sampleRate;

		// 발화가 감지되지 않은 상태로 무음만 길어지면 버퍼를 비워 메모리·유휴 처리 방지
		if (!this.speechDetectedInChunk) {
			if (bufferedSec >= VAD_IDLE_DROP_SEC) {
				this.pcmBuffers = [];
				this.pcmSampleCount = 0;
			}
			return;
		}

		const silenceDurationMs = now - this.lastSpeechAtMs;
		const speechChunkDurationMs = now - this.chunkStartedAtMs;
		if (silenceDurationMs >= VAD_SILENCE_HANGOVER_MS || speechChunkDurationMs >= VAD_MAX_CHUNK_MS) {
			this.flushSpeechBufferIfReady(false);
		}
	}

	private flushSpeechBufferIfReady(forceFlush: boolean): void {
		if (!this.callbacks.onSpeechChunk || this.pcmSampleCount === 0) {
			this.pcmBuffers = [];
			this.pcmSampleCount = 0;
			this.speechDetectedInChunk = false;
			return;
		}

		if (!this.speechDetectedInChunk && !forceFlush) {
			this.pcmBuffers = [];
			this.pcmSampleCount = 0;
			return;
		}

		const sampleRate = this.audioContext?.sampleRate || TARGET_SAMPLE_RATE;
		const merged = new Float32Array(this.pcmSampleCount);
		let offset = 0;
		for (const buf of this.pcmBuffers) {
			merged.set(buf, offset);
			offset += buf.length;
		}

		const durationSec = merged.length / sampleRate;
		const offsetSec = this.chunkStartOffsetSec;

		this.pcmBuffers = [];
		this.pcmSampleCount = 0;
		this.speechDetectedInChunk = false;
		this.chunkStartedAtMs = Date.now();

		if (durationSec < VAD_MIN_SPEECH_SEC || isSilentBuffer(merged)) {
			return;
		}

		const resampled = resampleLinearMono(merged, sampleRate, TARGET_SAMPLE_RATE);
		const wavBlob = encodePcmToWav(resampled, TARGET_SAMPLE_RATE);
		this.callbacks.onSpeechChunk({
			wavBlob,
			offsetSec,
			durationSec,
		});
	}

	private startTimers(): void {
		// 파형 레벨 애니메이션 루프
		const dataArray = this.analyser ? new Uint8Array(this.analyser.frequencyBinCount) : null;
		const updateLevel = () => {
			if (!this.isRecording) return;
			if (!this.isPaused && this.analyser && dataArray) {
				this.analyser.getByteTimeDomainData(dataArray);
				let sumSq = 0;
				for (let i = 0; i < dataArray.length; i++) {
					const norm = (dataArray[i] - 128) / 128;
					sumSq += norm * norm;
				}
				const rms = Math.sqrt(sumSq / dataArray.length);
				const normalized = Math.min(1, rms * 3.5);
				this.callbacks.onLevel?.(normalized);
			}
			if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
				this.levelRafId = window.requestAnimationFrame(updateLevel);
			}
		};
		if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
			this.levelRafId = window.requestAnimationFrame(updateLevel);
		}

		// 경과 시간 타이머 (1초 간격)
		this.elapsedTimerId = window.setInterval(() => {
			if (!this.isRecording || this.isPaused) return;
			this.callbacks.onElapsed?.(Math.floor(this.getCurrentElapsedMs() / 1000));
		}, 1000);

		// 복구 백업 타이머 (15초 간격)
		this.backupTimerId = window.setInterval(() => {
			if (!this.isRecording || this.isPaused || this.recordedChunks.length === 0) return;
			this.callbacks.onBackupTick?.(
				[...this.recordedChunks],
				this.mimeType,
				Math.floor(this.getCurrentElapsedMs() / 1000),
			);
		}, BACKUP_TICK_INTERVAL_MS);
	}

	private async stopMediaRecorder(): Promise<void> {
		const recorder = this.mediaRecorder;
		if (!recorder || recorder.state === 'inactive') return;

		await new Promise<void>((resolve) => {
			const timeout = window.setTimeout(() => resolve(), 1500);
			recorder.onstop = () => {
				window.clearTimeout(timeout);
				resolve();
			};
			try {
				recorder.stop();
			} catch {
				window.clearTimeout(timeout);
				resolve();
			}
		});
	}

	private cleanupResources(): void {
		this.isRecording = false;
		this.isPaused = false;

		if (
			this.levelRafId !== null &&
			typeof window !== 'undefined' &&
			typeof window.cancelAnimationFrame === 'function'
		) {
			window.cancelAnimationFrame(this.levelRafId);
			this.levelRafId = null;
		}
		if (this.elapsedTimerId !== null) {
			window.clearInterval(this.elapsedTimerId);
			this.elapsedTimerId = null;
		}
		if (this.backupTimerId !== null) {
			window.clearInterval(this.backupTimerId);
			this.backupTimerId = null;
		}

		if (
			this.workletBlobUrl &&
			typeof URL !== 'undefined' &&
			typeof URL.revokeObjectURL === 'function'
		) {
			URL.revokeObjectURL(this.workletBlobUrl);
			this.workletBlobUrl = null;
		}

		if (this.workletNode) {
			try {
				this.workletNode.port.postMessage('stop');
				this.workletNode.port.onmessage = null;
				this.workletNode.port.close();
			} catch {
				// 워크렛 포트 정리 오류 무시
			}
		}

		try {
			this.workletNode?.disconnect();
			this.silentGainNode?.disconnect();
			this.sourceNode?.disconnect();
			this.analyser?.disconnect();
		} catch {
			// 노드 연결 해제 오류 무시
		}
		this.workletNode = null;
		this.silentGainNode = null;
		this.sourceNode = null;
		this.analyser = null;

		if (this.audioContext) {
			void this.audioContext.close().catch(() => {
				// AudioContext 종료 오류 무시
			});
			this.audioContext = null;
		}

		if (this.stream) {
			for (const track of this.stream.getTracks()) {
				try {
					track.stop();
				} catch {
					// 트랙 정지 오류 무시
				}
			}
			this.stream = null;
		}

		this.mediaRecorder = null;
		this.pcmBuffers = [];
		this.pcmSampleCount = 0;
		this.speechDetectedInChunk = false;
	}
}
