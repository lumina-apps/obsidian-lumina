/**
 * provider-helpers.test.ts
 * LLM REST API Provider용 공통 헬퍼 함수 검증
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

// ── Obsidian 의존성 모킹 ──
const { mockRequestUrl, mockPlatform } = vi.hoisted(() => ({
	mockRequestUrl: vi.fn(),
	mockPlatform: { isMobile: false },
}));
vi.mock('obsidian', () => ({
	Platform: mockPlatform,
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

import {
	IdleTimeoutController,
	requestUrlWithAbort,
	raiseApiError,
	readStreamLines,
	isMobileStreamingCorsFallbackError,
} from './provider-helpers';

beforeEach(() => {
	mockRequestUrl.mockReset();
});

describe('IdleTimeoutController', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('should create an AbortController and expose its signal', () => {
		const ctrl = new IdleTimeoutController(undefined, undefined, undefined);

		expect(ctrl.signal).toBeInstanceOf(AbortSignal);
		expect(ctrl.signal.aborted).toBe(false);
	});

	it('should abort when user signal is already aborted', () => {
		const controller = new AbortController();
		controller.abort();

		const idleCtrl = new IdleTimeoutController(controller.signal, undefined, undefined);
		expect(idleCtrl.signal.aborted).toBe(true);
	});

	it('should link user abort signal to internal controller', () => {
		const userController = new AbortController();

		const idleCtrl = new IdleTimeoutController(userController.signal, undefined, undefined);

		userController.abort();
		expect(idleCtrl.signal.aborted).toBe(true);
	});

	it('should throw IdleTimeoutError when TTFT timeout fires', async () => {
		vi.useFakeTimers();
		const ctrl = new IdleTimeoutController(undefined, 5000, undefined); // 5s TTFT

		const runPromise = ctrl.run(async () => {
			return new Promise<unknown>((_resolve, reject) => {
				ctrl.signal.addEventListener('abort', () => {
					const reason = ctrl.signal.reason;
					reject(reason instanceof Error ? reason : new Error('Aborted'));
				}, { once: true });
			});
		});
		// Pre-attach a handler so the rejection is not flagged as unhandled
		// while we advance the fake timers.
		runPromise.catch(() => {});

		// Advance time past the TTFT threshold
		await vi.advanceTimersByTimeAsync(6000);

		// IdleTimeoutError is identified by its error `name`, not the message
		await expect(runPromise).rejects.toMatchObject({ name: 'IdleTimeoutError' });
	});

	it('should NOT throw when TTFT completes before timeout', async () => {
		vi.useFakeTimers();
		const ctrl = new IdleTimeoutController(undefined, 5000, undefined);

		const runPromise = ctrl.run(async () => 'result');
		await vi.advanceTimersByTimeAsync(100);

		await expect(runPromise).resolves.toBe('result');
	});

	it('should reset inter-token timer on chunk received', async () => {
		vi.useFakeTimers();
		const ctrl = new IdleTimeoutController(undefined, undefined, 3000); // 3s inter-token
		let resolveFn: (v: string) => void = () => {};

		const runPromise = ctrl.run(async () => {
			return new Promise<string>((resolve, reject) => {
				resolveFn = resolve;
				ctrl.signal.addEventListener('abort', () => {
					const reason = ctrl.signal.reason;
					reject(reason instanceof Error ? reason : new Error('Aborted'));
				}, { once: true });
			});
		});

		// Chunks every 2s (under the 3s limit) keep resetting the timer — never aborts
		ctrl.onChunkReceived();
		await vi.advanceTimersByTimeAsync(2000);
		ctrl.onChunkReceived();
		await vi.advanceTimersByTimeAsync(2000);
		ctrl.onChunkReceived();

		expect(ctrl.signal.aborted).toBe(false);

		resolveFn('done');
		await expect(runPromise).resolves.toBe('done');
	});

	it('should cleanup timer on successful completion', async () => {
		vi.useFakeTimers();
		const ctrl = new IdleTimeoutController(undefined, 5000, undefined);

		const result = await ctrl.run(async () => 'success');
		expect(result).toBe('success');

		// Timer was cleaned up — advancing well past TTFT must not abort
		await vi.advanceTimersByTimeAsync(10000);
		expect(ctrl.signal.aborted).toBe(false);
	});
});

describe('requestUrlWithAbort', () => {
	afterEach(() => {
		mockPlatform.isMobile = false;
	});

	it('should call requestUrl with the given params when signal not aborted', async () => {
		mockRequestUrl.mockResolvedValue({ json: {}, text: '' } as RequestUrlResponse);

		await requestUrlWithAbort({ url: 'http://example.com' }, undefined);

		expect(mockRequestUrl).toHaveBeenCalledWith({ url: 'http://example.com' });
	});

	it('should throw AbortError when signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			requestUrlWithAbort({ url: 'http://example.com' }, controller.signal),
		).rejects.toThrow('Aborted');
	});

	it('should forward requestUrl errors', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Network error'));

		await expect(
			requestUrlWithAbort({ url: 'http://example.com' }),
		).rejects.toThrow('Network error');
	});

	it('모바일에서는 throw: false로 요청하고 HTTP 4xx/5xx 시 status와 본문 메타데이터를 보존해 예외를 던진다', async () => {
		mockPlatform.isMobile = true;
		mockRequestUrl.mockResolvedValue({
			status: 400,
			text: 'Bad Request Body',
			json: { error: { message: 'Invalid request' } },
			headers: { 'x-req-id': 'abc' },
		} as unknown as RequestUrlResponse);

		let caught: unknown;
		try {
			await requestUrlWithAbort({ url: 'http://example.com' }, undefined);
		} catch (err) {
			caught = err;
		}

		expect(mockRequestUrl).toHaveBeenCalledWith({ url: 'http://example.com', throw: false });
		expect(caught).toBeInstanceOf(Error);
		expect(caught).toMatchObject({
			status: 400,
			text: 'Bad Request Body',
			json: { error: { message: 'Invalid request' } },
		});
	});

	it('모바일에서도 HTTP 200 응답이면 정상 반환한다', async () => {
		mockPlatform.isMobile = true;
		const res = { status: 200, text: '{"ok":true}', json: { ok: true }, headers: {} } as unknown as RequestUrlResponse;
		mockRequestUrl.mockResolvedValue(res);

		await expect(requestUrlWithAbort({ url: 'http://example.com' }, undefined)).resolves.toBe(res);
		expect(mockRequestUrl).toHaveBeenCalledWith({ url: 'http://example.com', throw: false });
	});
});

describe('raiseApiError', () => {
	it('should throw an error with the provider name and status', () => {
		expect(() => raiseApiError({ status: 401, message: 'Unauthorized' }, 'OpenAI'))
			.toThrow(/OpenAI/);
	});

	it('should handle unknown status gracefully', () => {
		expect(() => raiseApiError(new Error('Some error'), 'Anthropic'))
			.toThrow(/Anthropic/);
	});
});

describe('readStreamLines', () => {
	it('should process lines and trailing buffer when not aborted', async () => {
		const lines: string[] = [];
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('line 1\nline 2\ntrailing'));
				controller.close();
			},
		});
		const response = new Response(stream);

		await readStreamLines(response, undefined, (line) => lines.push(line));

		expect(lines).toEqual(['line 1', 'line 2', 'trailing']);
	});

	it('should not process trailing buffer when signal is aborted', async () => {
		const lines: string[] = [];
		const encoder = new TextEncoder();
		const controller = new AbortController();
		let enqueueTrailing: (() => void) | null = null;
		const stream = new ReadableStream({
			start(ctrl) {
				ctrl.enqueue(encoder.encode('line 1\n'));
				enqueueTrailing = () => {
					ctrl.enqueue(encoder.encode('trailing'));
					ctrl.close();
				};
			},
		});
		const response = new Response(stream);

		await readStreamLines(response, controller.signal, (line) => {
			lines.push(line);
			controller.abort();
			enqueueTrailing?.();
		});

		expect(lines).toEqual(['line 1']);
	});
});

describe('isMobileStreamingCorsFallbackError', () => {
	afterEach(() => {
		mockPlatform.isMobile = false;
	});

	it('모바일에서 TypeError(CORS/네트워크 차단) 발생 시 true를 반환한다', () => {
		mockPlatform.isMobile = true;
		expect(isMobileStreamingCorsFallbackError(new TypeError('Load failed'))).toBe(true);
	});

	it('데스크탑에서는 TypeError여도 false를 반환한다', () => {
		mockPlatform.isMobile = false;
		expect(isMobileStreamingCorsFallbackError(new TypeError('Load failed'))).toBe(false);
	});

	it('AbortError, IdleTimeoutError, 일반 Error는 false를 반환한다', () => {
		mockPlatform.isMobile = true;
		const abortErr = new TypeError('Aborted');
		abortErr.name = 'AbortError';
		const idleErr = new TypeError('Timed out');
		idleErr.name = 'IdleTimeoutError';

		expect(isMobileStreamingCorsFallbackError(abortErr)).toBe(false);
		expect(isMobileStreamingCorsFallbackError(idleErr)).toBe(false);
		expect(isMobileStreamingCorsFallbackError(new Error('HTTP 400'))).toBe(false);
	});

	it('switchToNonStreamingFallback 호출 시 짧은 TTFT 경과 후에도 중단되지 않고 여유 타임아웃으로 전환된다', () => {
		vi.useFakeTimers();
		try {
			const ctrl = new IdleTimeoutController(undefined, 5000, 2000);
			vi.advanceTimersByTime(4000);
			expect(ctrl.signal.aborted).toBe(false);

			ctrl.switchToNonStreamingFallback(60_000);
			vi.advanceTimersByTime(15_000);
			expect(ctrl.signal.aborted).toBe(false);

			vi.advanceTimersByTime(45_000);
			expect(ctrl.signal.aborted).toBe(true);
			expect((ctrl.signal.reason as Error)?.name).toBe('IdleTimeoutError');
			ctrl.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});

