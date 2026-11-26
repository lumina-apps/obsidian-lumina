import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import type LuminaPlugin from '../../../../main';
import { createProvider } from '../../../../core/llm-providers';
import { DEFAULT_SETTINGS } from '../../../../core/settings/defaultSettings';
import { getBatchState, resetBatchStore } from '../../../../core/store/batchStore';
import {
	archiveOrphanFiles,
	createOrAppendOrphanMoc,
	insertOrphanWikiLink,
	proposeAiContextualLink,
	recordOrphanHistory,
	trashOrphanFiles,
} from '../orphanActionService';

vi.mock('../../../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

function makeFile(path: string): TFile {
	const name = path.split('/').pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.md$/i, ''),
		extension: 'md',
		stat: { ctime: 0, mtime: 0, size: 100 },
	});
}

describe('orphanActionService', () => {
	let files: Record<string, TFile>;
	let contents: Record<string, string>;
	let mockApp: App;
	let mockPlugin: LuminaPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		resetBatchStore();

		const f1 = makeFile('Inbox/idea.md');
		const f2 = makeFile('Projects/hub.md');
		files = {
			'Inbox/idea.md': f1,
			'Projects/hub.md': f2,
		};
		contents = {
			'Inbox/idea.md': '# Idea\n좋은 아이디어 메모입니다.\n',
			'Projects/hub.md': '# Hub\n프로젝트 허브 노트입니다.\n',
		};

		mockApp = {
			vault: {
				configDir: '.obsidian',
				getMarkdownFiles: () => Object.values(files),
				getAbstractFileByPath: (p: string) => files[p] ?? null,
				read: vi.fn(async (f: TFile) => contents[f.path] ?? ''),
				modify: vi.fn(async (f: TFile, next: string) => {
					contents[f.path] = next;
				}),
				create: vi.fn(async (p: string, next: string) => {
					const created = makeFile(p);
					files[p] = created;
					contents[p] = next;
					return created;
				}),
				createFolder: vi.fn(async () => undefined),
				trash: vi.fn(async (f: TFile) => {
					delete files[f.path];
					delete contents[f.path];
				}),
			},
			metadataCache: {
				getFileCache: () => ({ frontmatter: {} }),
			},
			fileManager: {
				renameFile: vi.fn(async (f: TFile, newPath: string) => {
					const old = f.path;
					contents[newPath] = contents[old];
					delete contents[old];
					delete files[old];
					f.path = newPath;
					f.name = newPath.split('/').pop() ?? newPath;
					f.basename = f.name.replace(/\.md$/i, '');
					files[newPath] = f;
				}),
				trashFile: vi.fn(async (f: TFile) => {
					delete files[f.path];
					delete contents[f.path];
				}),
			},
		} as unknown as App;

		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
		settings.connections.providers = [
			{
				id: 'openai-1',
				type: 'openai',
				credential: 'key',
				availableModels: ['gpt-4o-mini'],
				isVerified: true,
			},
		];
		mockPlugin = { app: mockApp, settings } as unknown as LuminaPlugin;
	});

	it('insertOrphanWikiLink는 중복 없이 Related 섹션에 위키링크를 삽입하고 스냅샷을 반환한다', async () => {
		const res1 = await insertOrphanWikiLink(
			mockApp,
			files['Inbox/idea.md'],
			files['Projects/hub.md'],
			'from-orphan',
		);
		expect(res1.skipped).toBe(false);
		expect(contents['Inbox/idea.md']).toContain('## Related\n- [[hub]]');

		const res2 = await insertOrphanWikiLink(
			mockApp,
			files['Inbox/idea.md'],
			files['Projects/hub.md'],
			'from-orphan',
		);
		expect(res2.skipped).toBe(true);
	});

	it('archiveOrphanFiles와 trashOrphanFiles는 스냅샷과 함께 이동/휴지통 처리를 수행한다', async () => {
		const arc = await archiveOrphanFiles(
			mockApp,
			[files['Inbox/idea.md']],
			'Archive/Orphans',
		);
		expect(arc.movedCount).toBe(1);
		expect(files['Archive/Orphans/idea.md']).toBeDefined();
		expect(arc.snapshots[0].movedToPath).toBe('Archive/Orphans/idea.md');

		const trashedFile = files['Archive/Orphans/idea.md'];
		const trashed = await trashOrphanFiles(mockApp, [trashedFile]);
		expect(trashed.trashedCount).toBe(1);
		expect(trashed.snapshots[0].trashed).toBe(true);
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(trashedFile);
		expect(files['Archive/Orphans/idea.md']).toBeUndefined();

		recordOrphanHistory(trashed.snapshots, 'Trash 1 orphan');
		expect(getBatchState().history[0].source).toBe('orphan');
	});

	it('proposeAiContextualLink는 LLM의 anchorLine을 교체해 문맥 링크를 제안한다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: JSON.stringify({
					anchorLine: '프로젝트 허브 노트입니다.',
					replacementLine: '프로젝트 허브 노트입니다. 세부 아이디어는 [[idea]]를 참고하세요.',
					reason: '관련 아이디어를 본문에 자연스럽게 연결',
				}),
				usage: { totalTokens: 42 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		const proposal = await proposeAiContextualLink(
			mockApp,
			mockPlugin,
			files['Inbox/idea.md'],
			files['Projects/hub.md'],
			'to-orphan',
		);
		expect(proposal.modifiedFilePath).toBe('Projects/hub.md');
		expect(proposal.afterContent).toContain('[[idea]]');
		expect(proposal.tokensUsed).toBe(42);
	});

	it('createOrAppendOrphanMoc은 새 MOC 생성 후 재실행 시 누락 링크만 추가한다', async () => {
		const created = await createOrAppendOrphanMoc(
			mockApp,
			[files['Inbox/idea.md']],
			'MOCs/Orphans',
			'Orphan MOC',
			'folder',
		);
		expect(created.created).toBe(true);
		expect(created.addedCount).toBe(1);
		expect(contents['MOCs/Orphans.md']).toContain('[[idea]]');

		const extra = makeFile('Inbox/second.md');
		files['Inbox/second.md'] = extra;
		contents['Inbox/second.md'] = '두 번째';

		const appended = await createOrAppendOrphanMoc(
			mockApp,
			[files['Inbox/idea.md'], extra],
			'MOCs/Orphans.md',
			'Orphan MOC',
			'folder',
		);
		expect(appended.created).toBe(false);
		expect(appended.addedCount).toBe(1);
		expect(contents['MOCs/Orphans.md']).toContain('[[second]]');
	});
});
