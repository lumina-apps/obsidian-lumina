/** 범용 디바운스 유틸. main.ts(watch 모드), RagTab 등에서 사용 */
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
