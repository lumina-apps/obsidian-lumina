/**
 * 키보드 리스트 네비게이션 composable (Svelte 5).
 * ModelSelector, SlashCommandSelector 등에서 공통으로 사용하는
 * ArrowDown/Up, Enter, Escape 키보드 네비게이션 로직을 제공합니다.
 *
 * 각 호출마다 독립적인 클로저 상태(activeIndex, isKeyboardNavigating)를 반환합니다.
 * 호출하는 .svelte 컴포넌트에서 getter로 상태를 읽고 setter로 변경합니다.
 */

import { tick, onDestroy } from 'svelte';

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

	// Svelte 5 state getters/setters passed from .svelte files to enable reactivity
	getActiveIndex: () => number;
	setActiveIndex: (index: number) => void;
	getIsKeyboardNavigating: () => boolean;
	setIsKeyboardNavigating: (val: boolean) => void;
}

export function useKeyboardListNav(options: KeyboardListNavOptions) {
	let keyboardNavTimer: number | null = null;

	onDestroy(() => {
		if (keyboardNavTimer) {
			window.clearTimeout(keyboardNavTimer);
			keyboardNavTimer = null;
		}
	});

	function resetIndex(): void {
		options.setActiveIndex(0);
	}

	function setActiveIndex(index: number): void {
		options.setActiveIndex(index);
	}

	function setKeyboardNavFlag(): void {
		if (!options.enableMouseConflict) return;
		options.setIsKeyboardNavigating(true);
		if (keyboardNavTimer) window.clearTimeout(keyboardNavTimer);
		keyboardNavTimer = window.setTimeout(() => {
			options.setIsKeyboardNavigating(false);
		}, 150);
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (!options.isOpen()) return;
		const count = options.itemCount();
		const activeIndex = options.getActiveIndex();

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (count > 0) {
				setKeyboardNavFlag();
				options.setActiveIndex((activeIndex + 1) % count);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (count > 0) {
				setKeyboardNavFlag();
				options.setActiveIndex((activeIndex - 1 + count) % count);
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
		get activeIndex() { return options.getActiveIndex(); },
		get isKeyboardNavigating() { return options.getIsKeyboardNavigating(); },
		resetIndex,
		setActiveIndex,
		handleKeydown,
		scrollToActive: (listEl: HTMLDivElement | null) => {
			void scrollToActive(listEl);
		},
	};
}