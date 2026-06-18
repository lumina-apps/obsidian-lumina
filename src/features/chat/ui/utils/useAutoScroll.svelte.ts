/**
 * useAutoScroll.svelte.ts
 *
 * 채팅 메시지 목록의 자동 스크롤을 관리하는 composable입니다.
 * 각 호출마다 독립적인 클로저 상태를 반환하며,
 * 호출하는 .svelte 컴포넌트에서 $effect로 반응형 연결을 구성합니다.
 *
 * 사용 예 (ChatPanel.svelte):
 *   const autoScroll = useAutoScroll(() => messagesEl);
 *   $effect(() => {
 *     messages;
 *     if (!autoScroll.isUserScrolledUp) {
 *       void autoScroll.scrollToBottom("auto");
 *     }
 *   });
 */

import { tick } from "svelte";

export function useAutoScroll(
	getMessagesEl: () => HTMLElement | null,
) {
	let isUserScrolledUp = false;
	let scrollRafId: number | null = null;
	let lastScrollTop = 0;

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
		get isUserScrolledUp() {
			return isUserScrolledUp;
		},
		handleScroll,
		scrollToBottom,
		resetUserScrolledUp,
	};
}