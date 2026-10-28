import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNoteHandler, appendToDailyNoteHandler, patchNoteHandler, moveNoteHandler, saveAttachmentHandler, updateFrontmatterHandler } from './writeHandlers';
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
			create: vi.fn().mockResolvedValue(undefined),
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

		it('returns error when target appears multiple times without replaceAll', async () => {
			mockFiles.get('test.md')!.content = 'item line\nitem line\n';
			const res = await patchNoteHandler({
				path: 'test.md',
				target: 'item line',
				replacement: 'new line',
			}, ctx, pathGuard);

			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('appears 2 times');
			expect(text).toContain('replaceAll: true');
		});

		it('replaces all occurrences when replaceAll is true', async () => {
			mockFiles.get('test.md')!.content = 'item line\nitem line\n';
			vi.mocked(approvalManager.requestApproval).mockImplementation(async (_path, _cur, proposed) => {
				return { approved: true, content: proposed };
			});

			const res = await patchNoteHandler({
				path: 'test.md',
				target: 'item line',
				replacement: 'new line',
				replaceAll: true,
			}, ctx, pathGuard);

			expect(res.isError).toBeFalsy();
			const modified = mockFiles.get('test.md')?.content;
			expect(modified).toBe('new line\nnew line\n');
		});

		it('패치 후 파일 크기가 MCP_MAX_FILE_LENGTH를 초과하면 에러를 반환한다', async () => {
			mockFiles.get('test.md')!.content = 'target line';
			const res = await patchNoteHandler({
				path: 'test.md',
				target: 'target line',
				replacement: 'A'.repeat(100001),
			}, ctx, pathGuard);

			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('100,000');
		});

		it('ctx.signal이 제공되면 approvalManager.requestApproval에 전달된다', async () => {
			const controller = new AbortController();
			const ctxWithSignal = { ...ctx, signal: controller.signal };

			await patchNoteHandler({
				path: 'test.md',
				target: 'placeholder',
				replacement: 'replaced',
			}, ctxWithSignal, pathGuard);

			expect(approvalManager.requestApproval).toHaveBeenCalledWith(
				'test.md',
				expect.anything(),
				expect.anything(),
				expect.objectContaining({ signal: controller.signal }),
			);
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

		it('returns error when base64Data is missing or empty', async () => {
			const res = await saveAttachmentHandler({
				path: 'empty.png',
				base64Data: '   ',
			}, ctx, pathGuard);

			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('base64Data parameter is required');
		});

		it('blocks writing to .obsidian, .git, or hidden dotfolders', async () => {
			for (const blockedPath of ['.obsidian/plugins/x/main.js', '.git/hooks/pre-commit', 'Sub/.hidden/a.md']) {
				const res = await saveAttachmentHandler({
					path: blockedPath,
					base64Data: 'SVRlc3Q=',
				}, ctx, pathGuard);

				expect(res.isError).toBe(true);
				const text = res.content[0].type === 'text' ? res.content[0].text : '';
				expect(text).toContain('hidden or configuration paths is not allowed');
			}

			const noteRes = await createNoteHandler({
				path: 'Sub/.hidden/note.md',
				content: 'hello',
			}, ctx, pathGuard);
			expect(noteRes.isError).toBe(true);

			(ctx.plugin.app.vault as { configDir?: string }).configDir = 'custom-config';
			const customConfigRes = await createNoteHandler({
				path: 'custom-config/plugins/x/note.md',
				content: 'hello',
			}, ctx, pathGuard);
			expect(customConfigRes.isError).toBe(true);
			expect(ctx.plugin.app.vault.createBinary).not.toHaveBeenCalled();
		});

		it('blocks executable attachment extensions (.exe, .sh, .bat, etc.) case-insensitively', async () => {
			for (const blockedFile of ['payload.EXE', 'scripts/install.sh', 'autorun.bat']) {
				const res = await saveAttachmentHandler({
					path: blockedFile,
					base64Data: 'SVRlc3Q=',
				}, ctx, pathGuard);

				expect(res.isError).toBe(true);
				const text = res.content[0].type === 'text' ? res.content[0].text : '';
				expect(text).toContain('executable file extension');
			}
			expect(ctx.plugin.app.vault.createBinary).not.toHaveBeenCalled();
		});
	});

	describe('updateFrontmatterHandler', () => {
		it('returns error when key or value is missing', async () => {
			const res1 = await updateFrontmatterHandler({ path: 'test.md', key: '' }, ctx, pathGuard);
			expect(res1.isError).toBe(true);
			expect(res1.content[0].type === 'text' ? res1.content[0].text : '').toContain('key parameter is required');

			const res2 = await updateFrontmatterHandler({ path: 'test.md', key: 'status' }, ctx, pathGuard);
			expect(res2.isError).toBe(true);
			expect(res2.content[0].type === 'text' ? res2.content[0].text : '').toContain('value parameter is required');
		});

		it('processes JSON array strings into arrays and handles key deletion', async () => {
			const processedFm: Record<string, unknown> = {};
			vi.mocked(ctx.plugin.app.fileManager.processFrontMatter).mockImplementation(async (_f, fn) => {
				fn(processedFm);
			});

			const res = await updateFrontmatterHandler({
				path: 'test.md',
				key: 'aliases',
				value: '["alias1", "alias2"]',
			}, ctx, pathGuard);

			expect(res.isError).toBeFalsy();
			expect(processedFm.aliases).toEqual(['alias1', 'alias2']);

			// Delete key test
			const delRes = await updateFrontmatterHandler({
				path: 'test.md',
				key: 'aliases',
				deleteKey: true,
			}, ctx, pathGuard);

			expect(delRes.isError).toBeFalsy();
			expect(processedFm.aliases).toBeUndefined();

			// Smart parsing for boolean and number
			await updateFrontmatterHandler({ path: 'test.md', key: 'published', value: 'true' }, ctx, pathGuard);
			expect(processedFm.published).toBe(true);

			await updateFrontmatterHandler({ path: 'test.md', key: 'score', value: '98.5' }, ctx, pathGuard);
			expect(processedFm.score).toBe(98.5);
		});
	});

	describe('appendToDailyNoteHandler', () => {
		it('특정 date 인자 전달 시 해당 일자의 데일리 노트를 생성하거나 추가한다', async () => {
			const res = await appendToDailyNoteHandler({
				date: '2026-11-15',
				content: 'New log entry',
			}, ctx, pathGuard);

			expect(res.isError).toBeFalsy();
			expect(approvalManager.requestActionApproval).toHaveBeenCalledWith(
				'create_note',
				'2026-11-15.md',
				expect.objectContaining({ content: 'New log entry' }),
				expect.anything(),
			);
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
