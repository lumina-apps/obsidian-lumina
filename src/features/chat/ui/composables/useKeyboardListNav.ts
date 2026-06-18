import { tick } from 'svelte';

/**
 * 외부에서 관리되는 reactive state 접근자.
 * Svelte 5 runes ($state)로부터 getter/setter를 전달받습니다.
 */
export interface ReactiveState<T> {
	get: () => T;
	set: (value: T) => void;
}

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
	/** 외부에서 $state()로 관리되는 activeIndex 접근자 */
	activeIndex: ReactiveState<number>;
	/** 외부에서 $state()로 관리되는 isKeyboardNavigating 접근자 */
	isKeyboardNavigating: ReactiveState<boolean>;
}

export interface KeyboardListNavReturn {
	get activeIndex(): number;
	get isKeyboardNavigating(): boolean;
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
 * reactive state ($state)는 호출 측(Svelte 컴포넌트)에서 생성하여
 * getter/setter 형태로 전달합니다.
 */
export function useKeyboardListNav(options: KeyboardListNavOptions): KeyboardListNavReturn {
	let keyboardNavTimer: number | null = null;

	function resetIndex(): void {
		options.activeIndex.set(0);
	}

	function setActiveIndex(index: number): void {
		options.activeIndex.set(index);
	}

	function setKeyboardNavFlag(): void {
		if (!options.enableMouseConflict) return;
		options.isKeyboardNavigating.set(true);
		if (keyboardNavTimer) window.clearTimeout(keyboardNavTimer);
		keyboardNavTimer = window.setTimeout(() => {
			options.isKeyboardNavigating.set(false);
		}, 150);
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (!options.isOpen()) return;
		const count = options.itemCount();
		const idx = options.activeIndex.get();

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (count > 0) {
				setKeyboardNavFlag();
				options.activeIndex.set((idx + 1) % count);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (count > 0) {
				setKeyboardNavFlag();
				options.activeIndex.set((idx - 1 + count) % count);
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			options.onSelect(idx);
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
			return options.activeIndex.get();
		},
		get isKeyboardNavigating() {
			return options.isKeyboardNavigating.get();
		},
		resetIndex,
		setActiveIndex,
		handleKeydown,
		scrollToActive: (listEl: HTMLDivElement | null) => {
			void scrollToActive(listEl);
		},
	};
}