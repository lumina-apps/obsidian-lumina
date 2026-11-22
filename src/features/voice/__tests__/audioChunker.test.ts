import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	calculateRms,
	encodePcmToWav,
	isSilentBuffer,
	resampleLinearMono,
	splitAudioBlobForApi,
} from '../audio/audioChunker';

describe('audioChunker', () => {
	const origAudioContext = globalThis.AudioContext;

	afterEach(() => {
		globalThis.AudioContext = origAudioContext;
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
});
