import { describe, it, expect, vi } from 'vitest';
import { withAbort } from './asyncUtils';

describe('withAbort', () => {
	it('signal이 없으면 원본 Promise를 그대로 반환한다', async () => {
		await expect(withAbort(Promise.resolve(1))).resolves.toBe(1);
	});

	it('정상 완료 시 값을 반환하고 abort 리스너를 해제한다', async () => {
		const controller = new AbortController();
		const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
		await expect(withAbort(Promise.resolve('ok'), controller.signal)).resolves.toBe('ok');
		expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
	});

	it('이미 abort된 signal이면 즉시 AbortError로 reject한다', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(withAbort(new Promise(() => undefined), controller.signal)).rejects.toMatchObject({
			name: 'AbortError',
		});
	});

	it('대기 중 abort되면 AbortError로 reject한다', async () => {
		const controller = new AbortController();
		const pending = withAbort(new Promise(() => undefined), controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('원본이 reject되면 에러를 전달하고 리스너를 해제한다', async () => {
		const controller = new AbortController();
		const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
		await expect(withAbort(Promise.reject(new Error('boom')), controller.signal)).rejects.toThrow('boom');
		expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
	});
});
