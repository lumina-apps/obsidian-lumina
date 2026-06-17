/** async 함수를 void 반환 함수로 래핑. 이벤트 핸들러나 onChange 콜백용 */
export function wrapAsync<T extends unknown[]>(fn: (...args: T) => Promise<unknown>): (...args: T) => void {
	return (...args) => {
		void fn(...args);
	};
}