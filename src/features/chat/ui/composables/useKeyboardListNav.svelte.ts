import { tick } from 'svelte';

export interface KeyboardListNavOptions {
	/** 드롭다운/팝업이 열려있는지 여부를 반환하는 getter */
	isOpen: () => boolean;
	/** 필터링된 항목 개수를 반환하는 getter */
	itemCount: () => number;
	/** activeIndex에 해당하는 항목 선택 시 호출 */
	onSelect: (index: number) => void;
	/** Escape 키로 닫을 때 호출 */
	onClose: () => void;
	/** 마우스 이동과 키보드 네비게이션 충돌 방지 플래그 사용 여부 (기본 false) */
	enableMouseConflict?: boolean;
}

export interface KeyboardListNavReturn {
	activeIndex: number;
	isKeyboardNavigating: boolean;
	resetIndex: () => void;
	setActiveIndex: (index: number) => void;
	handleKeydown: (e: KeyboardEvent) => void;
	scrollToActive: (listEl: HTMLDivElement | null) => void;
}

/**
 * 키보드 리스트 네비게이션 composable.
 * ModelSelector, SlashCommandSelector 등에서 공통으로 사용하는
 * ArrowDown/Up, Enter, Escape 키보드 네비게이션 로직을 제공합니다.
 *
 * Svelte 5 runes 기반입니다 ($state, $derived).
 */
export function useKeyboardListNav(options: KeyboardListNavOptions): KeyboardListNavReturn {
	let activeIndex = $state(0);
	let isKeyboardNavigating = $state(false);
	let keyboardNavTimer: ReturnType<typeof setTimeout> | null = null;

	function resetIndex(): void {
		activeIndex = 0;
	}

	function setActiveIndex(index: number): void {
		activeIndex = index;
	}

	function setKeyboardNavFlag(): void {
		if (!options.enableMouseConflict) return;
		isKeyboardNavigating = true;
		if (keyboardNavTimer) clearTimeout(keyboardNavTimer);
		keyboardNavTimer = setTimeout(() => {
			isKeyboardNavigating = false;
		}, 150);
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (!options.isOpen()) return;
		const count = options.itemCount();

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (count > 0) {
				setKeyboardNavFlag();
				activeIndex = (activeIndex + 1) % count;
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (count > 0) {
				setKeyboardNavFlag();
				activeIndex = (activeIndex - 1 + count) % count;
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			options.onSelect(activeIndex);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			options.onClose();
		}
	}

	async function scrollToActive(listEl: HTMLDivElement | null): Promise<void> {
		await tick();
		if (!listEl) return;
		const activeEl = listEl.querySelector('.is-active') as HTMLElement;
		if (activeEl) {
			activeEl.scrollIntoView({ block: 'nearest' });
		}
	}

	return {
		get activeIndex() {
			return activeIndex;
		},
		get isKeyboardNavigating() {
			return isKeyboardNavigating;
		},
		resetIndex,
		setActiveIndex,
		handleKeydown,
		scrollToActive,
	};
}