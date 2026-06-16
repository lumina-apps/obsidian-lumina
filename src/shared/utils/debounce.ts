/**
 * 범용 디바운스 유틸리티.
 * main.ts (watch 모드), RagTab.ts (경로 변경) 등에서 setTimeout/clearTimeout 패턴 중복 제거.
 *
 * 사용 예:
 * ```ts
 * const d = debounce(() => { doWork(); }, 2000);
 * d.invoke();  // 타이머 시작 (또는 리셋)
 * d.cancel();  // 타이머 취소
 * ```
 */
export function debounce<T extends (...args: unknown[]) => void>(
	fn: T,
	delay: number,
): { invoke: (...args: Parameters<T>) => void; cancel: () => void } {
	let timer: number | null = null;

	const cancel = () => {
		if (timer !== null) {
			window.clearTimeout(timer);
			timer = null;
		}
	};

	const invoke = (...args: Parameters<T>) => {
		cancel();
		timer = window.setTimeout(() => {
			timer = null;
			fn(...args);
		}, delay) as unknown as number;
	};

	return { invoke, cancel };
}