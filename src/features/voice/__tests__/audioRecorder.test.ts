import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceAudioRecorder } from '../audio/audioRecorder';

interface MockWorkletInstance {
	port: {
		postMessage: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		onmessage: ((ev: MessageEvent<unknown>) => void) | null;
	};
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

describe('VoiceAudioRecorder', () => {
	const origMediaDevices = navigator.mediaDevices;
	const origWebkitAudioContext = (
		window as unknown as { webkitAudioContext?: typeof AudioContext }
	).webkitAudioContext;
	const origCreateObjectURL = URL.createObjectURL;
	const origRevokeObjectURL = URL.revokeObjectURL;

	let trackStopMock: ReturnType<typeof vi.fn>;
	let addModuleMock: ReturnType<typeof vi.fn>;
	let sourceConnectMock: ReturnType<typeof vi.fn>;
	let sourceDisconnectMock: ReturnType<typeof vi.fn>;
	let analyserDisconnectMock: ReturnType<typeof vi.fn>;
	let gainDisconnectMock: ReturnType<typeof vi.fn>;
	let contextCloseMock: ReturnType<typeof vi.fn>;
	let createdWorkletNodes: MockWorkletInstance[];
	let audioCtxConstructSpy: ReturnType<typeof vi.fn<() => void>>;

	beforeEach(() => {
		trackStopMock = vi.fn();
		addModuleMock = vi.fn().mockResolvedValue(undefined);
		sourceConnectMock = vi.fn();
		sourceDisconnectMock = vi.fn();
		analyserDisconnectMock = vi.fn();
		gainDisconnectMock = vi.fn();
		contextCloseMock = vi.fn().mockResolvedValue(undefined);
		createdWorkletNodes = [];
		audioCtxConstructSpy = vi.fn<() => void>();

		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				getUserMedia: vi.fn().mockResolvedValue({
					getTracks: () => [{ stop: trackStopMock }],
				}),
			},
		});

		class MockMediaRecorder {
			static isTypeSupported = vi.fn().mockReturnValue(true);
			mimeType = 'audio/webm';
			state: 'inactive' | 'recording' | 'paused' = 'inactive';
			ondataavailable: ((ev: { data: Blob }) => void) | null = null;
			onstop: (() => void) | null = null;
			start() {
				this.state = 'recording';
				this.ondataavailable?.({
					data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }),
				});
			}
			pause() {
				this.state = 'paused';
			}
			resume() {
				this.state = 'recording';
			}
			stop() {
				this.state = 'inactive';
				this.onstop?.();
			}
		}

		class MockAudioContext {
			sampleRate = 16000;
			destination = {};
			audioWorklet = {
				addModule: addModuleMock,
			};
			createMediaStreamSource = vi.fn().mockReturnValue({
				connect: sourceConnectMock,
				disconnect: sourceDisconnectMock,
			});
			createAnalyser = vi.fn().mockReturnValue({
				fftSize: 256,
				frequencyBinCount: 128,
				getByteTimeDomainData: vi.fn(),
				disconnect: analyserDisconnectMock,
			});
			createGain = vi.fn().mockReturnValue({
				gain: { value: 1 },
				connect: vi.fn(),
				disconnect: gainDisconnectMock,
			});
			close = contextCloseMock;
			constructor() {
				audioCtxConstructSpy();
			}
		}

		class MockAudioWorkletNode implements MockWorkletInstance {
			port = {
				postMessage: vi.fn(),
				close: vi.fn(),
				onmessage: null as ((ev: MessageEvent<unknown>) => void) | null,
			};
			connect = vi.fn();
			disconnect = vi.fn();
			constructor() {
				createdWorkletNodes.push(this);
			}
		}

		vi.stubGlobal('MediaRecorder', MockMediaRecorder);
		vi.stubGlobal('AudioContext', MockAudioContext);
		vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);

		URL.createObjectURL = vi.fn().mockReturnValue('blob:lumina-worklet-test');
		URL.revokeObjectURL = vi.fn();
	});

	afterEach(() => {
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: origMediaDevices,
		});
		(
			window as unknown as { webkitAudioContext?: typeof AudioContext }
		).webkitAudioContext = origWebkitAudioContext;
		URL.createObjectURL = origCreateObjectURL;
		URL.revokeObjectURL = origRevokeObjectURL;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('start() 시 AudioWorklet 모듈 등록 및 연결과 window.requestAnimationFrame 호출을 수행한다', async () => {
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);
		const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

		const recorder = new VoiceAudioRecorder({
			onSpeechChunk: vi.fn(),
		});

		await recorder.start();

		await vi.waitFor(() => {
			expect(createdWorkletNodes).toHaveLength(1);
		});

		expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
		expect(addModuleMock).toHaveBeenCalledWith('blob:lumina-worklet-test');
		expect(sourceConnectMock).toHaveBeenCalledWith(createdWorkletNodes[0]);
		expect(createdWorkletNodes[0].connect).toHaveBeenCalledTimes(1);
		expect(rafSpy).toHaveBeenCalledTimes(1);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:lumina-worklet-test');

		recorder.cancel();

		expect(cancelRafSpy).toHaveBeenCalledWith(42);
		expect(createdWorkletNodes[0].port.postMessage).toHaveBeenCalledWith('stop');
		expect(createdWorkletNodes[0].port.close).toHaveBeenCalledTimes(1);
		expect(createdWorkletNodes[0].disconnect).toHaveBeenCalledTimes(1);
		expect(trackStopMock).toHaveBeenCalledTimes(1);
	});

	it('AudioWorklet 포트에서 유성 PCM 프레임을 수신하면 pause()/stop() 시 WAV 청크를 방출한다', async () => {
		vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
		vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

		const onSpeechChunk = vi.fn();
		const recorder = new VoiceAudioRecorder({ onSpeechChunk });

		await recorder.start();
		await vi.waitFor(() => {
			expect(createdWorkletNodes).toHaveLength(1);
		});

		const worklet = createdWorkletNodes[0];
		expect(worklet.port.onmessage).not.toBeNull();

		// 16kHz 기준 4096샘플 x 2회 = 8192샘플(0.512초 >= 최소 발화 길이 0.4초)
		const voicedFrame1 = new Float32Array(4096).fill(0.2);
		const voicedFrame2 = new Float32Array(4096).fill(0.2);
		worklet.port.onmessage?.({ data: voicedFrame1 } as MessageEvent<unknown>);
		worklet.port.onmessage?.({ data: voicedFrame2 } as MessageEvent<unknown>);

		recorder.pause();

		expect(onSpeechChunk).toHaveBeenCalledTimes(1);
		const emitted = onSpeechChunk.mock.calls[0][0] as {
			wavBlob: Blob;
			offsetSec: number;
			durationSec: number;
		};
		expect(emitted.wavBlob.type).toBe('audio/wav');
		expect(emitted.durationSec).toBeCloseTo(8192 / 16000, 3);

		const res = await recorder.stop();
		expect(res.fullBlob.size).toBeGreaterThan(0);
		expect(worklet.port.postMessage).toHaveBeenCalledWith('stop');
		expect(worklet.disconnect).toHaveBeenCalledTimes(1);
		expect(trackStopMock).toHaveBeenCalledTimes(1);
	});

	it('비동기 addModule 대기 중 cancel() 호출 시 보류 중인 Blob URL을 즉시 해제한다', async () => {
		vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(11);
		vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

		let resolveAddModule: () => void = () => {};
		addModuleMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveAddModule = resolve;
				}),
		);

		const recorder = new VoiceAudioRecorder({
			onSpeechChunk: vi.fn(),
		});

		await recorder.start();
		recorder.cancel();

		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:lumina-worklet-test');
		expect(createdWorkletNodes).toHaveLength(0);

		resolveAddModule();
		await Promise.resolve();
		expect(createdWorkletNodes).toHaveLength(0);
	});

	it('AudioContext가 없을 때 window.webkitAudioContext 폴백을 사용한다', async () => {
		vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(3);
		vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

		const ActiveAudioCtx = window.AudioContext;
		vi.stubGlobal('AudioContext', undefined);
		(
			window as unknown as { webkitAudioContext?: typeof AudioContext }
		).webkitAudioContext = ActiveAudioCtx;

		const recorder = new VoiceAudioRecorder({
			onSpeechChunk: vi.fn(),
		});

		await recorder.start();
		await vi.waitFor(() => {
			expect(createdWorkletNodes).toHaveLength(1);
		});

		expect(audioCtxConstructSpy).toHaveBeenCalledTimes(1);
		recorder.cancel();
	});
});
