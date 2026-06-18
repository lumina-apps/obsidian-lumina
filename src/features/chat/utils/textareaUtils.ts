/**
 * textarea 높이를 콘텐츠에 맞게 자동 조절합니다.
 * ChatInputArea와 ChatPanel에서 공통으로 사용됩니다.
 */
export function resizeTextarea(
	textareaEl: HTMLTextAreaElement | null,
	maxHeight = 160,
): void {
	if (!textareaEl) return;
	textareaEl.setCssStyles({ height: "auto" });
	textareaEl.setCssStyles({
		height: Math.min(textareaEl.scrollHeight, maxHeight) + "px",
	});
}
