import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readNoteHandler } from './readHandlers';
import { openNoteHandler } from './uiHandlers';
import { grepSearchHandler, globFilesHandler } from './searchHandlers';
import { dispatchToolHandler } from '../handlerRegistry';
import { PathGuard } from '../pathGuard';
import type { ToolHandlerContext } from '../toolTypes';
import { TFile } from 'obsidian';

function getText(res: { content: Array<{ type: string; text?: string }> }): string {
	const first = res.content[0];
	return first && 'text' in first && typeof first.text === 'string' ? first.text : '';
}

describe('Lumina CLI Parity MCP Tools', () => {
	let ctx: ToolHandlerContext;
	let pathGuard: PathGuard;
	let mockVaultFiles: Map<string, { file: TFile; content: string }>;
	let openedLeaves: Array<{ file: TFile; isNewTab: boolean; focused: boolean }>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockVaultFiles = new Map();
		openedLeaves = [];

		const addFile = (path: string, content: string, ext = 'md') => {
			const file = new TFile();
			file.path = path;
			file.extension = ext;
			mockVaultFiles.set(path, { file, content });
		};

		addFile('Notes/Hello.md', 'Line 1: Hello World\nLine 2: Foo Bar\nLine 3: Hello Again\nLine 4: End');
		addFile('Notes/Long.md', Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: Content ${i + 1}`).join('\n'));
		addFile('Projects/App.ts', 'import { x } from "lib";\nconst hello = "world";\nconsole.log(hello);', 'ts');
		addFile('Projects/Secret.png', 'binary-data', 'png');

		const mockVault = {
			getAbstractFileByPath: vi.fn((path: string) => mockVaultFiles.get(path)?.file || null),
			read: vi.fn(async (file: TFile) => mockVaultFiles.get(file.path)?.content || ''),
			getFiles: vi.fn(() => Array.from(mockVaultFiles.values()).map((v) => v.file)),
		};

		const mockWorkspace = {
			getLeaf: vi.fn((type: string | boolean) => {
				const isNewTab = type === 'tab';
				const leaf = {
					openFile: vi.fn(async (file: TFile) => {
						openedLeaves.push({ file, isNewTab, focused: false });
					}),
				};
				return leaf;
			}),
			setActiveLeaf: vi.fn((leaf: unknown) => {
				if (openedLeaves.length > 0) {
					openedLeaves[openedLeaves.length - 1].focused = true;
				}
			}),
		};

		ctx = {
			plugin: {
				app: {
					vault: mockVault,
					workspace: mockWorkspace,
				},
				settings: {
					mcp: {
						serverExcludedPaths: [],
					},
				},
			} as any,
			limitRead: 20000,
			limitAppend: 10000,
			snippetLen: 300,
			maxResults: 50,
		};

		pathGuard = new PathGuard();
	});

	// ─── 1. read_note 라인 범위 지정 (startLine, endLine) ───────────────────

	describe('read_note - Line Range Support', () => {
		it('startLine과 endLine이 주어지면 해당 라인 범위만 정확히 슬라이스하여 반환한다', async () => {
			const res = await readNoteHandler({ path: 'Notes/Long.md', startLine: 10, endLine: 12 }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = getText(res);
			expect(text).toContain('[Notes/Long.md (Lines 10-12 of 50)]:');
			expect(text).toContain('Line 10: Content 10\nLine 11: Content 11\nLine 12: Content 12');
			expect(text).not.toContain('Line 9:');
			expect(text).not.toContain('Line 13:');
		});

		it('startLine만 주어지면 해당 라인부터 끝까지 반환한다', async () => {
			const res = await readNoteHandler({ path: 'Notes/Hello.md', startLine: 3 }, ctx, pathGuard);
			const text = getText(res);
			expect(text).toContain('Line 3: Hello Again\nLine 4: End');
			expect(text).not.toContain('Line 1:');
		});

		it('startLine이 총 라인 수를 초과하면 빈 결과 알림을 반환한다', async () => {
			const res = await readNoteHandler({ path: 'Notes/Hello.md', startLine: 100 }, ctx, pathGuard);
			const text = getText(res);
			expect(text).toContain('empty, startLine exceeds total lines');
		});

		it('startLine/endLine이 없으면 파일 전체를 정상 반환한다', async () => {
			const res = await readNoteHandler({ path: 'Notes/Hello.md' }, ctx, pathGuard);
			const text = getText(res);
			expect(text).toContain('Line 1: Hello World');
			expect(text).toContain('Line 4: End');
		});
	});

	// ─── 2. open_note ───────────────────────────────────────────────────────

	describe('open_note', () => {
		it('노트 경로가 주어지면 에디터에 열고 포커스한다', async () => {
			const res = await openNoteHandler({ path: 'Notes/Hello.md' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			expect(openedLeaves.length).toBe(1);
			expect(openedLeaves[0].file.path).toBe('Notes/Hello.md');
			expect(openedLeaves[0].isNewTab).toBe(false);
			expect(openedLeaves[0].focused).toBe(true);
		});

		it('newTab: true 옵션을 전달하면 새 탭으로 연다', async () => {
			const res = await openNoteHandler({ path: 'Notes/Hello.md', newTab: true }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			expect(openedLeaves[0].isNewTab).toBe(true);
		});

		it('존재하지 않는 파일이면 에러를 반환한다', async () => {
			const res = await openNoteHandler({ path: 'NonExistent.md' }, ctx, pathGuard);
			expect(res.isError).toBe(true);
			expect(getText(res)).toContain('File not found');
		});
	});

	// ─── 3. grep_search ─────────────────────────────────────────────────────

	describe('grep_search', () => {
		it('텍스트 쿼리와 일치하는 라인을 파일명:라인번호: 내용 형식으로 반환한다', async () => {
			const res = await grepSearchHandler({ query: 'Hello' }, ctx, pathGuard);
			expect(res.isError).toBeFalsy();
			const text = getText(res);
			expect(text).toContain('Notes/Hello.md:1: Line 1: Hello World');
			expect(text).toContain('Notes/Hello.md:3: Line 3: Hello Again');
			expect(text).toContain('Projects/App.ts:2: const hello = "world";');
		});

		it('정규식(isRegex: true)으로 패턴 검색을 수행한다', async () => {
			const res = await grepSearchHandler({ query: 'Line [2-3]:', isRegex: true }, ctx, pathGuard);
			const text = getText(res);
			expect(text).toContain('Notes/Hello.md:2: Line 2: Foo Bar');
			expect(text).toContain('Notes/Hello.md:3: Line 3: Hello Again');
			expect(text).not.toContain('Line 1:');
		});

		it('바이너리 파일(png 등)은 자동으로 검색에서 제외한다', async () => {
			const res = await grepSearchHandler({ query: 'binary' }, ctx, pathGuard);
			expect(getText(res)).toContain('No matches found');
		});

		it('path 범위 옵션을 지정하면 해당 폴더만 제한하여 검색한다', async () => {
			const res = await grepSearchHandler({ query: 'hello', path: 'Projects' }, ctx, pathGuard);
			const text = getText(res);
			expect(text).toContain('Projects/App.ts:2');
			expect(text).not.toContain('Notes/Hello.md');
		});
	});

	// ─── 4. glob_files ──────────────────────────────────────────────────────

	describe('glob_files', () => {
		it('확장자 와일드카드(**/*.md)로 볼트 내 파일을 탐색한다', async () => {
			const res = await globFilesHandler({ pattern: '**/*.md' }, ctx, pathGuard);
			const text = getText(res);
			expect(text).toContain('Notes/Hello.md');
			expect(text).toContain('Notes/Long.md');
			expect(text).not.toContain('Projects/App.ts');
		});

		it('특정 서브디렉토리 패턴(Projects/*)을 필터링한다', async () => {
			const res = await globFilesHandler({ pattern: 'Projects/*' }, ctx, pathGuard);
			const text = getText(res);
			expect(text).toContain('Projects/App.ts');
			expect(text).toContain('Projects/Secret.png');
			expect(text).not.toContain('Notes/Hello.md');
		});
	});

	// ─── 5. dispatchToolHandler 라우팅 ─────────────────────────────────────

	describe('dispatchToolHandler', () => {
		it('open_note, grep_search, glob_files를 올바르게 라우팅한다', async () => {
			const openRes = await dispatchToolHandler('open_note', { path: 'Notes/Hello.md' }, ctx, pathGuard);
			expect(openRes.isError).toBeFalsy();

			const grepRes = await dispatchToolHandler('grep_search', { query: 'Hello' }, ctx, pathGuard);
			expect(grepRes.isError).toBeFalsy();

			const globRes = await dispatchToolHandler('glob_files', { pattern: '*.md' }, ctx, pathGuard);
			expect(globRes.isError).toBeFalsy();
		});
	});
});
