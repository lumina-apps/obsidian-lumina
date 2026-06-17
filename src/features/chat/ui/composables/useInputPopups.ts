/**
 * MCP 팝업 상태 관리를 위한 순수 헬퍼입니다.
 * $state 변수는 ChatInputArea.svelte에서 관리하며,
 * 여기서는 이벤트 핸들러 콜백을 제공합니다.
 */

export interface PopupHandlers {
	toggleMcpPopup: (e: MouseEvent) => void;
}

export type SetShowMcpPopup = (v: boolean | ((prev: boolean) => boolean)) => void;

/**
 * MCP 팝업 토글 핸들러를 생성합니다.
 * 이벤트 전파를 막고 showMcpPopup 상태를 토글합니다.
 */
export function handleMcpPopupToggle(
	setShowMcpPopup: SetShowMcpPopup,
): (e: MouseEvent) => void {
	return (e: MouseEvent) => {
		e.stopPropagation();
		setShowMcpPopup((prev) => !prev);
	};
}