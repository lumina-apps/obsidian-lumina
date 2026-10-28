import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	readActiveNoteHandler,
	readNoteHandler,
	readDailyNoteHandler,
	getBacklinksHandler,
	getNoteMetadataHandler,
	listAttachmentsHandler,
	listFoldersHandler,
	getOutgoingLinksHandler,
} from './readHandlers';
import { PathGuard } from '../pathGuard';
import type { ToolHandlerContext } from '../toolTypes';
import { TFile, TFolder } from 'obsidian';

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

		const folderDaily = new TFolder();
		folderDaily.path = 'Daily';
		const folderSub = new TFolder();
		folderSub.path = 'Daily/Sub';

		const mockVault = {
			getAbstractFileByPath: vi.fn((path: string) => mockFiles.get(path)?.file || null),
			read: vi.fn(async (file: TFile) => mockFiles.get(file.path)?.content || ''),
			getFiles: vi.fn(() => Array.from(mockFiles.values()).map(v => v.file)),
			getMarkdownFiles: vi.fn(() =>
				Array.from(mockFiles.values())
					.map(v => v.file)
					.filter(f => f.extension === 'md'),
			),
			getAllLoadedFiles: vi.fn(() => [
				...Array.from(mockFiles.values()).map(v => v.file),
				folderDaily,
				folderSub,
			]),
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
						headings: [{ heading: 'Heading 1', level: 1, position: { start: { line: 0 } } }],
						links: [{ link: 'Note2.md', displayText: 'Second Note' }],
						embeds: [{ link: 'image.png' }],
					};
				}
				return null;
			}),
			getFirstLinkpathDest: vi.fn((link: string) => mockFiles.get(link)?.file || null),
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

		it('startLine과 endLine이 문자열 숫자로 전달되어도 정상 파싱하여 부분 읽기를 수행한다', async () => {
			const res = await readNoteHandler({ path: 'Note1.md', startLine: '2', endLine: '4' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('[Note1.md (Lines 2-4 of 5)]:');
			expect(text).toContain('Line 2\nLine 3\nLine 4');
		});

		it('agentMode에서 허용되지 않은 경로 접근 시 차단된다', async () => {
			vi.spyOn(pathGuard, 'isAgentPathAllowed').mockReturnValue(false);
			const res = await readNoteHandler({ path: 'Secret/Password.md' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('restricted');
		});

		it('바이너리 이미지 파일 읽기 시 가드가 동작하여 안내 문구를 반환한다', async () => {
			const res = await readNoteHandler({ path: 'image.png' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('[Binary file: image.png (PNG)');
			expect(text).toContain('Binary reading not supported');
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

		it('특정 date 인자 전달 시 해당 날짜의 데일리 노트를 조회한다', async () => {
			const { getDailyNotePath } = await import('../handlerHelpers');
			await readDailyNoteHandler({ date: '2026-12-25' }, ctx, pathGuard);
			expect(getDailyNotePath).toHaveBeenCalledWith(expect.anything(), '2026-12-25');
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

		it('path 인자가 비어있으면 에러를 반환한다', async () => {
			const res = await getBacklinksHandler({ path: '' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('path is required.');
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
			expect(meta.headings).toHaveLength(1);
			expect(meta.headings[0].line).toBe(1);
			expect(meta.links).toHaveLength(1);
			expect(meta.embeds).toHaveLength(1);
		});

		it('존재하지 않는 노트 메타데이터 요청 시 에러를 반환한다', async () => {
			const res = await getNoteMetadataHandler({ path: 'Missing.md' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('File not found: Missing.md');
		});

		it('path 인자가 비어있으면 에러를 반환한다', async () => {
			const res = await getNoteMetadataHandler({ path: '' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('path is required.');
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

	describe('listFoldersHandler', () => {
		it('볼트 루트 폴더 목록을 조회한다 (비재귀)', async () => {
			const res = await listFoldersHandler({}, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('Folders in vault root (1):');
			expect(text).toContain('Daily');
			expect(text).not.toContain('Daily/Sub');
		});

		it('recursive 옵션 전달 시 하위 폴더까지 재귀 조회한다', async () => {
			const res = await listFoldersHandler({ recursive: true }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('Daily');
			expect(text).toContain('Daily/Sub');
		});
	});

	describe('getOutgoingLinksHandler', () => {
		it('노트에서 외부로 향하는 링크 및 임베드 목록을 조회한다', async () => {
			const res = await getOutgoingLinksHandler({ path: 'Note1.md' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = res.content[0].type === 'text' ? res.content[0].text : '';
			expect(text).toContain('Outgoing links from Note1.md');
			expect(text).toContain('[LINK] Note2.md (display: "Second Note") [resolved]');
			expect(text).toContain('[EMBED] image.png');
		});

		it('빈 path 전달 시 에러를 반환한다', async () => {
			const res = await getOutgoingLinksHandler({ path: '' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
		});
	});
});
