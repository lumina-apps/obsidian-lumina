/**
 * localWhisperEngine.test.ts
 *
 * 온디바이스 Whisper STT 엔진(LocalWhisperSttEngine)의 워커 라이프사이클,
 * 진행률 콜백, 오프셋 병합, 중단(Abort), 유휴 자동 종료 및 destroy 동작을 검증합니다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App, Platform, TFile } from 'obsidian';
import type { WorkerResponse } from '../../../shared/types/rag.types';

vi.mock('../../../shared/utils/workerCodec', () => ({
	decompressWorkerCode: vi.fn().mockResolvedValue('/* whisper worker code */'),
}));

vi.mock('../audio/audioChunker', () => ({
	decodeBlobToMono16k: vi.fn(),
}));

import { decompressWorkerCode } from '../../../shared/utils/workerCodec';
import { decodeBlobToMono16k } from '../audio/audioChunker';
import { LocalWhisperSttEngine } from '../stt/localWhisperEngine';

/** 워커 전송 메시지 기록 및 이벤트 시뮬레이션용 페이크 Worker */
class FakeWhisperWorker {
	static instances: FakeWhisperWorker[] = [];

	readonly url: string;
	readonly postedMessages: Array<{ msg: unknown; transfer?: unknown[] }> = [];
	readonly terminate = vi.fn();
	private listeners = new Map<string, Set<(ev: unknown) => void>>();

	constructor(url: string) {
		this.url = url;
		FakeWhisperWorker.instances.push(this);
	}

	addEventListener(type: string, cb: (ev: unknown) => void): void {
		let set = this.listeners.get(type);
		if (!set) {
			set = new Set();
			this.listeners.set(type, set);
		}
		set.add(cb);
	}

	removeEventListener(type: string, cb: (ev: unknown) => void): void {
		this.listeners.get(type)?.delete(cb);
	}

	postMessage(msg: unknown, transfer?: unknown[]): void {
		this.postedMessages.push({ msg, transfer });
	}

	/** 테스트에서 워커 응답 메시지를 주입 */
	emitMessage(data: WorkerResponse): void {
		const cbs = this.listeners.get('message');
		if (!cbs) return;
		const ev = { data };
		for (const cb of cbs) {
			cb(ev);
		}
	}

	/** 테스트에서 워커 에러 이벤트를 주입 */
	emitError(message: string): void {
		const cbs = this.listeners.get('error');
		if (!cbs) return;
		const ev = new ErrorEvent('error', { message });
		for (const cb of cbs) {
			cb(ev);
		}
	}
}

function createMockApp(): App {
	const app = new App();
	(app.vault as unknown as { configDir: string; adapter: { basePath: string } }).configDir = '.obsidian';
	(app.vault as unknown as { configDir: string; adapter: { basePath: string } }).adapter = {
		basePath: '/vault',
	};
	return app;
}

describe('LocalWhisperSttEngine', () => {
	const origWorker = window.Worker;
	const origCreateObjectURL = URL.createObjectURL;
	const origRevokeObjectURL = URL.revokeObjectURL;
	const origIsMobile = Platform.isMobile;
	let revokeSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		FakeWhisperWorker.instances = [];
		Platform.isMobile = false;
		(window as unknown as { Worker: unknown }).Worker = FakeWhisperWorker;

		URL.createObjectURL = vi.fn().mockReturnValue('blob:whisper-worker-1');
		revokeSpy = vi.fn();
		URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;

		vi.mocked(decompressWorkerCode).mockResolvedValue('/* whisper worker code */');
		vi.mocked(decodeBlobToMono16k).mockResolvedValue({
			samples: new Float32Array([0.1, 0.2, 0.3, 0.4]),
			sampleRate: 16000,
			durationSec: 4.5,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		Platform.isMobile = origIsMobile;
		(window as unknown as { Worker: unknown }).Worker = origWorker;
		URL.createObjectURL = origCreateObjectURL;
		URL.revokeObjectURL = origRevokeObjectURL;
		vi.clearAllMocks();
	});

	it('모바일 환경(Platform.isMobile = true)에서는 즉시 에러를 발생시킨다', async () => {
		Platform.isMobile = true;
		const engine = new LocalWhisperSttEngine(createMockApp(), 'Xenova/whisper-small');
		const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' });

		await expect(engine.transcribe(blob, 'rec.webm')).rejects.toThrow();
		expect(FakeWhisperWorker.instances).toHaveLength(0);
	});

	it('호출 전 이미 중단된 AbortSignal이면 워커를 띄우지 않고 AbortError를 던진다', async () => {
		const engine = new LocalWhisperSttEngine(createMockApp());
		const ac = new AbortController();
		ac.abort();

		const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' });
		await expect(engine.transcribe(blob, 'rec.webm', { signal: ac.signal })).rejects.toMatchObject({
			name: 'AbortError',
		});
		expect(FakeWhisperWorker.instances).toHaveLength(0);
	});

	it('초기화 진행률 전달 후 whisper-result를 오프셋·타임스탬프와 함께 반환한다', async () => {
		const engine = new LocalWhisperSttEngine(createMockApp(), 'Xenova/whisper-base');
		expect(engine.label).toBe('Local Whisper (whisper-base)');

		const progressEvents: Array<{ pct: number; status: string }> = [];
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });

		const promise = engine.transcribe(blob, 'clip.webm', {
			offsetSec: 10,
			language: 'ko',
			onProgress: (pct, status) => progressEvents.push({ pct, status }),
		});

		// 비동기 workerCode 해제 후 FakeWhisperWorker가 생성될 때까지 대기
		await vi.waitFor(() => expect(FakeWhisperWorker.instances).toHaveLength(1));
		const worker = FakeWhisperWorker.instances[0];

		expect(worker.postedMessages[0].msg).toMatchObject({
			type: 'whisper-init',
			modelName: 'Xenova/whisper-base',
		});

		worker.emitMessage({ type: 'progress', progress: 42, status: 'downloading' });
		worker.emitMessage({ type: 'whisper-ready' });

		await vi.waitFor(() =>
			expect(worker.postedMessages.some((m) => (m.msg as { type: string }).type === 'whisper-transcribe')).toBe(
				true,
			),
		);

		const transcribeCall = worker.postedMessages.find(
			(m) => (m.msg as { type: string }).type === 'whisper-transcribe',
		);
		const reqId = (transcribeCall?.msg as { requestId: string }).requestId;
		expect((transcribeCall?.msg as { language?: string }).language).toBe('ko');

		worker.emitMessage({
			type: 'whisper-result',
			requestId: reqId,
			text: '  안녕하세요 반갑습니다  ',
			chunks: [
				{ timestamp: [0, 1.5], text: ' 안녕하세요 ' },
				{ timestamp: [2.0, 4.0], text: ' 반갑습니다 ' },
				{ timestamp: [4.0, 4.5], text: '   ' },
			],
		});

		const result = await promise;
		expect(progressEvents).toEqual([{ pct: 42, status: 'downloading' }]);
		expect(result.engineLabel).toBe('Local Whisper (whisper-base)');
		expect(result.durationSec).toBe(4.5);
		expect(result.text).toBe('안녕하세요 반갑습니다');
		expect(result.segments).toEqual([
			{ startSec: 10, endSec: 11.5, text: '안녕하세요' },
			{ startSec: 12, endSec: 14, text: '반갑습니다' },
		]);

		engine.destroy();
	});

	it('chunks가 비어있고 text만 존재하거나 timestamp[1]이 null일 때 안전하게 폴백한다', async () => {
		const engine = new LocalWhisperSttEngine(createMockApp());
		const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });

		// 1차 호출: chunks 빈 배열 -> text 기반 단일 세그먼트 폴백
		const p1 = engine.transcribe(blob, 'a.webm', { offsetSec: 5 });
		await vi.waitFor(() => expect(FakeWhisperWorker.instances).toHaveLength(1));
		const worker = FakeWhisperWorker.instances[0];
		worker.emitMessage({ type: 'whisper-ready' });

		await vi.waitFor(() => expect(worker.postedMessages.length).toBe(2));
		const req1 = (worker.postedMessages[1].msg as { requestId: string }).requestId;
		worker.emitMessage({
			type: 'whisper-result',
			requestId: req1,
			text: '전체 발화 문장',
			chunks: [],
		});
		const res1 = await p1;
		expect(res1.segments).toEqual([{ startSec: 5, endSec: 9.5, text: '전체 발화 문장' }]);

		// 2차 호출: 이미 준비된 워커 재사용 + timestamp[1] === null 처리
		const p2 = engine.transcribe(blob, 'b.webm', { offsetSec: 0 });
		await vi.waitFor(() => expect(worker.postedMessages.length).toBe(3));
		const req2 = (worker.postedMessages[2].msg as { requestId: string }).requestId;
		worker.emitMessage({
			type: 'whisper-result',
			requestId: req2,
			text: '',
			chunks: [{ timestamp: [1.5, null], text: '끝 미지정 세그먼트' }],
		});
		const res2 = await p2;
		expect(res2.text).toBe('끝 미지정 세그먼트');
		expect(res2.segments).toEqual([{ startSec: 1.5, endSec: 1.5, text: '끝 미지정 세그먼트' }]);

		engine.destroy();
	});

	it('디코딩된 오디오 샘플이 비어있으면 전사 요청 없이 빈 결과를 반환한다', async () => {
		vi.mocked(decodeBlobToMono16k).mockResolvedValueOnce({
			samples: new Float32Array(0),
			sampleRate: 16000,
			durationSec: 0,
		});

		const engine = new LocalWhisperSttEngine(createMockApp());
		const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
		const p = engine.transcribe(blob, 'empty.webm');

		await vi.waitFor(() => expect(FakeWhisperWorker.instances).toHaveLength(1));
		const worker = FakeWhisperWorker.instances[0];
		worker.emitMessage({ type: 'whisper-ready' });

		const res = await p;
		expect(res).toEqual({
			text: '',
			segments: [],
			engineLabel: 'Local Whisper (whisper-tiny)',
			durationSec: 0,
		});
		// whisper-init만 전송되고 whisper-transcribe는 전송되지 않아야 함
		expect(worker.postedMessages).toHaveLength(1);
		engine.destroy();
	});

	it('whisper-init 오류 메시지 수신 시 reject하고 워커 및 Blob URL을 정리한다', async () => {
		const engine = new LocalWhisperSttEngine(createMockApp());
		const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
		const p = engine.transcribe(blob, 'fail.webm');

		await vi.waitFor(() => expect(FakeWhisperWorker.instances).toHaveLength(1));
		const worker = FakeWhisperWorker.instances[0];
		worker.emitMessage({
			type: 'error',
			requestId: 'whisper-init',
			message: 'Model download failed',
		});

		await expect(p).rejects.toThrow('Model download failed');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(revokeSpy).toHaveBeenCalledWith('blob:whisper-worker-1');
	});

	it('전사 작업 오류 메시지 및 Worker error 이벤트를 올바르게 전파한다', async () => {
		const engine = new LocalWhisperSttEngine(createMockApp());
		const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });

		// 1) 특정 requestId error 메시지
		const p1 = engine.transcribe(blob, 'job-err.webm');
		await vi.waitFor(() => expect(FakeWhisperWorker.instances).toHaveLength(1));
		const worker = FakeWhisperWorker.instances[0];
		worker.emitMessage({ type: 'whisper-ready' });
		await vi.waitFor(() => expect(worker.postedMessages.length).toBe(2));
		const req1 = (worker.postedMessages[1].msg as { requestId: string }).requestId;
		worker.emitMessage({
			type: 'error',
			requestId: req1,
			message: 'Inference failed',
		});
		await expect(p1).rejects.toThrow('Inference failed');

		// 2) Worker 전역 error 이벤트
		const p2 = engine.transcribe(blob, 'worker-crash.webm');
		await vi.waitFor(() => expect(worker.postedMessages.length).toBe(3));
		worker.emitError('Worker crashed unexpectedly');
		await expect(p2).rejects.toThrow('Worker crashed unexpectedly');

		engine.destroy();
	});

	it('초기화 도중과 전사 도중 AbortSignal이 울리면 각각 AbortError로 중단한다', async () => {
		// 1) 초기화 중 abort
		const engine1 = new LocalWhisperSttEngine(createMockApp());
		const ac1 = new AbortController();
		const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });

		const p1 = engine1.transcribe(blob, 'abort-init.webm', { signal: ac1.signal });
		await vi.waitFor(() => expect(FakeWhisperWorker.instances).toHaveLength(1));
		ac1.abort();
		await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
		expect(FakeWhisperWorker.instances[0].terminate).toHaveBeenCalled();

		// 2) 전사 진행 중 abort
		FakeWhisperWorker.instances = [];
		const engine2 = new LocalWhisperSttEngine(createMockApp());
		const ac2 = new AbortController();
		const p2 = engine2.transcribe(blob, 'abort-job.webm', { signal: ac2.signal });
		await vi.waitFor(() => expect(FakeWhisperWorker.instances).toHaveLength(1));
		const w2 = FakeWhisperWorker.instances[0];
		w2.emitMessage({ type: 'whisper-ready' });
		await vi.waitFor(() => expect(w2.postedMessages.length).toBe(2));
		ac2.abort();
		await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
		engine2.destroy();
	});

	it('3분 유휴 타임아웃 경과 시 워커를 자동 종료하고, destroy()는 대기 작업을 reject한다', async () => {
		vi.useFakeTimers();
		const engine = new LocalWhisperSttEngine(createMockApp());
		const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });

		const p1 = engine.transcribe(blob, 'idle.webm');
		// 마이크로태스크 플러시 (decompressWorkerCode -> Worker 생성)
		await vi.advanceTimersByTimeAsync(0);
		const worker = FakeWhisperWorker.instances[0];
		worker.emitMessage({ type: 'whisper-ready' });
		await vi.advanceTimersByTimeAsync(0);

		const req1 = (worker.postedMessages[1].msg as { requestId: string }).requestId;
		worker.emitMessage({
			type: 'whisper-result',
			requestId: req1,
			text: '완료',
			chunks: [{ timestamp: [0, 1], text: '완료' }],
		});
		await p1;

		// 3분 경과 전에는 살아있음
		await vi.advanceTimersByTimeAsync(179_000);
		expect(worker.terminate).not.toHaveBeenCalled();

		// 3분 도달 시 자동 종료 + Blob URL 해제
		await vi.advanceTimersByTimeAsync(1_000);
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(revokeSpy).toHaveBeenCalledWith('blob:whisper-worker-1');

		// 재시작 후 진행 중 작업에 대해 destroy() 호출 시 reject 검증
		FakeWhisperWorker.instances = [];
		const p2 = engine.transcribe(blob, 'destroy-pending.webm');
		await vi.advanceTimersByTimeAsync(0);
		const worker2 = FakeWhisperWorker.instances[0];
		worker2.emitMessage({ type: 'whisper-ready' });
		await vi.advanceTimersByTimeAsync(0);

		engine.destroy();
		await expect(p2).rejects.toThrow('Local Whisper worker terminated.');
		expect(worker2.terminate).toHaveBeenCalled();
	});

	it('초기화 타임아웃(10분) 경과 시 초기화 실패로 정리한다', async () => {
		vi.useFakeTimers();
		const engine = new LocalWhisperSttEngine(createMockApp());
		const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });

		const p = engine.transcribe(blob, 'timeout.webm');
		const rejection = expect(p).rejects.toThrow('Local Whisper initialization timed out.');
		await vi.advanceTimersByTimeAsync(0);
		expect(FakeWhisperWorker.instances).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
		await rejection;
	});
});
