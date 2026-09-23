import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	readActiveNoteHandler,
	readNoteHandler,
	readDailyNoteHandler,
	getBacklinksHandler,
	getNoteMetadataHandler,
	listAttachmentsHandler,
} from './readHandlers';
import { PathGuard } from '../pathGuard';
import type { ToolHandlerContext } from '../toolTypes';
import { TFile } from 'obsidian';

vi.mock('../handlerHelpers', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../handlerHelpers')>();
	return {
		...actual,
		getDailyNotePath: vi.fn().mockResolvedValue('Daily/2026-09-23.md'),
	};
});

describe('readHandlers', () => {
	let ctx: ToolHandlerContext;
	let pathGuard: PathGuard;
	let mockFiles: Map<string, { file: TFile; content: string }>;
	let activeFile: TFile | null = null;

	const createFile = (path: string, content: string, size = 100): TFile => {
		const file = new TFile();
		file.path = path;
		file.basename = path.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, '');
		file.extension = path.split('.').pop() || '';
		file.stat = {
			size,
			ctime: 1700000000,
			mtime: 1700001000,
		};
		return file;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockFiles = new Map();
		activeFile = null;

		const addFile = (path: string, content: string) => {
			const file = createFile(path, content, content.length);
			mockFiles.set(path, { file, content });
		};

		addFile('Note1.md', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
		addFile('Note2.md', 'Content of note 2');
		addFile('Daily/2026-09-23.md', '# Today\n- [x] Task 1\n- [ ] Task 2');
		addFile('image.png', 'binary_png_data');
		addFile('doc.pdf', 'binary_pdf_data');

		const mockVault = {
			getAbstractFileByPath: vi.fn((path: string) => mockFiles.get(path)?.file || null),
			read: vi.fn(async (file: TFile) => mockFiles.get(file.path)?.content || ''),
			getFiles: vi.fn(() => Array.from(mockFiles.values()).map(v => v.file)),
			getMarkdownFiles: vi.fn(() =>
				Array.from(mockFiles.values())
					.map(v => v.file)
					.filter(f => f.extension === 'md'),
			),
		};

		const mockWorkspace = {
			getActiveFile: vi.fn(() => activeFile),
		};

		const mockMetadataCache = {
			getFileCache: vi.fn((file: TFile) => {
				if (file.path === 'Note1.md') {
					return {
						frontmatter: {
							tags: ['tag1', 'tag2'],
							aliases: ['First Note'],
						},
						tags: [{ tag: '#bodyTag' }],
					};
				}
				return null;
			}),
			resolvedLinks: {
				'Note1.md': {
					'Note2.md': 1,
					'image.png': 1,
				},
				'Daily/2026-09-23.md': {
					'Note1.md': 1,
				},
			} as Record<string, Record<string, number>>,
		};

		ctx = {
			plugin: {
				app: {
					vault: mockVault,
					workspace: mockWorkspace,
					metadataCache: mockMetadataCache,
				},
				manifest: { version: '1.4.4' },
				settings: {
					mcp: {},
				},
			} as any,
			limitRead: 10000,
			limitAppend: 5000,
			snippetLen: 200,
			maxResults: 20,
		};

		pathGuard = new PathGuard();
	});

	describe('readActiveNoteHandler', () => {
		it('활성 노드가 있을 때 내용과 경로 헤더를 정상 반환한다', () => {
			activeFile = mockFiles.get('Note1.md')!.file;

			return readActiveNoteHandler({}, ctx, pathGuard).then((res) => {
				expect(res.isError).toBeFalsy();
				const text = res.content[0].type === 'text' ? res.content[0].text : '';
				expect(text).toContain('[Note1.md]');
				expect(text).toContain('Line 1\nLine 2');
			});
		});

		it('활성 노드가 없을 때 안내 메시지를 반환한다', async () => {
			activeFile = null;
			const res = await readActiveNoteHandler({}, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('No active note');
		});
	});

	describe('readNoteHandler', () => {
		it('path 인자가 비어있으면 에러를 반환한다', async () => {
			const res = await readNoteHandler({ path: '' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('Path is required.');
		});

		it('확장자가 생략된 경로를 자동으로 .md로 보정하여 읽는다', async () => {
			const res = await readNoteHandler({ path: 'Note2' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toBe('Content of note 2');
		});

		it('존재하지 않는 파일 경로일 때 에러를 반환한다', async () => {
			const res = await readNoteHandler({ path: 'NonExistent.md' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('not found');
		});

		it('startLine과 endLine 범위를 지정하여 부분 읽기를 수행한다', async () => {
			const res = await readNoteHandler({ path: 'Note1.md', startLine: 2, endLine: 4 }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('[Note1.md (Lines 2-4 of 5)]:');
			expect(text).toContain('Line 2\nLine 3\nLine 4');
			expect(text).not.toContain('Line 1');
			expect(text).not.toContain('Line 5');
		});

		it('startLine이 endLine보다 크면 에러를 반환한다', async () => {
			const res = await readNoteHandler({ path: 'Note1.md', startLine: 5, endLine: 2 }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('startLine (5) cannot be greater than endLine (2)');
		});

		it('startLine이 총 줄 수를 초과하면 empty 안내를 반환한다', async () => {
			const res = await readNoteHandler({ path: 'Note1.md', startLine: 10, endLine: 12 }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('startLine exceeds total lines');
		});

		it('agentMode에서 허용되지 않은 경로 접근 시 차단된다', async () => {
			vi.spyOn(pathGuard, 'isAgentPathAllowed').mockReturnValue(false);
			const res = await readNoteHandler({ path: 'Secret/Password.md' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('restricted');
		});
	});

	describe('readDailyNoteHandler', () => {
		it('데일리 노트가 존재할 때 정상적으로 내용을 반환한다', async () => {
			const res = await readDailyNoteHandler({}, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('# Today');
			expect(text).toContain('Task 1');
		});

		it('데일리 노트 파일이 없으면 에러를 반환한다', async () => {
			mockFiles.delete('Daily/2026-09-23.md');
			const res = await readDailyNoteHandler({}, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('does not exist');
		});
	});

	describe('getBacklinksHandler', () => {
		it('해당 노드를 링크하고 있는 역링크 목록을 반환한다', async () => {
			const res = await getBacklinksHandler({ path: 'Note1.md' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('Backlinks for Note1.md:');
			expect(text).toContain('Daily/2026-09-23.md');
		});

		it('역링크가 없는 노드는 안내 메시지를 반환한다', async () => {
			const res = await getBacklinksHandler({ path: 'Daily/2026-09-23.md' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('No backlinks found');
		});
	});

	describe('getNoteMetadataHandler', () => {
		it('노트의 메타데이터(크기, 수정일, 태그, 프론트매터 등)를 JSON 형태로 반환한다', async () => {
			const res = await getNoteMetadataHandler({ path: 'Note1.md' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			const meta = JSON.parse(text);

			expect(meta.path).toBe('Note1.md');
			expect(meta.basename).toBe('Note1');
			expect(meta.extension).toBe('md');
			expect(meta.tags).toContain('#tag1');
			expect(meta.tags).toContain('#tag2');
			expect(meta.tags).toContain('#bodyTag');
			expect(meta.aliases).toContain('First Note');
		});

		it('존재하지 않는 노트 메타데이터 요청 시 에러를 반환한다', async () => {
			const res = await getNoteMetadataHandler({ path: 'Missing.md' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('File not found: Missing.md');
		});
	});

	describe('listAttachmentsHandler', () => {
		it('특정 노트에 연결된 첨부파일(.png, .pdf 등)을 조회한다', async () => {
			const res = await listAttachmentsHandler({ path: 'Note1.md' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('Attachments linked in Note1.md:');
			expect(text).toContain('image.png');
			expect(text).not.toContain('Note2.md'); // 마크다운 노트는 제외
		});

		it('경로 인자 없이 호출 시 볼트 내 전체 첨부파일 목록을 반환한다', async () => {
			const res = await listAttachmentsHandler({}, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('All attachments:');
			expect(text).toContain('image.png');
			expect(text).toContain('doc.pdf');
			expect(text).not.toContain('Note1.md');
		});
	});
});
