/**
 * 키보드 네비게이션 공통 유틸리티.
 * ContextSelector, SlashCommandSelector 등에서 재사용 가능.
 */

/** 키보드 네비게이션 활성 상태를 추적하기 위한 상태 객체 */
export interface KeyboardNavState {
	isKeyboardNavigating: boolean;
	keyboardNavTimer: number | null;
}

/** 키보드 네비게이션 상태 초기값을 생성합니다. */
export function createKeyboardNavState(): KeyboardNavState {
	return {
		isKeyboardNavigating: false,
		keyboardNavTimer: null,
	};
}

/**
 * 키보드 네비게이션 플래그를 설정하고, 일정 시간 후 자동으로 해제합니다.
 * 마우스 무브 이벤트가 키보드 네비게이션 인덱스를 덮어쓰는 것을 방지합니다.
 */
export function setKeyboardNav(state: KeyboardNavState): void {
	state.isKeyboardNavigating = true;
	if (state.keyboardNavTimer) {
		window.clearTimeout(state.keyboardNavTimer);
	}
	state.keyboardNavTimer = window.setTimeout(() => {
		state.isKeyboardNavigating = false;
	}, 150);
}

/**
 * 키보드 네비게이션 상태를 정리(타이머 해제)합니다.
 */
export function clearKeyboardNav(state: KeyboardNavState): void {
	if (state.keyboardNavTimer) {
		window.clearTimeout(state.keyboardNavTimer);
		state.keyboardNavTimer = null;
	}
	state.isKeyboardNavigating = false;
}

/** 키보드 네비게이션 핸들러 구성 */
export interface KeyboardNavConfig {
	/** 현재 선택 가능한 항목 수를 반환하는 함수 */
	selectableCount: () => number;
	/** 활성 인덱스를 읽고 쓰기 위한 접근자 */
	activeIndex: {
		get: () => number;
		set: (v: number) => void;
	};
	/** 현재 선택된 항목을 실행하는 함수 (Enter 시) */
	onSelectCurrent: () => void;
	/** 닫기 동작 (Escape 시) */
	onEscape: () => void;
	/** 뒤로 가기 동작 (Backspace 시, 선택 사항) */
	onBack?: () => void;
	/** 활성 항목을 뷰로 스크롤하는 함수 */
	scrollIntoView: () => void;
	/** 키보드 네비게이션 상태 */
	navState: KeyboardNavState;
}

/**
 * 키보드 이벤트 핸들러를 생성하는 팩토리 함수입니다.
 * ArrowUp/Down으로 활성 인덱스를 이동하고, Enter로 선택, Escape로 닫습니다.
 */
export function createKeyboardNavHandler(config: KeyboardNavConfig): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		const count = config.selectableCount();

		if (e.key === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation();
			if (count > 0) {
				setKeyboardNav(config.navState);
				config.activeIndex.set((config.activeIndex.get() + 1) % count);
				config.scrollIntoView();
			}
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation();
			if (count > 0) {
				setKeyboardNav(config.navState);
				config.activeIndex.set(
					(config.activeIndex.get() - 1 + count) % count,
				);
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
			e.preventDefault();
			e.stopPropagation();
			config.onBack();
		}
	};
}

/**
 * 주어진 리스트 컨테이너에서 `.is-active` 클래스를 가진 요소를 찾아
 * 화면에 보이도록 스크롤합니다.
 */
export function scrollActiveIntoView(listEl: HTMLElement | null): void {
	if (!listEl) return;
	const activeEl: HTMLElement | null = listEl.querySelector(".is-active");
	if (activeEl) {
		activeEl.scrollIntoView({ block: "nearest" });
	}
}