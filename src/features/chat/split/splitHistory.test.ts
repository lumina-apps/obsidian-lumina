import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';
import { loadSessionsList } from '../history';
import {
	saveSplitSession,
	loadSplitSessionsList,
	loadSplitSession,
	renameSplitSession,
	deleteSplitSession,
	exportSplitSessionToMarkdown,
	normalizeSplitBasePath,
} from './splitHistory';
import type { SplitChatSession } from '../../../shared/types/splitChat.types';

function createMockApp() {
	const virtualFiles = new Map<string, { content: string; file: TFile }>();
	const createdFolders = new Set<string>();

	const mockLeaf = { openFile: vi.fn().mockResolvedValue(undefined) };

	const mockApp = {
		vault: {
			adapter: {
				exists: vi.fn().mockImplementation(async (path: string) => {
					const clean = path.replace(/\/+$/, '');
					if (createdFolders.has(clean) || virtualFiles.has(clean)) return true;
					for (const fp of virtualFiles.keys()) {
						if (fp.startsWith(clean + '/')) return true;
					}
					return false;
				}),
			},
			createFolder: vi.fn().mockImplementation(async (path: string) => {
				createdFolders.add(path.replace(/\/+$/, ''));
			}),
			getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
				const clean = path.replace(/[/\\]+$/, '');
				if (virtualFiles.has(clean)) {
					return virtualFiles.get(clean)!.file;
				}
				const hasFolder =
					createdFolders.has(clean) ||
					Array.from(virtualFiles.keys()).some((fp) => fp.startsWith(clean + '/'));
				if (!hasFolder) return null;

				const folder = new TFolder();
				folder.path = clean;
				folder.name = clean.split('/').pop() || clean;
				for (const [fp, data] of virtualFiles.entries()) {
					if (fp.startsWith(clean + '/')) {
						folder.children.push(data.file);
					}
				}
				return folder;
			}),
			create: vi.fn().mockImplementation(async (filePath: string, content: string) => {
				const file = new TFile();
				file.path = filePath;
				file.name = filePath.split('/').pop()!;
				file.extension = 'md';
				file.stat = { ctime: Date.now(), mtime: Date.now(), size: content.length };
				virtualFiles.set(filePath, { content, file });
				return file;
			}),
			modify: vi.fn().mockImplementation(async (file: TFile, content: string) => {
				virtualFiles.set(file.path, { content, file });
			}),
			read: vi.fn().mockImplementation(async (file: TFile) => {
				return virtualFiles.get(file.path)?.content || '';
			}),
			cachedRead: vi.fn().mockImplementation(async (file: TFile) => {
				return virtualFiles.get(file.path)?.content || '';
			}),
			rename: vi.fn().mockImplementation(async (file: TFile, newPath: string) => {
				const data = virtualFiles.get(file.path);
				if (data) {
					virtualFiles.delete(file.path);
					data.file.path = newPath;
					data.file.name = newPath.split('/').pop()!;
					virtualFiles.set(newPath, data);
				}
			}),
		},
		metadataCache: {
			getFileCache: vi.fn().mockReturnValue(null),
		},
		fileManager: {
			trashFile: vi.fn().mockImplementation(async (file: TFile) => {
				virtualFiles.delete(file.path);
			}),
		},
		workspace: {
			getLeaf: vi.fn().mockReturnValue(mockLeaf),
		},
	} as unknown as App;

	return { mockApp, virtualFiles, createdFolders, mockLeaf };
}

function makeSession(id = 'split-sess-1', title = '비교 테스트'): SplitChatSession {
	return {
		id,
		sessionType: 'split',
		title,
		mode: 'side-by-side',
		contextMode: 'independent',
		createdAt: 1700000000000,
		updatedAt: 1700000001000,
		slots: [
			{ slotId: 's1', label: 'A', providerId: 'openai', modelId: 'gpt-4o' },
			{ slotId: 's2', label: 'B', providerId: 'anthropic', modelId: 'claude-sonnet' },
		],
		turns: [
			{
				id: 't1',
				userMessage: {
					id: 'u1',
					role: 'user',
					content: '질문입니다',
					isStreaming: false,
					timestamp: 1700000000000,
				},
				ragStep: null,
				isRevealed: true,
				winnerSlotId: 's1',
				responses: {
					s1: {
						slotId: 's1',
						providerId: 'openai',
						modelId: 'gpt-4o',
						status: 'done',
						content: '답변 A',
						metrics: { startedAt: 1000, finishedAt: 2000, durationMs: 1000 },
					},
					s2: {
						slotId: 's2',
						providerId: 'anthropic',
						modelId: 'claude-sonnet',
						status: 'done',
						content: '답변 B',
						metrics: { startedAt: 1000, finishedAt: 2500, durationMs: 1500 },
					},
				},
			},
		],
	};
}

describe('splitHistory', () => {
	let ctx: ReturnType<typeof createMockApp>;

	beforeEach(() => {
		ctx = createMockApp();
	});

	it('split 폴더가 존재하지 않으면 폴더를 생성하지 않고 빈 목록을 반환한다', async () => {
		expect(normalizeSplitBasePath('chatHistory')).toBe('chatHistory/split');
		const list = await loadSplitSessionsList(ctx.mockApp, 'chatHistory');
		expect(list).toEqual([]);
		expect(ctx.createdFolders.size).toBe(0);
	});

	it('Split 세션 저장·목록·복원·이름변경·삭제가 동작하고 일반 채팅 loadSessionsList에서 완전히 격리된다', async () => {
		const session = makeSession();
		await saveSplitSession(ctx.mockApp, session, 'chatHistory', { folderFormat: '{{YYYY}}/{{MM}}' });

		// 일반 채팅 히스토리 로더에서는 sessionType === 'split' 파일이 절대 포함되지 않아야 함
		const regularSessions = await loadSessionsList(ctx.mockApp, 'chatHistory');
		expect(regularSessions).toEqual([]);

		const splitList = await loadSplitSessionsList(ctx.mockApp, 'chatHistory');
		expect(splitList).toHaveLength(1);
		expect(splitList[0].id).toBe('split-sess-1');
		expect(splitList[0].title).toBe('비교 테스트');
		expect(splitList[0].modelLabels).toEqual(['gpt-4o', 'claude-sonnet']);
		expect(splitList[0].hasWinner).toBe(true);
		expect(splitList[0].turnCount).toBe(1);

		const restored = await loadSplitSession(ctx.mockApp, 'split-sess-1', 'chatHistory');
		expect(restored).not.toBeNull();
		expect(restored?.turns[0].responses['s1'].content).toBe('답변 A');

		const renamed = await renameSplitSession(ctx.mockApp, 'split-sess-1', '새 비교 제목', 'chatHistory');
		expect(renamed?.title).toBe('새 비교 제목');

		const deleted = await deleteSplitSession(ctx.mockApp, 'split-sess-1', 'chatHistory');
		expect(deleted).toBe(true);
		expect(await loadSplitSessionsList(ctx.mockApp, 'chatHistory')).toEqual([]);
	});

	it('exportSplitSessionToMarkdown은 Lumina Exports 폴더에 비교 리포트를 저장하고 새 탭으로 연다', async () => {
		const session = makeSession();
		const file = await exportSplitSessionToMarkdown(ctx.mockApp, session);
		expect(file.path).toContain('Lumina Exports/');
		expect(file.path).toContain('[Arena]');
		expect(ctx.mockLeaf.openFile).toHaveBeenCalledWith(file);
	});
});
