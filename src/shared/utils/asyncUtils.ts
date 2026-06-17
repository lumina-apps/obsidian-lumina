/**
 * asyncUtils.ts
 *
 * 범용 비동기 유틸리티 모음.
 * - wrapAsync: async 함수를 void 반환 이벤트 핸들러로 래핑
 */

/**
 * Promise를 반환하는 비동기 함수를 void 반환 함수로 래핑합니다.
 * 이벤트 핸들러나 Obsidian onChange 콜백에서 async 함수를 안전하게 호출하기 위해 사용.
 */
export function wrapAsync<T extends unknown[]>(fn: (...args: T) => Promise<unknown>): (...args: T) => void {
	return (...args) => {
		void fn(...args);
	};
}