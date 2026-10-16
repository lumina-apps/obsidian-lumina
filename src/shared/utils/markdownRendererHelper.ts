import { Component, MarkdownRenderer, Keymap, type App, type WorkspaceLeaf } from 'obsidian';
import { toVaultRelativePath } from './fileUtils';

interface SearchView {
	setQuery?: (query: string) => void;
}

export interface ResolvedLink {
	type: 'tag' | 'internal' | 'external';
	target: string;
}

/**
 * 마크다운 렌더링 헬퍼.
 * Message.svelte 등의 think/본문 렌더링에서 사용됩니다.
 *
 * 동작:
 * - streaming 중이면 plaintext로 표시 (comp 언로드)
 * - streaming 완료 후 role이 "assistant"이고 content가 있으면 MarkdownRenderer.render
 * - 그 외(role이 user 등)이면 plaintext
 * - 렌더링 후 링크(위키링크, file:// 볼트 경로, 마크다운 링크, 태그) 클릭 및 호버 미리보기 바인딩
 */

/**
 * 옵시디언 검색 창을 열고 주어진 쿼리를 실행한다.
 */
export function openTagSearch(app: App, query: string): void {
	const workspace = app.workspace;

	// 기존 search leaf가 있으면 재사용, 없으면 새로 생성
	let searchLeaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType('search')[0];
	if (!searchLeaf) {
		searchLeaf = workspace.getLeaf('tab');
		if (searchLeaf) {
			void searchLeaf.setViewState({ type: 'search' });
		}
	}

	if (!searchLeaf) return;

	// SearchView의 setQuery로 쿼리 설정
	const view = searchLeaf.view as unknown as SearchView;
	if (typeof view.setQuery === 'function') {
		view.setQuery(query);
	}

	// 검색 탭 활성화
	void workspace.revealLeaf(searchLeaf);
}

/**
 * 링크의 href 및 data-href 속성을 분석하여 태그, 외부 URL, 볼트 내부 문서 링크로 해석합니다.
 */
export function resolveLinkTarget(href: string, dataHref: string | null, app: App): ResolvedLink {
	// 1. 태그 링크 (#태그 또는 a.tag)
	if (href.startsWith('#') || (!href && dataHref?.startsWith('#'))) {
		const tag = (href || dataHref || '').replace(/^#+/, '').trim();
		return { type: 'tag', target: tag };
	}

	// 2. 외부 웹 URL
	if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
		return { type: 'external', target: href };
	}

	// 3. file:// 로컬 볼트 절대 경로 링크
	if (/^file:\/\//i.test(href)) {
		let clean = decodeURIComponent(href.replace(/^file:\/\//i, ''));
		// Windows 드라이브 경로 처리 (/C:/path -> C:/path)
		if (/^\/[a-zA-Z]:\//.test(clean)) {
			clean = clean.slice(1);
		}
		const rel = toVaultRelativePath(app, clean);
		return { type: 'internal', target: rel || clean };
	}

	// 4. 내부 위키링크 또는 상대 마크다운 링크
	const rawTarget = dataHref || href;
	const decoded = decodeURIComponent(rawTarget);
	const rel = toVaultRelativePath(app, decoded);
	return { type: 'internal', target: rel || decoded };
}

/**
 * 링크 클릭 및 보조 클릭(마우스 휠 클릭) 핸들러.
 */
function handleLinkClick(e: MouseEvent, app: App, container: HTMLElement): void {
	const target = e.target as HTMLElement | null;
	const anchor = target?.closest('a') as HTMLAnchorElement | null;
	if (!anchor || !container.contains(anchor)) return;

	const href = anchor.getAttribute('href') ?? '';
	const dataHref = anchor.getAttribute('data-href');
	if (!href && !dataHref) return;

	e.preventDefault();
	e.stopPropagation();

	const resolved = resolveLinkTarget(href, dataHref, app);

	if (resolved.type === 'tag') {
		if (resolved.target) {
			openTagSearch(app, `tag:#${resolved.target}`);
		}
		return;
	}

	if (resolved.type === 'external') {
		if (resolved.target) {
			window.open(resolved.target, '_blank');
		}
		return;
	}

	if (resolved.type === 'internal' && resolved.target) {
		const isMod = (typeof Keymap !== 'undefined' && typeof Keymap?.isModEvent === 'function')
			? Keymap.isModEvent(e)
			: Boolean(e.ctrlKey || e.metaKey);
		const newLeaf = isMod || e.button === 1;

		void app.workspace.openLinkText(resolved.target, '', newLeaf ? 'tab' : false);
	}
}

/**
 * 마우스오버 시 옵시디언 네이티브 페이지 미리보기(Page Preview) 호버 이벤트를 트리거합니다.
 */
function handleLinkMouseOver(e: MouseEvent, app: App, container: HTMLElement): void {
	const target = e.target as HTMLElement | null;
	const anchor = target?.closest('a') as HTMLAnchorElement | null;
	if (!anchor || !container.contains(anchor)) return;
	if (anchor.classList.contains('tag')) return;

	const href = anchor.getAttribute('href') ?? '';
	const dataHref = anchor.getAttribute('data-href');
	if (!href && !dataHref) return;

	const resolved = resolveLinkTarget(href, dataHref, app);
	if (resolved.type === 'internal' && resolved.target) {
		app.workspace.trigger('hover-link', {
			event: e,
			source: 'lumina-chat',
			hoverParent: container,
			targetEl: anchor,
			linktext: resolved.target,
			sourcePath: '',
		});
	}
}

/**
 * 메시지 컨테이너에 링크 클릭 및 호버 이벤트 위임을 바인딩합니다.
 */
export function bindContainerLinkEvents(el: HTMLElement, app: App): void {
	if (el.dataset.luminaLinksBound === 'true') return;
	el.dataset.luminaLinksBound = 'true';

	el.addEventListener('click', (e) => handleLinkClick(e, app, el));
	el.addEventListener('auxclick', (e) => {
		if (e.button === 1) {
			handleLinkClick(e, app, el);
		}
	});
	el.addEventListener('mouseover', (e) => handleLinkMouseOver(e, app, el));
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
		if (role === 'assistant' && content) {
			compRef.current?.unload();
			const comp = new Component();
			comp.load();
			compRef.current = comp;
			el.empty();
			void MarkdownRenderer.render(app, content, el, '', comp).then(() => {
				bindContainerLinkEvents(el, app);
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

