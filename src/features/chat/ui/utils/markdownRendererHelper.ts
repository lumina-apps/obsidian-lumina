import { Component, MarkdownRenderer, type App } from "obsidian";

/**
 * 마크다운 렌더링 헬퍼.
 * Message.svelte의 think/본문 렌더링에서 중복되는 패턴을 통합한다.
 *
 * 동작:
 * - streaming 중이면 plaintext로 표시 (comp 언로드)
 * - streaming 완료 후 role이 "assistant"이고 content가 있으면 MarkdownRenderer.render
 * - 그 외(role이 user 등)이면 plaintext
 */
export function renderMessageContent(
	el: HTMLElement,
	compRef: { current: Component | null },
	app: App,
	content: string,
	isStreaming: boolean,
	role: string,
): void {
	if (isStreaming) {
		if (compRef.current) {
			compRef.current.unload();
			compRef.current = null;
		}
		el.textContent = content;
	} else {
		if (role === "assistant" && content) {
			compRef.current?.unload();
			const comp = new Component();
			comp.load();
			compRef.current = comp;
			el.empty();
			MarkdownRenderer.render(app, content, el, "", comp);
		} else {
			if (compRef.current) {
				compRef.current.unload();
				compRef.current = null;
			}
			el.textContent = content;
		}
	}
}