import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	calculateRms,
	decodeBlobToMono16k,
	encodePcmToWav,
	isSilentBuffer,
	measureAudioBlobDurationSec,
	resampleLinearMono,
	splitAudioBlobForApi,
} from '../audio/audioChunker';

describe('audioChunker', () => {
	const origAudioContext = globalThis.AudioContext;
	const origOfflineAudioContext = globalThis.OfflineAudioContext;
	const origCreateObjectURL = URL.createObjectURL;
	const origRevokeObjectURL = URL.revokeObjectURL;

	afterEach(() => {
		vi.useRealTimers();
		globalThis.AudioContext = origAudioContext;
		globalThis.OfflineAudioContext = origOfflineAudioContext;
		URL.createObjectURL = origCreateObjectURL;
		URL.revokeObjectURL = origRevokeObjectURL;
		vi.restoreAllMocks();
	});

	it('encodePcmToWav는 표준 RIFF/WAVE PCM 16-bit 헤더와 정확한 바이트 길이를 생성한다', async () => {
		const samples = new Float32Array([0, 0.5, -0.5, 1.0, -1.0]);
		const blob = encodePcmToWav(samples, 16000);

		expect(blob.type).toBe('audio/wav');
		expect(blob.size).toBe(44 + samples.length * 2);

		const buf = await blob.arrayBuffer();
		const view = new DataView(buf);
		const riff = String.fromCharCode(
			view.getUint8(0),
			view.getUint8(1),
			view.getUint8(2),
			view.getUint8(3),
		);
		const wave = String.fromCharCode(
			view.getUint8(8),
			view.getUint8(9),
			view.getUint8(10),
			view.getUint8(11),
		);
		expect(riff).toBe('RIFF');
		expect(wave).toBe('WAVE');
		expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
		expect(view.getUint16(22, true)).toBe(1); // 모노
		expect(view.getUint32(24, true)).toBe(16000); // 샘플레이트
		expect(view.getUint16(34, true)).toBe(16); // 비트 심도
	});

	it('calculateRms와 isSilentBuffer는 무음 버퍼를 정확히 걸러낸다', () => {
		const silent = new Float32Array(1600);
		expect(calculateRms(silent)).toBe(0);
		expect(isSilentBuffer(silent)).toBe(true);

		const speech = new Float32Array(1600).fill(0.15);
		expect(calculateRms(speech)).toBeCloseTo(0.15, 4);
		expect(isSilentBuffer(speech)).toBe(false);
	});

	it('resampleLinearMono는 48kHz 입력을 16kHz 길이로 정확히 다운샘플링한다', () => {
		const source = new Float32Array(4800).fill(0.25);
		const down = resampleLinearMono(source, 48000, 16000);
		expect(down.length).toBe(1600);
		expect(down[0]).toBeCloseTo(0.25, 4);
	});

	it('splitAudioBlobForApi는 최대 크기 이하 파일은 재인코딩 없이 1개 청크로 반환한다', async () => {
		const small = new Blob([new Uint8Array(1024)], { type: 'audio/mp4' });
		const chunks = await splitAudioBlobForApi(small, 'voice.m4a', 2048);

		expect(chunks).toHaveLength(1);
		expect(chunks[0].offsetSec).toBe(0);
		expect(chunks[0].filename).toBe('voice.m4a');
		expect(chunks[0].blob.size).toBe(1024);
	});

	it('splitAudioBlobForApi는 크기 초과 오디오를 디코딩 후 무음 제외 청크와 정확한 오프셋으로 분할한다', async () => {
		// 16kHz 4초 오디오 (앞 2초 유성, 뒤 2초 유성) -> 2초씩 분할 시 offsetSec 0, 2 확인
		const totalSamples = 16000 * 4;
		const channelData = new Float32Array(totalSamples).fill(0.2);

		const mockAudioBuffer = {
			numberOfChannels: 1,
			length: totalSamples,
			sampleRate: 16000,
			duration: 4,
			getChannelData: () => channelData,
		} as unknown as AudioBuffer;

		globalThis.AudioContext = class {
			decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);
			close = vi.fn().mockResolvedValue(undefined);
		} as unknown as typeof AudioContext;

		const oversized = new Blob([new Uint8Array(5000)], { type: 'audio/webm' });
		const chunks = await splitAudioBlobForApi(oversized, 'long.webm', 1000, 2);

		expect(chunks).toHaveLength(2);
		expect(chunks[0].offsetSec).toBe(0);
		expect(chunks[0].durationSec).toBe(2);
		expect(chunks[0].filename).toBe('long_part000.wav');
		expect(chunks[1].offsetSec).toBe(2);
		expect(chunks[1].durationSec).toBe(2);
		expect(chunks[1].filename).toBe('long_part001.wav');
	});

	it('measureAudioBlobDurationSec은 0바이트·AudioContext 부재·audio 메타데이터·decodeAudioData 폴백 및 실패를 정확히 처리한다', async () => {
		// 1) 빈 Blob -> 0
		expect(await measureAudioBlobDurationSec(new Blob([], { type: 'audio/webm' }))).toBe(0);

		const sampleBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });

		// 2) AudioContext 부재 -> null
		globalThis.AudioContext = undefined as unknown as typeof AudioContext;
		expect(await measureAudioBlobDurationSec(sampleBlob)).toBeNull();

		// 3) <audio> 메타데이터 경로 성공 + URL.revokeObjectURL 호출
		const closeMock = vi.fn().mockResolvedValue(undefined);
		const decodeMock = vi.fn();
		globalThis.AudioContext = class {
			decodeAudioData = decodeMock;
			close = closeMock;
		} as unknown as typeof AudioContext;

		URL.createObjectURL = vi.fn().mockReturnValue('blob:duration-test');
		const revokeSpy = vi.fn();
		URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;

		interface FakeAudioElement {
			canPlayType: ReturnType<typeof vi.fn>;
			preload: string;
			duration: number;
			src: string;
			onloadedmetadata: (() => void) | null;
			onerror: (() => void) | null;
			removeAttribute: ReturnType<typeof vi.fn>;
			load: ReturnType<typeof vi.fn>;
		}
		const fakeAudioEl: FakeAudioElement = {
			canPlayType: vi.fn().mockReturnValue('probably'),
			preload: '',
			duration: 305.5,
			src: '',
			onloadedmetadata: null,
			onerror: null,
			removeAttribute: vi.fn(),
			load: vi.fn(function (this: FakeAudioElement) {
				if (this.src) {
					queueMicrotask(() => this.onloadedmetadata?.());
				}
			}),
		};
		vi.spyOn(globalThis, 'createEl').mockReturnValue(fakeAudioEl as unknown as HTMLElement);

		const metaDur = await measureAudioBlobDurationSec(sampleBlob);
		expect(metaDur).toBe(305.5);
		expect(revokeSpy).toHaveBeenCalledWith('blob:duration-test');
		expect(decodeMock).not.toHaveBeenCalled();

		// 4) <audio> onerror 발생 시 decodeAudioData 폴백 + ctx.close() 보장
		fakeAudioEl.load = vi.fn(function (this: FakeAudioElement) {
			if (this.src) {
				queueMicrotask(() => this.onerror?.());
			}
		});
		decodeMock.mockResolvedValueOnce({ duration: 42.25 });
		const fallbackDur = await measureAudioBlobDurationSec(sampleBlob);
		expect(fallbackDur).toBe(42.25);
		expect(closeMock).toHaveBeenCalledTimes(1);

		// 5) decodeAudioData 실패 시에도 null 반환 + finally ctx.close() 호출 보장
		fakeAudioEl.canPlayType = vi.fn().mockReturnValue('');
		decodeMock.mockRejectedValueOnce(new Error('Invalid audio format'));
		const failedDur = await measureAudioBlobDurationSec(sampleBlob);
		expect(failedDur).toBeNull();
		expect(closeMock).toHaveBeenCalledTimes(2);
	});

	it('measureAudioBlobDurationSec은 <audio> 메타데이터 400ms 타임아웃 시 decodeAudioData로 폴백한다', async () => {
		vi.useFakeTimers();
		const closeMock = vi.fn().mockResolvedValue(undefined);
		const decodeMock = vi.fn().mockResolvedValue({ duration: 18.5 });
		globalThis.AudioContext = class {
			decodeAudioData = decodeMock;
			close = closeMock;
		} as unknown as typeof AudioContext;

		URL.createObjectURL = vi.fn().mockReturnValue('blob:timeout-test');
		URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

		const hangingAudioEl = {
			canPlayType: vi.fn().mockReturnValue('maybe'),
			preload: '',
			duration: 0,
			src: '',
			onloadedmetadata: null,
			onerror: null,
			removeAttribute: vi.fn(),
			load: vi.fn(),
		};
		vi.spyOn(globalThis, 'createEl').mockReturnValue(hangingAudioEl as unknown as HTMLElement);

		const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/mpeg' });
		const promise = measureAudioBlobDurationSec(blob);
		await vi.advanceTimersByTimeAsync(450);
		const dur = await promise;

		expect(dur).toBe(18.5);
		expect(decodeMock).toHaveBeenCalledTimes(1);
		expect(closeMock).toHaveBeenCalledTimes(1);
	});

	it('decodeBlobToMono16k는 AudioContext 부재 시 throw하고, 스테레오 48kHz를 16kHz 모노로 다운샘플링하며 close를 보장한다', async () => {
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });

		globalThis.AudioContext = undefined as unknown as typeof AudioContext;
		await expect(decodeBlobToMono16k(blob)).rejects.toThrow(
			'AudioContext is not supported in this environment.',
		);

		globalThis.OfflineAudioContext = undefined as unknown as typeof OfflineAudioContext;
		const ch0 = new Float32Array(4800).fill(0.2);
		const ch1 = new Float32Array(4800).fill(0.4);
		const closeMock = vi.fn().mockResolvedValue(undefined);
		const decodeMock = vi
			.fn()
			.mockResolvedValueOnce({
				numberOfChannels: 2,
				length: 4800,
				sampleRate: 48000,
				duration: 0.1,
				getChannelData: (c: number) => (c === 0 ? ch0 : ch1),
			})
			.mockRejectedValueOnce(new Error('Decode fail'));

		globalThis.AudioContext = class {
			decodeAudioData = decodeMock;
			close = closeMock;
		} as unknown as typeof AudioContext;

		const decoded = await decodeBlobToMono16k(blob);
		expect(decoded.sampleRate).toBe(16000);
		expect(decoded.durationSec).toBe(0.1);
		expect(decoded.samples.length).toBe(1600);
		expect(decoded.samples[0]).toBeCloseTo(0.3, 4);
		expect(closeMock).toHaveBeenCalledTimes(1);

		await expect(decodeBlobToMono16k(blob)).rejects.toThrow('Decode fail');
		expect(closeMock).toHaveBeenCalledTimes(2);
	});
});
