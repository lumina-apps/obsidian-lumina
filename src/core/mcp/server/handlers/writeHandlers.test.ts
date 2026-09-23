import { describe, it, expect, vi, beforeEach } from 'vitest';
import { patchNoteHandler, moveNoteHandler, saveAttachmentHandler } from './writeHandlers';
import { autoLinkNoteHandler } from './autoLinkHandlers';
import { PathGuard } from '../pathGuard';
import type { ToolHandlerContext } from '../toolTypes';
import { TFile } from 'obsidian';
import { approvalManager } from '../../../../features/chat/utils/approvalManager';

vi.mock('../../../../features/chat/utils/approvalManager', () => ({
	approvalManager: {
		requestApproval: vi.fn().mockResolvedValue({ approved: true, content: '' }),
		requestActionApproval: vi.fn().mockResolvedValue(true),
	},
}));

vi.mock('../../../../features/backup/backupManager', () => ({
	createBackup: vi.fn().mockResolvedValue(undefined),
}));

describe('writeHandlers', () => {
	let ctx: ToolHandlerContext;
	let pathGuard: PathGuard;
	let mockFiles: Map<string, { file: TFile; content: string }>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFiles = new Map();

		const addFile = (path: string, content: string) => {
			const file = new TFile();
			file.path = path;
			file.basename = path.replace(/\.md$/, '');
			file.extension = 'md';
			mockFiles.set(path, { file, content });
		};

		addFile('test.md', 'Initial equation: placeholder\nPrice: cost');
		addFile('existing.md', 'I already exist');

		const mockVault = {
			getAbstractFileByPath: vi.fn((path: string) => mockFiles.get(path)?.file || null),
			read: vi.fn(async (file: TFile) => mockFiles.get(file.path)?.content || ''),
			modify: vi.fn(async (file: TFile, newContent: string) => {
				const f = mockFiles.get(file.path);
				if (f) f.content = newContent;
			}),
			createBinary: vi.fn().mockResolvedValue(undefined),
			getMarkdownFiles: vi.fn(() => Array.from(mockFiles.values()).map(v => v.file)),
		};

		const mockFileManager = {
			renameFile: vi.fn().mockResolvedValue(undefined),
			processFrontMatter: vi.fn().mockResolvedValue(undefined),
		};

		const mockWorkspace = {
			getLeavesOfType: vi.fn().mockReturnValue([]),
			getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() }),
			setActiveLeaf: vi.fn(),
		};

		ctx = {
			plugin: {
				app: {
					vault: mockVault,
					fileManager: mockFileManager,
					workspace: mockWorkspace,
					metadataCache: {
						getFileCache: vi.fn().mockReturnValue(null),
					},
				},
				manifest: { version: '1.0.0' },
				settings: {
					misc: { autoFrontmatter: false },
					mcp: {},
				},
			} as any,
			limitRead: 20000,
			limitAppend: 10000,
			snippetLen: 300,
			maxResults: 50,
		};

		pathGuard = new PathGuard();
	});

	describe('patchNoteHandler - dollar sign preservation', () => {
		it('preserves dollar signs in math and currency replacements without corruption', async () => {
			vi.mocked(approvalManager.requestApproval).mockImplementation(async (_path, _cur, proposed) => {
				return { approved: true, content: proposed };
			});

			const res = await patchNoteHandler({
				path: 'test.md',
				target: 'placeholder',
				replacement: '$$x = 1$$',
			}, ctx, pathGuard);

			expect(res.isError).toBeFalsy();
			const modifiedContent = mockFiles.get('test.md')?.content;
			expect(modifiedContent).toContain('$$x = 1$$');
		});

		it('preserves $100 currency in replacement string', async () => {
			vi.mocked(approvalManager.requestApproval).mockImplementation(async (_path, _cur, proposed) => {
				return { approved: true, content: proposed };
			});

			const res = await patchNoteHandler({
				path: 'test.md',
				target: 'cost',
				replacement: '$100',
			}, ctx, pathGuard);

			expect(res.isError).toBeFalsy();
			const modifiedContent = mockFiles.get('test.md')?.content;
			expect(modifiedContent).toContain('$100');
		});
	});

	describe('moveNoteHandler', () => {
		it('rejects when sourcePath and targetPath are identical', async () => {
			const res = await moveNoteHandler({
				sourcePath: 'test.md',
				targetPath: 'test.md',
			}, ctx, pathGuard);

			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('identical');
		});

		it('rejects when targetPath already exists', async () => {
			const res = await moveNoteHandler({
				sourcePath: 'test.md',
				targetPath: 'existing.md',
			}, ctx, pathGuard);

			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('already exists');
		});
	});

	describe('saveAttachmentHandler', () => {
		it('strips data: URI prefix and whitespace before saving', async () => {
			const validBase64 = 'data:image/png;base64, SVRlc3Q= ';
			const res = await saveAttachmentHandler({
				path: 'attachment.png',
				base64Data: validBase64,
			}, ctx, pathGuard);

			expect(res.isError).toBeFalsy();
			expect(ctx.plugin.app.vault.createBinary).toHaveBeenCalled();
		});

		it('returns error on invalid base64 data instead of throwing exception', async () => {
			const invalidBase64 = '@@@invalid-base64@@@';
			const res = await saveAttachmentHandler({
				path: 'invalid.png',
				base64Data: invalidBase64,
			}, ctx, pathGuard);

			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('Invalid base64');
		});
	});

	describe('autoLinkNoteHandler', () => {
		it('requests user approval and saves when links can be generated', async () => {
			mockFiles.get('test.md')!.content = 'Here is a reference to existing in the text.';
			vi.mocked(approvalManager.requestApproval).mockImplementation(async (_p, _c, prop) => ({
				approved: true,
				content: prop,
			}));

			const res = await autoLinkNoteHandler({ path: 'test.md' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			expect(approvalManager.requestApproval).toHaveBeenCalled();
		});
	});
});
