/**
 * provider-helpers.test.ts
 * LLM REST API Provider용 공통 헬퍼 함수 검증
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

// ── Obsidian 의존성 모킹 ──
const mockRequestUrl = vi.fn();
vi.mock('obsidian', () => ({
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

import { IdleTimeoutController, requestUrlWithAbort, raiseApiError } from './provider-helpers';

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
