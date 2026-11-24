/**
 * audioChunker.ts
 *
 * 오디오 버퍼 처리, 표준 PCM WAV 인코딩, 무음 감지(Whisper 환각 차단),
 * 그리고 대용량(25MB 제한 우회) 자동 청크 분할 유틸리티를 제공합니다.
 */

/** STT API 단일 요청 크기 상한(25MB)을 안전하게 우회하기 위한 기본 최대 청크 크기 (20MB) */
export const DEFAULT_MAX_API_AUDIO_BYTES = 20 * 1024 * 1024;
/** 대용량 분할 시 청크당 길이 (초) — 16kHz 모노 16-bit WAV 기준 약 9.6MB */
export const DEFAULT_CHUNK_DURATION_SEC = 300;
/** 로컬 Whisper 및 API 청킹 표준 샘플레이트 (16kHz) */
export const TARGET_SAMPLE_RATE = 16000;
/** 기본 무음 RMS 임계값 */
export const DEFAULT_SILENCE_RMS_THRESHOLD = 0.008;

/** 분할된 오디오 청크 정보 */
export interface AudioSplitChunk {
	/** 전송 가능한 독립 오디오 Blob */
	blob: Blob;
	/** 원본 오디오 기준 시작 오프셋 (초) */
	offsetSec: number;
	/** 해당 청크의 길이 (초) */
	durationSec: number;
	/** MIME 타입 */
	mimeType: string;
	/** 파일명 */
	filename: string;
}

/**
 * Float32 PCM 샘플 배열의 RMS(제곱평균제곱근) 에너지를 계산합니다.
 */
export function calculateRms(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sumSq = 0;
	for (let i = 0; i < samples.length; i++) {
		const s = samples[i];
		sumSq += s * s;
	}
	return Math.sqrt(sumSq / samples.length);
}

/**
 * 오디오 버퍼가 무음 구간인지 판별합니다.
 * 무음 청크를 전송할 때 발생하는 Whisper 환각 출력을 차단하기 위해 사용합니다.
 */
export function isSilentBuffer(
	samples: Float32Array,
	threshold: number = DEFAULT_SILENCE_RMS_THRESHOLD,
): boolean {
	return calculateRms(samples) < threshold;
}

/**
 * 다채널 AudioBuffer를 단일 모노(Float32Array) 채널로 믹스다운합니다.
 */
export function mixAudioBufferToMono(audioBuffer: AudioBuffer): Float32Array {
	const channels = audioBuffer.numberOfChannels;
	const length = audioBuffer.length;
	if (channels <= 0 || length === 0) {
		return new Float32Array(0);
	}
	if (channels === 1) {
		return new Float32Array(audioBuffer.getChannelData(0));
	}

	const mono = new Float32Array(length);
	for (let c = 0; c < channels; c++) {
		const chData = audioBuffer.getChannelData(c);
		for (let i = 0; i < length; i++) {
			mono[i] += chData[i];
		}
	}
	const inv = 1 / channels;
	for (let i = 0; i < length; i++) {
		mono[i] *= inv;
	}
	return mono;
}

/**
 * 선형 보간을 사용해 임의 샘플레이트의 모노 PCM을 목표 샘플레이트로 리샘플링합니다.
 */
export function resampleLinearMono(
	samples: Float32Array,
	sourceRate: number,
	targetRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
	if (samples.length === 0 || sourceRate <= 0 || targetRate <= 0) {
		return new Float32Array(0);
	}
	if (sourceRate === targetRate) {
		return samples;
	}

	const ratio = sourceRate / targetRate;
	const outputLength = Math.max(1, Math.round(samples.length / ratio));
	const output = new Float32Array(outputLength);

	for (let i = 0; i < outputLength; i++) {
		const srcPos = i * ratio;
		const idx0 = Math.floor(srcPos);
		const idx1 = Math.min(idx0 + 1, samples.length - 1);
		const frac = srcPos - idx0;
		output[i] = samples[idx0] * (1 - frac) + samples[idx1] * frac;
	}
	return output;
}

/**
 * AudioBuffer를 16kHz 모노 Float32Array로 변환합니다.
 * 브라우저의 OfflineAudioContext를 우선 사용하고, 미지원 환경에서는 선형 리샘플링으로 폴백합니다.
 */
export async function resampleToMono16k(audioBuffer: AudioBuffer): Promise<Float32Array> {
	const mono = mixAudioBufferToMono(audioBuffer);
	if (mono.length === 0) return mono;
	if (audioBuffer.sampleRate === TARGET_SAMPLE_RATE) {
		return mono;
	}

	const OfflineCtx =
		typeof OfflineAudioContext !== 'undefined'
			? OfflineAudioContext
			: typeof window !== 'undefined'
				? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
						.webkitOfflineAudioContext
				: undefined;

	if (OfflineCtx) {
		try {
			const targetLength = Math.max(1, Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE));
			const offlineCtx = new OfflineCtx(1, targetLength, TARGET_SAMPLE_RATE);
			const monoBuffer = offlineCtx.createBuffer(1, mono.length, audioBuffer.sampleRate);
			monoBuffer.copyToChannel(new Float32Array(mono), 0);

			const source = offlineCtx.createBufferSource();
			source.buffer = monoBuffer;
			source.connect(offlineCtx.destination);
			source.start(0);

			const rendered = await offlineCtx.startRendering();
			return new Float32Array(rendered.getChannelData(0));
		} catch {
			// OfflineAudioContext 실패 시 아래 선형 보간으로 안전 폴백
		}
	}

	return resampleLinearMono(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
}

/**
 * 모노 Float32 PCM 샘플을 표준 16-bit PCM WAV Blob으로 인코딩합니다.
 * MediaRecorder 조각 청크의 헤더 누락 문제를 피하기 위해 독립 디코딩 가능한 WAV 헤더를 부착합니다.
 */
export function encodePcmToWav(
	samples: Float32Array,
	sampleRate: number = TARGET_SAMPLE_RATE,
): Blob {
	const numChannels = 1;
	const bitsPerSample = 16;
	const bytesPerSample = bitsPerSample / 8;
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataByteLength = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataByteLength);
	const view = new DataView(buffer);

	// RIFF 청크 디스크립터
	writeAsciiString(view, 0, 'RIFF');
	view.setUint32(4, 36 + dataByteLength, true);
	writeAsciiString(view, 8, 'WAVE');

	// fmt 서브청크
	writeAsciiString(view, 12, 'fmt ');
	view.setUint32(16, 16, true); // PCM 서브청크 크기
	view.setUint16(20, 1, true); // 오디오 포맷: PCM (1)
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	// data 서브청크
	writeAsciiString(view, 36, 'data');
	view.setUint32(40, dataByteLength, true);

	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
		view.setInt16(offset, int16, true);
		offset += 2;
	}

	return new Blob([buffer], { type: 'audio/wav' });
}

function writeAsciiString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}

/**
 * 오디오 Blob(또는 파일)을 디코딩해 16kHz 모노 PCM 샘플과 길이(초)를 추출합니다.
 */
export async function decodeBlobToMono16k(
	blob: Blob,
): Promise<{ samples: Float32Array; sampleRate: number; durationSec: number }> {
	const AudioCtx =
		typeof AudioContext !== 'undefined'
			? AudioContext
			: typeof window !== 'undefined'
				? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
				: undefined;

	if (!AudioCtx) {
		throw new Error('AudioContext is not supported in this environment.');
	}

	const ctx = new AudioCtx();
	try {
		const arrayBuf = await blob.arrayBuffer();
		const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
		const samples = await resampleToMono16k(audioBuffer);
		return {
			samples,
			sampleRate: TARGET_SAMPLE_RATE,
			durationSec: audioBuffer.duration,
		};
	} finally {
		await ctx.close().catch(() => {
			// 이미 닫힌 AudioContext 무시
		});
	}
}

/**
 * 오디오 Blob이 API 제한(기본 20MB)을 초과할 경우 16kHz 모노 WAV 청크로 분할합니다.
 * 제한 이하의 파일은 재인코딩 없이 원본 그대로 단일 청크로 반환합니다.
 */
export async function splitAudioBlobForApi(
	blob: Blob,
	filename: string,
	maxBytes: number = DEFAULT_MAX_API_AUDIO_BYTES,
	chunkDurationSec: number = DEFAULT_CHUNK_DURATION_SEC,
): Promise<AudioSplitChunk[]> {
	if (blob.size <= maxBytes) {
		return [
			{
				blob,
				offsetSec: 0,
				durationSec: 0,
				mimeType: blob.type || 'audio/webm',
				filename,
			},
		];
	}

	const { samples, sampleRate, durationSec } = await decodeBlobToMono16k(blob);
	if (samples.length === 0) {
		return [];
	}

	const samplesPerChunk = Math.max(sampleRate, Math.floor(chunkDurationSec * sampleRate));
	const chunks: AudioSplitChunk[] = [];
	const baseName = filename.replace(/\.[^.]+$/, '') || 'audio';

	for (let start = 0, idx = 0; start < samples.length; start += samplesPerChunk, idx++) {
		const end = Math.min(start + samplesPerChunk, samples.length);
		const slice = samples.subarray(start, end);
		// 완전한 무음 조각은 API 전송을 건너뛰어 환각과 비용을 절감
		if (isSilentBuffer(slice)) {
			continue;
		}
		const wavBlob = encodePcmToWav(slice, sampleRate);
		const offsetSec = start / sampleRate;
		const chunkDur = slice.length / sampleRate;
		const paddedIdx = String(idx).padStart(3, '0');
		chunks.push({
			blob: wavBlob,
			offsetSec,
			durationSec: chunkDur > 0 ? chunkDur : durationSec,
			mimeType: 'audio/wav',
			filename: `${baseName}_part${paddedIdx}.wav`,
		});
	}

	return chunks;
}

/**
 * 오디오 Blob의 전체 재생 길이(초)를 비파괴적으로 측정합니다.
 * 무료 5분 제한 검사에 사용되며, 디코딩 불가 환경(테스트 jsdom 등)에서는 null을 반환합니다.
 */
export async function measureAudioBlobDurationSec(blob: Blob): Promise<number | null> {
	if (blob.size === 0) return 0;

	const AudioCtx =
		typeof AudioContext !== 'undefined'
			? AudioContext
			: typeof window !== 'undefined'
				? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
				: undefined;

	// AudioContext가 없는 환경(예: 단위 테스트용 jsdom)에서는 즉시 null을 반환해 대기 지연을 방지
	if (!AudioCtx) {
		return null;
	}

	const isJsdom =
		typeof navigator !== 'undefined' &&
		typeof navigator.userAgent === 'string' &&
		navigator.userAgent.toLowerCase().includes('jsdom');

	if (
		!isJsdom &&
		typeof document !== 'undefined' &&
		typeof URL !== 'undefined' &&
		typeof URL.createObjectURL === 'function'
	) {
		const metaDuration = await new Promise<number | null>((resolve) => {
			const audio = document.createElement('audio');
			const objectUrl = URL.createObjectURL(blob);
			let settled = false;

			const finish = (val: number | null) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timerId);
				audio.removeAttribute('src');
				audio.load();
				URL.revokeObjectURL(objectUrl);
				resolve(val);
			};

			const timerId = window.setTimeout(() => finish(null), 400);
			audio.preload = 'metadata';
			audio.onloadedmetadata = () => {
				finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
			};
			audio.onerror = () => finish(null);
			audio.src = objectUrl;
			audio.load();
		});

		if (metaDuration !== null) {
			return metaDuration;
		}
	}

	const ctx = new AudioCtx();
	try {
		const arrayBuf = await blob.arrayBuffer();
		const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
		return Number.isFinite(audioBuffer.duration) ? audioBuffer.duration : null;
	} catch {
		return null;
	} finally {
		await ctx.close().catch(() => {
			// 이미 닫힌 AudioContext 무시
		});
	}
}
