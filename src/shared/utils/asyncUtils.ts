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
				reject(err instanceof Error ? err : new Error(String(err)));
			},
		);
	});
}