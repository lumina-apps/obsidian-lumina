/** 범용 디바운스 유틸. main.ts(watch 모드), RagTab 등에서 사용 */
export function debounce<Args extends unknown[]>(
	fn: (...args: Args) => void,
	delay: number,
): { invoke: (...args: Args) => void; cancel: () => void } {
	let timer: number | null = null;

	const cancel = () => {
		if (timer !== null) {
			window.clearTimeout(timer);
			timer = null;
		}
	};

	const invoke = (...args: Args) => {
		cancel();
		timer = window.setTimeout(() => {
			timer = null;
			fn(...args);
		}, delay);
	};

	return { invoke, cancel };
}
