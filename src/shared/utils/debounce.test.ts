/**
 * debounce.test.ts
 * 디바운스 유틸 함수 검증
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('지정된 delay 전에는 fn이 호출되지 않는다', () => {
		const fn = vi.fn();
		const { invoke } = debounce(fn, 100);

		invoke();
		expect(fn).not.toHaveBeenCalled();
	});

	it('delay 이후에 fn이 호출된다', () => {
		const fn = vi.fn();
		const { invoke } = debounce(fn, 100);

		invoke();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('연속 호출 시 마지막 인자만 전달된다', () => {
		const fn = vi.fn();
		const { invoke } = debounce(fn, 100);

		invoke(1);
		invoke(2);
		invoke(3);
		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith(3);
	});

	it('cancel 호출 시 예약된 fn이 실행되지 않는다', () => {
		const fn = vi.fn();
		const { invoke, cancel } = debounce(fn, 100);

		invoke();
		cancel();
		vi.advanceTimersByTime(100);

		expect(fn).not.toHaveBeenCalled();
	});

	it('여러 인자를 전달할 수 있다', () => {
		const fn = vi.fn();
		const { invoke } = debounce(fn, 100);

		invoke('hello', 42, { key: 'value' });
		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledWith('hello', 42, { key: 'value' });
	});
});