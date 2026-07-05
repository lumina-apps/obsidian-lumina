import { Component, MarkdownRenderer, type App } from "obsidian";

/**
 * 마크다운 렌더링 헬퍼.
 * Message.svelte의 think/본문 렌더링에서 중복되는 패턴을 통합한다.
 *
 * 동작:
 * - streaming 중이면 plaintext로 표시 (comp 언로드)
 * - streaming 완료 후 role이 "assistant"이고 content가 있으면 MarkdownRenderer.render
 * - 그 외(role이 user 등)이면 plaintext
 * - 렌더링 후 태그(a.tag)에 클릭 이벤트를 바인딩하여 옵시디언 검색으로 이동
 */

/**
 * 옵시디언 검색 창을 열고 주어진 쿼리를 실행한다.
 */
function openTagSearch(app: App, query: string): void {
	const workspace = app.workspace as any;

	// 기존 search leaf가 있으면 재사용, 없으면 새로 생성
	let searchLeaf = workspace.getLeavesOfType("search")[0];
	if (!searchLeaf) {
		searchLeaf = workspace.getLeaf("tab");
		searchLeaf.setViewState({ type: "search" });
	}

	// SearchView의 setQuery로 쿼리 설정
	if (searchLeaf?.view?.setQuery) {
		searchLeaf.view.setQuery(query);
	}

	// 검색 탭 활성화
	workspace.revealLeaf(searchLeaf);
}

/**
 * 렌더링된 DOM에서 태그 링크(a.tag)를 찾아 클릭 이벤트를 바인딩한다.
 * 클릭 시 옵시디언 내부 검색을 열고 `tag:#태그명` 쿼리를 실행한다.
 */
function bindTagClickEvents(el: HTMLElement, app: App): void {
	const tagLinks = el.querySelectorAll("a.tag");
	tagLinks.forEach((link) => {
		const anchor = link as HTMLAnchorElement;
		// 이미 바인딩된 경우 건너뛰기
		if (anchor.dataset.luminaTagBound === "true") return;
		anchor.dataset.luminaTagBound = "true";

		anchor.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();

			// href에서 태그명 추출 (예: "#태그명" → "태그명")
			const href = anchor.getAttribute("href") ?? "";
			const tagName = href.replace(/^#+/, "").trim();
			if (!tagName) return;

			const searchQuery = `tag:#${tagName}`;
			openTagSearch(app, searchQuery);
		});
	});
}

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
			void MarkdownRenderer.render(app, content, el, "", comp).then(() => {
				bindTagClickEvents(el, app);
			});
		} else {
			if (compRef.current) {
				compRef.current.unload();
				compRef.current = null;
			}
			el.textContent = content;
		}
	}
}
