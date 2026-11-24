import { describe, it, expect, vi, afterEach } from 'vitest';
import { App, Platform, Workspace, WorkspaceLeaf } from 'obsidian';
import {
	BATCH_STUDIO_VIEW_TYPE,
	GRAPH_VIEW_TYPE,
	SPLIT_CHAT_VIEW_TYPE,
} from '../constants/viewTypes';
import {
	PROTECTED_MAIN_VIEW_TYPES,
	openLinkTextSafely,
	resolveSafeLeafTarget,
	revealLeafOnMobile,
} from './workspaceNavUtils';

describe('workspaceNavUtils', () => {
	const origIsMobile = Platform.isMobile;

	afterEach(() => {
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		vi.restoreAllMocks();
	});

	it('PROTECTED_MAIN_VIEW_TYPES에 SplitChat, Graph, BatchStudio 뷰가 포함된다', () => {
		expect(PROTECTED_MAIN_VIEW_TYPES.has(SPLIT_CHAT_VIEW_TYPE)).toBe(true);
		expect(PROTECTED_MAIN_VIEW_TYPES.has(GRAPH_VIEW_TYPE)).toBe(true);
		expect(PROTECTED_MAIN_VIEW_TYPES.has(BATCH_STUDIO_VIEW_TYPE)).toBe(true);
	});

	describe('resolveSafeLeafTarget', () => {
		it('요청된 타깃이 false가 아니면 그대로 반환한다', () => {
			const workspace = { activeLeaf: null } as unknown as Workspace;
			expect(resolveSafeLeafTarget(workspace, true)).toBe(true);
			expect(resolveSafeLeafTarget(workspace, 'split')).toBe('split');
			expect(resolveSafeLeafTarget(workspace, 'tab')).toBe('tab');
		});

		it('활성 리프가 일반 마크다운 뷰이면 false를 유지한다', () => {
			const workspace = {
				activeLeaf: { view: { getViewType: () => 'markdown' } },
				getMostRecentLeaf: vi.fn(() => ({ view: { getViewType: () => 'markdown' } })),
			} as unknown as Workspace;

			expect(resolveSafeLeafTarget(workspace, false)).toBe(false);
		});

		it.each([SPLIT_CHAT_VIEW_TYPE, GRAPH_VIEW_TYPE, BATCH_STUDIO_VIEW_TYPE])(
			'활성 리프가 보호된 커스텀 뷰(%s)이면 tab을 반환한다',
			(viewType) => {
				const workspace = {
					activeLeaf: { view: { getViewType: () => viewType } },
					getMostRecentLeaf: vi.fn(),
				} as unknown as Workspace;

				expect(resolveSafeLeafTarget(workspace, false)).toBe('tab');
			},
		);

		it('activeLeaf가 없어도 mostRecentLeaf가 보호된 뷰이면 tab을 반환한다', () => {
			const workspace = {
				activeLeaf: null,
				getMostRecentLeaf: vi.fn(() => ({ view: { getViewType: () => GRAPH_VIEW_TYPE } })),
			} as unknown as Workspace;

			expect(resolveSafeLeafTarget(workspace, false)).toBe('tab');
		});
	});

	describe('revealLeafOnMobile', () => {
		it('모바일 환경에서는 revealLeaf를 호출해 사이드바 드로어를 닫는다', async () => {
			(Platform as { isMobile: boolean }).isMobile = true;
			const revealLeaf = vi.fn().mockResolvedValue(undefined);
			const workspace = { revealLeaf } as unknown as Workspace;
			const leaf = {} as WorkspaceLeaf;

			await revealLeafOnMobile(workspace, leaf);

			expect(revealLeaf).toHaveBeenCalledWith(leaf);
		});

		it('데스크탑 환경에서는 revealLeaf를 호출하지 않는다', async () => {
			(Platform as { isMobile: boolean }).isMobile = false;
			const revealLeaf = vi.fn().mockResolvedValue(undefined);
			const workspace = { revealLeaf } as unknown as Workspace;
			const leaf = {} as WorkspaceLeaf;

			await revealLeafOnMobile(workspace, leaf);

			expect(revealLeaf).not.toHaveBeenCalled();
		});
	});

	describe('openLinkTextSafely', () => {
		it('보호된 뷰가 활성화되어 있으면 tab 타깃으로 openLinkText를 호출하고 모바일에서 revealLeaf를 실행한다', async () => {
			(Platform as { isMobile: boolean }).isMobile = true;
			const openedLeaf = { view: { getViewType: () => 'markdown' } } as unknown as WorkspaceLeaf;
			const protectedLeaf = { view: { getViewType: () => SPLIT_CHAT_VIEW_TYPE } } as unknown as WorkspaceLeaf;
			const revealLeaf = vi.fn().mockResolvedValue(undefined);
			const openLinkText = vi.fn(async () => {
				mockWorkspace.activeLeaf = openedLeaf;
			});
			const mockWorkspace = {
				activeLeaf: protectedLeaf,
				getMostRecentLeaf: vi.fn(() => protectedLeaf),
				openLinkText,
				revealLeaf,
			};
			const app = { workspace: mockWorkspace } as unknown as App;

			await openLinkTextSafely(app, 'TargetNote', 'SourceNote.md', false);

			expect(openLinkText).toHaveBeenCalledWith('TargetNote', 'SourceNote.md', 'tab');
			expect(revealLeaf).toHaveBeenCalledWith(openedLeaf);
		});
	});
});
