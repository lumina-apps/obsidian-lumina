/**
 * 키보드 네비게이션 composable.
 * ContextSelector 등에서 사용하는 ArrowDown/Up/Enter/Escape/Backspace
 * 키보드 네비게이션 로직을 제공합니다.
 *
 * 각 호출마다 독립적인 클로저 상태를 반환하며,
 * 호출하는 .svelte 컴포넌트에서 getter/setter로 상태를 읽고 씁니다.
 */

import { tick, onDestroy } from "svelte";

export interface KeyboardNavConfig {
	/** 현재 선택 가능한 항목 수를 반환하는 함수 */
	selectableCount: () => number;
	/** 현재 선택된 항목을 실행하는 함수 (Enter 시) */
	onSelectCurrent: () => void;
	/** 닫기 동작 (Escape 시) */
	onEscape: () => void;
	/** 뒤로 가기 동작 (Backspace 시, 선택 사항). 실제로 뒤로 갔으면 true 반환. */
	onBack?: () => boolean | void;
	/** 활성 항목을 뷰로 스크롤하는 함수 */
	scrollIntoView: () => void;
	/** 마우스 충돌 방지 플래그 사용 여부 (기본 false) */
	enableMouseConflict?: boolean;

	// Svelte 5 state getters/setters passed from .svelte files to enable reactivity
	getActiveIndex: () => number;
	setActiveIndex: (index: number) => void;
	getIsKeyboardNavigating: () => boolean;
	setIsKeyboardNavigating: (val: boolean) => void;
}

export function useKeyboardNav(config: KeyboardNavConfig) {
	let keyboardNavTimer: number | null = null;

	function setKeyboardNavFlag(): void {
		if (!config.enableMouseConflict) return;
		config.setIsKeyboardNavigating(true);
		if (keyboardNavTimer) {
			window.clearTimeout(keyboardNavTimer);
		}
		keyboardNavTimer = window.setTimeout(() => {
			config.setIsKeyboardNavigating(false);
		}, 150);
	}

	const cleanup = () => {
		if (keyboardNavTimer) {
			window.clearTimeout(keyboardNavTimer);
			keyboardNavTimer = null;
		}
		config.setIsKeyboardNavigating(false);
	};

	onDestroy(cleanup);

	function handleKeydown(e: KeyboardEvent): void {
		const count = config.selectableCount();
		const activeIndex = config.getActiveIndex();

		if (e.key === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation();
			if (count > 0) {
				setKeyboardNavFlag();
				config.setActiveIndex((activeIndex + 1) % count);
				config.scrollIntoView();
			}
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation();
			if (count > 0) {
				setKeyboardNavFlag();
				config.setActiveIndex((activeIndex - 1 + count) % count);
				config.scrollIntoView();
			}
		} else if (e.key === "Enter") {
			e.preventDefault();
			e.stopPropagation();
			config.onSelectCurrent();
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			config.onEscape();
		} else if (e.key === "Backspace" && config.onBack) {
			const handled = config.onBack();
			if (handled) {
				e.preventDefault();
				e.stopPropagation();
			}
		}
	}

	/**
	 * 주어진 리스트 컨테이너에서 `.is-active` 클래스를 가진 요소를 찾아
	 * 화면에 보이도록 스크롤합니다.
	 */
	async function scrollActiveIntoView(listEl: HTMLElement | null): Promise<void> {
		await tick();
		if (!listEl) return;
		const activeEl: HTMLElement | null = listEl.querySelector(".is-active");
		if (activeEl) {
			activeEl.scrollIntoView({ block: "nearest" });
		}
	}

	return {
		get activeIndex() { return config.getActiveIndex(); },
		set activeIndex(v: number) { config.setActiveIndex(v); },
		get isKeyboardNavigating() { return config.getIsKeyboardNavigating(); },
		resetIndex: () => { config.setActiveIndex(0); },
		handleKeydown,
		scrollActiveIntoView: (listEl: HTMLElement | null) => {
			void scrollActiveIntoView(listEl);
		},
		cleanup,
	};
}