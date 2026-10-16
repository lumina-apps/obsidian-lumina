import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, MarkdownRenderer, Keymap } from 'obsidian';
import {
	resolveLinkTarget,
	bindContainerLinkEvents,
	renderMessageContent,
	openTagSearch,
} from './markdownRendererHelper';

describe('markdownRendererHelper', () => {
	let mockApp: App;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApp = new App();
		// Set up mock vault adapter basePath
		(mockApp.vault.adapter as unknown as { getBasePath: () => string }).getBasePath = vi
			.fn()
			.mockReturnValue('/Users/haein/Documents/Vault');
	});

	describe('resolveLinkTarget', () => {
		it('해시태그 링크를 올바르게 태그 타입으로 분류한다', () => {
			const res1 = resolveLinkTarget('#세계관', null, mockApp);
			expect(res1).toEqual({ type: 'tag', target: '세계관' });

			const res2 = resolveLinkTarget('', '#요리', mockApp);
			expect(res2).toEqual({ type: 'tag', target: '요리' });
		});

		it('외부 웹 URL(http, https, mailto)을 올바르게 외부 링크로 분류한다', () => {
			const res1 = resolveLinkTarget('https://obsidian.md', null, mockApp);
			expect(res1).toEqual({ type: 'external', target: 'https://obsidian.md' });

			const res2 = resolveLinkTarget('http://example.com', null, mockApp);
			expect(res2).toEqual({ type: 'external', target: 'http://example.com' });

			const res3 = resolveLinkTarget('mailto:user@example.com', null, mockApp);
			expect(res3).toEqual({ type: 'external', target: 'mailto:user@example.com' });
		});

		it('file:// 볼트 내 절대 경로를 볼트 상대 경로로 변환한다', () => {
			const rawHref = 'file:///Users/haein/Documents/Vault/01_%EC%84%B8%EA%B3%84%EA%B4%80/%EC%84%B8%EA%B3%84%EA%B4%80_%EA%B8%B0%EB%B3%B8.md';
			const res = resolveLinkTarget(rawHref, null, mockApp);
			expect(res).toEqual({
				type: 'internal',
				target: '01_세계관/세계관_기본.md',
			});
		});

		it('내부 위키링크(data-href)를 정상 파싱한다', () => {
			const res = resolveLinkTarget('세계관_기본', '세계관_기본', mockApp);
			expect(res).toEqual({
				type: 'internal',
				target: '세계관_기본',
			});
		});

		it('상대 마크다운 파일 경로를 정상 파싱한다', () => {
			const res = resolveLinkTarget('dump1/Art/Painting/note.md', null, mockApp);
			expect(res).toEqual({
				type: 'internal',
				target: 'dump1/Art/Painting/note.md',
			});
		});
	});

	describe('bindContainerLinkEvents', () => {
		it('내부 링크 일반 클릭 시 openLinkText(..., "", false)를 호출한다', () => {
			const container = document.createElement('div');
			const link = document.createElement('a');
			link.setAttribute('href', 'file:///Users/haein/Documents/Vault/01_세계관/세계관_기본.md');
			link.textContent = '세계관_기본.md';
			container.appendChild(link);

			bindContainerLinkEvents(container, mockApp);

			const event = new MouseEvent('click', { bubbles: true, cancelable: true });
			link.dispatchEvent(event);

			expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
				'01_세계관/세계관_기본.md',
				'',
				false,
			);
		});

		it('Cmd/Ctrl 클릭 시 새 탭("tab")으로 문서를 연다', () => {
			const container = document.createElement('div');
			const link = document.createElement('a');
			link.setAttribute('data-href', '세계관_기본');
			container.appendChild(link);

			bindContainerLinkEvents(container, mockApp);

			(Keymap.isModEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

			const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
			link.dispatchEvent(event);

			expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
				'세계관_기본',
				'',
				'tab',
			);
		});

		it('외부 링크 클릭 시 window.open을 호출한다', () => {
			const container = document.createElement('div');
			const link = document.createElement('a');
			link.setAttribute('href', 'https://github.com');
			container.appendChild(link);

			bindContainerLinkEvents(container, mockApp);

			const spyOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

			const event = new MouseEvent('click', { bubbles: true, cancelable: true });
			link.dispatchEvent(event);

			expect(spyOpen).toHaveBeenCalledWith('https://github.com', '_blank');
			spyOpen.mockRestore();
		});

		it('태그 클릭 시 openTagSearch를 통해 검색 탭을 연다', () => {
			const container = document.createElement('div');
			const link = document.createElement('a');
			link.className = 'tag';
			link.setAttribute('href', '#세계관');
			container.appendChild(link);

			const mockSearchLeaf = {
				view: { setQuery: vi.fn() },
			};
			(mockApp.workspace.getLeavesOfType as unknown as ReturnType<typeof vi.fn>).mockReturnValue([mockSearchLeaf]);

			bindContainerLinkEvents(container, mockApp);

			const event = new MouseEvent('click', { bubbles: true, cancelable: true });
			link.dispatchEvent(event);

			expect(mockSearchLeaf.view.setQuery).toHaveBeenCalledWith('tag:#세계관');
			expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockSearchLeaf);
		});

		it('내부 링크 마우스오버 시 hover-link 이벤트를 트리거한다', () => {
			const container = document.createElement('div');
			const link = document.createElement('a');
			link.className = 'internal-link';
			link.setAttribute('data-href', '요리_기초');
			container.appendChild(link);

			bindContainerLinkEvents(container, mockApp);

			const event = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
			link.dispatchEvent(event);

			expect(mockApp.workspace.trigger).toHaveBeenCalledWith('hover-link', {
				event,
				source: 'lumina-chat',
				hoverParent: container,
				targetEl: link,
				linktext: '요리_기초',
				sourcePath: '',
			});
		});
	});

	describe('renderMessageContent', () => {
		it('스트리밍 중에는 텍스트로만 렌더링한다', () => {
			const el = document.createElement('div');
			const compRef = { current: null };

			renderMessageContent(el, compRef, mockApp, '스트리밍 중...', true, 'assistant');

			expect(el.textContent).toBe('스트리밍 중...');
			expect(MarkdownRenderer.render).not.toHaveBeenCalled();
		});

		it('스트리밍이 완료된 assistant 메시지는 MarkdownRenderer를 호출한다', async () => {
			const el = document.createElement('div');
			const compRef = { current: null };
			(MarkdownRenderer.render as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

			renderMessageContent(el, compRef, mockApp, '완료된 마크다운', false, 'assistant');

			expect(MarkdownRenderer.render).toHaveBeenCalledWith(
				mockApp,
				'완료된 마크다운',
				el,
				'',
				expect.anything(),
			);
		});
	});
});
