/**
 * useAutoScroll.ts
 *
 * 채팅 메시지 목록의 자동 스크롤을 관리하는 유틸리티.
 * Svelte 5 rune($state, $effect)을 사용하지 않는 순수 함수로,
 * ChatPanel.svelte에서 상태와 effect를 연결하여 사용합니다.
 */

import { tick } from "svelte";

export interface AutoScrollState {
	readonly isUserScrolledUp: boolean;
}

export interface AutoScrollController {
	/** 현재 스크롤 상태 */
	state: AutoScrollState;
	/** 스크롤 이벤트 핸들러 - messagesEl의 onscroll에 바인딩 */
	handleScroll(): void;
	/** 메시지 컨테이너를 하단으로 스크롤 */
	scrollToBottom(behavior?: ScrollBehavior): Promise<void>;
	/** 사용자 스크롤 상태 초기화 */
	resetUserScrolledUp(): void;
}

/**
 * 자동 스크롤 컨트롤러를 생성합니다.
 * 반환된 controller를 ChatPanel의 $effect에서 사용해
 * messages 변경 시 자동 스크롤을 트리거해야 합니다.
 */
export function createAutoScroll(
	getMessagesEl: () => HTMLElement | null,
): AutoScrollController {
	let isUserScrolledUp = false;
	let lastScrollTop = 0;
	let scrollRafId: number | null = null;

	function handleScroll(): void {
		if (scrollRafId !== null) return;
		const el = getMessagesEl();
		if (!el) return;

		scrollRafId = window.requestAnimationFrame(() => {
			scrollRafId = null;
			const el2 = getMessagesEl();
			if (!el2) return;
			const { scrollTop, scrollHeight, clientHeight } = el2;
			if (scrollTop < lastScrollTop && scrollHeight - scrollTop - clientHeight > 40) {
				isUserScrolledUp = true;
			} else if (scrollHeight - scrollTop - clientHeight <= 40) {
				isUserScrolledUp = false;
			}
			lastScrollTop = scrollTop;
		});
	}

	async function scrollToBottom(behavior: ScrollBehavior = "smooth"): Promise<void> {
		await tick();
		const el = getMessagesEl();
		el?.scrollTo({ top: el.scrollHeight, behavior });
	}

	function resetUserScrolledUp(): void {
		isUserScrolledUp = false;
	}

	return {
		state: {
			get isUserScrolledUp() {
				return isUserScrolledUp;
			},
		},
		handleScroll,
		scrollToBottom,
		resetUserScrolledUp,
	};
}