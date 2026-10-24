import { normalizeError } from './errorUtils';

/** async 함수를 void 반환 함수로 래핑. 이벤트 핸들러나 onChange 콜백용 */
export function wrapAsync<T extends unknown[]>(fn: (...args: T) => Promise<unknown>): (...args: T) => void {
	return (...args) => {
		void fn(...args);
	};
}

/** Promise에 타임아웃을 적용합니다. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => {
			reject(new Error(message));
		}, timeoutMs);

		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(err: unknown) => {
				window.clearTimeout(timer);
				reject(normalizeError(err));
			},
		);
	});
}

function createAbortError(): Error {
	const err = new Error('The operation was aborted.');
	err.name = 'AbortError';
	return err;
}

/**
 * Promise가 AbortSignal로 중단될 수 있도록 감쌉니다.
 * 원본 작업(예: requestUrl)은 취소되지 않으며 대기만 즉시 해제됩니다.
 */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) {
		// 원본 Promise의 unhandled rejection 방지
		promise.catch(() => undefined);
		return Promise.reject(createAbortError());
	}

	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(createAbortError());
		signal.addEventListener('abort', onAbort, { once: true });

		promise.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(err: unknown) => {
				signal.removeEventListener('abort', onAbort);
				reject(normalizeError(err));
			},
		);
	});
}