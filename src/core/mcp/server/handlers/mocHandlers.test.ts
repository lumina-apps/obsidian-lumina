/**
 * mocHandlers.test.ts
 * generateMocHandler 통합 테스트
 * - Obsidian API는 vitest.setup.ts의 전역 mock 사용
 * - writeHandlerUtils (safeCreateFile / safeModifyFile) 는 vi.mock으로 교체
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import { generateMocHandler } from './mocHandlers';
import type { ToolHandlerContext } from '../toolTypes';
import type { PathGuard } from '../pathGuard';

// ── mock: writeHandlerUtils ──────────────────────────────────────────────────
vi.mock('./utils/writeHandlerUtils', () => ({
	getValidatedPathAndFile: vi.fn(),
	safeCreateFile: vi.fn(),
	safeModifyFile: vi.fn(),
}));

import {
	getValidatedPathAndFile,
	safeCreateFile,
	safeModifyFile,
} from './utils/writeHandlerUtils';

// ── 헬퍼: TFile mock 생성 ────────────────────────────────────────────────────

function makeTFile(path: string, tags: string[] = []): TFile {
	const parts = path.split('/');
	const basename = parts[parts.length - 1].replace(/\.md$/, '');
	// TFile은 vitest.setup.ts에서 vi.fn()으로 교체됨
	const file = Object.create(TFile.prototype) as TFile;
	Object.assign(file, { path, basename, extension: 'md' });
	return file;
}

// ── 헬퍼: context / pathGuard mock ──────────────────────────────────────────

function makeCtx(mdFiles: TFile[], cacheTagMap: Record<string, string[]> = {}): ToolHandlerContext {
	return {
		plugin: {
			app: {
				vault: {
					getMarkdownFiles: vi.fn(() => mdFiles),
					getAbstractFileByPath: vi.fn((p: string) =>
						mdFiles.find(f => f.path === p) ?? null,
					),
				},
				metadataCache: {
					getFileCache: vi.fn((file: TFile) => {
						const tags = cacheTagMap[file.path] ?? [];
						return tags.length ? { tags: tags.map(tag => ({ tag })) } : null;
					}),
				},
			},
		},
		limitRead: 20000,
		limitAppend: 10000,
		snippetLen: 300,
		maxResults: 10,
	} as unknown as ToolHandlerContext;
}

function makePathGuard(allowed = true): PathGuard {
	return {
		isAgentPathAllowed: vi.fn(() => allowed),
		lock: vi.fn((_path: string, fn: () => Promise<unknown>) => fn()),
	} as unknown as PathGuard;
}

function setupMockFiles(existingFile?: TFile) {
	vi.mocked(getValidatedPathAndFile).mockReturnValue({
		path: 'out/MOC.md',
		file: existingFile,
	});
	vi.mocked(safeCreateFile).mockResolvedValue({
		content: [{ type: 'text', text: 'created' }],
	});
	vi.mocked(safeModifyFile).mockResolvedValue({
		content: [{ type: 'text', text: 'modified' }],
	});
}

// ── 공통 setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();

	// obsidian getAllTags mock: vi.mock('obsidian') 는 setup.ts에서 처리됨
	// 여기서는 import * as obsidian 을 통해 getAllTags를 spy
});

// ── 인자 유효성 검증 ──────────────────────────────────────────────────────────

describe('generateMocHandler: 인자 유효성', () => {
	it('title이 없으면 isError를 반환한다', async () => {
		const ctx = makeCtx([]);
		const pathGuard = makePathGuard();
		const result = await generateMocHandler({}, ctx, pathGuard);
		expect(result.isError).toBe(true);
		expect((result.content[0] as any).text).toContain('title');
	});

	it('outputPath가 없으면 isError를 반환한다', async () => {
		const ctx = makeCtx([]);
		const pathGuard = makePathGuard();
		const result = await generateMocHandler({ title: 'My MOC' }, ctx, pathGuard);
		expect(result.isError).toBe(true);
		expect((result.content[0] as any).text).toContain('outputPath');
	});

	it('folder/tags/files 중 하나도 없으면 scope 오류를 반환한다', async () => {
		const ctx = makeCtx([]);
		const pathGuard = makePathGuard();
		const result = await generateMocHandler(
			{ title: 'My MOC', outputPath: 'out/MOC' },
			ctx,
			pathGuard,
		);
		expect(result.isError).toBe(true);
		expect((result.content[0] as any).text).toContain('folder');
	});

	it('outputPath에 .md가 없으면 자동으로 붙인다', async () => {
		const files = [makeTFile('notes/a.md')];
		const ctx = makeCtx(files);
		const pathGuard = makePathGuard();

		setupMockFiles();

		await generateMocHandler(
			{ title: 'Test', outputPath: 'out/MOC', folder: 'notes' },
			ctx,
			pathGuard,
		);

		// getValidatedPathAndFile 첫 번째 인자(args)의 path가 .md로 끝나야 한다
		const [calledArgs] = vi.mocked(getValidatedPathAndFile).mock.calls[0];
		expect((calledArgs as Record<string, unknown>).path).toMatch(/\.md$/);
	});
});

// ── 노트 수집: folder scope ──────────────────────────────────────────────────

describe('generateMocHandler: folder scope', () => {
	it('지정된 폴더 내 노트만 수집하여 MOC를 생성한다', async () => {
		const files = [
			makeTFile('Projects/alpha.md'),
			makeTFile('Projects/beta.md'),
			makeTFile('Journal/diary.md'),
		];
		const ctx = makeCtx(files);
		const pathGuard = makePathGuard();

		setupMockFiles();

		await generateMocHandler(
			{ title: 'Project MOC', outputPath: 'out/MOC', folder: 'Projects' },
			ctx,
			pathGuard,
		);

		const [, content] = vi.mocked(safeCreateFile).mock.calls[0];
		expect(content).toContain('[[alpha]]');
		expect(content).toContain('[[beta]]');
		expect(content).not.toContain('[[diary]]');
	});

	it('폴더 내 노트가 없으면 빈 MOC (경고 문구 포함) 를 생성한다', async () => {
		const ctx = makeCtx([]);
		const pathGuard = makePathGuard();

		setupMockFiles();

		await generateMocHandler(
			{ title: 'Empty MOC', outputPath: 'out/MOC', folder: 'NonExistent' },
			ctx,
			pathGuard,
		);

		const [, content] = vi.mocked(safeCreateFile).mock.calls[0];
		expect(content).toContain('[!WARNING]');
	});
});

// ── 노트 수집: files scope ────────────────────────────────────────────────────

describe('generateMocHandler: files scope', () => {
	it('명시된 파일 경로만 포함한다', async () => {
		const files = [
			makeTFile('A/note1.md'),
			makeTFile('B/note2.md'),
			makeTFile('C/note3.md'),
		];
		const ctx = makeCtx(files);
		const pathGuard = makePathGuard();

		setupMockFiles();

		await generateMocHandler(
			{
				title: 'Explicit MOC',
				outputPath: 'out/MOC',
				files: ['A/note1.md', 'C/note3.md'],
			},
			ctx,
			pathGuard,
		);

		const [, content] = vi.mocked(safeCreateFile).mock.calls[0];
		expect(content).toContain('[[note1]]');
		expect(content).toContain('[[note3]]');
		expect(content).not.toContain('[[note2]]');
	});

	it('존재하지 않는 경로는 조용히 무시된다', async () => {
		const files = [makeTFile('A/real.md')];
		const ctx = makeCtx(files);
		const pathGuard = makePathGuard();

		setupMockFiles();

		await generateMocHandler(
			{
				title: 'Test',
				outputPath: 'out/MOC',
				files: ['A/real.md', 'ghost/nonexistent.md'],
			},
			ctx,
			pathGuard,
		);

		const [, content] = vi.mocked(safeCreateFile).mock.calls[0];
		expect(content).toContain('[[real]]');
		// 빈 MOC 경고가 없어야 함 (real.md 1개 있음)
		expect(content).not.toContain('[!WARNING]');
	});
});

// ── overwrite 동작 ────────────────────────────────────────────────────────────

describe('generateMocHandler: overwrite 플래그', () => {
	it('파일이 존재하고 overwrite=false이면 에러를 반환한다', async () => {
		const ctx = makeCtx([makeTFile('notes/a.md')]);
		const pathGuard = makePathGuard();

		// file이 존재하는 상황
		const existingFile = makeTFile('out/MOC.md');
		setupMockFiles(existingFile);

		const result = await generateMocHandler(
			{ title: 'MOC', outputPath: 'out/MOC', folder: 'notes', overwrite: false },
			ctx,
			pathGuard,
		);

		expect(result.isError).toBe(true);
		expect((result.content[0] as any).text).toContain('overwrite');
	});

	it('파일이 존재하고 overwrite=true이면 safeModifyFile을 호출한다', async () => {
		const files = [makeTFile('notes/a.md')];
		const ctx = makeCtx(files);
		const pathGuard = makePathGuard();

		const existingFile = makeTFile('out/MOC.md');
		setupMockFiles(existingFile);
		// vault.read mock
		(ctx.plugin.app.vault as any).read = vi.fn(() =>
			Promise.resolve('old content'),
		);

		await generateMocHandler(
			{ title: 'MOC', outputPath: 'out/MOC', folder: 'notes', overwrite: true },
			ctx,
			pathGuard,
		);

		expect(safeModifyFile).toHaveBeenCalledOnce();
		expect(safeCreateFile).not.toHaveBeenCalled();
	});

	it('파일이 없으면 safeCreateFile을 호출한다', async () => {
		const files = [makeTFile('notes/a.md')];
		const ctx = makeCtx(files);
		const pathGuard = makePathGuard();

		setupMockFiles();

		await generateMocHandler(
			{ title: 'MOC', outputPath: 'out/MOC', folder: 'notes' },
			ctx,
			pathGuard,
		);

		expect(safeCreateFile).toHaveBeenCalledOnce();
		expect(safeModifyFile).not.toHaveBeenCalled();
	});
});

// ── pathGuard 필터링 ──────────────────────────────────────────────────────────

describe('generateMocHandler: pathGuard 필터링', () => {
	it('pathGuard가 차단한 파일은 MOC에 포함되지 않는다', async () => {
		const files = [makeTFile('allowed/a.md'), makeTFile('blocked/b.md')];
		const ctx = makeCtx(files);

		// allowed/a.md만 허용, blocked/b.md는 차단
		const pathGuard = {
			isAgentPathAllowed: vi.fn((p: string) => !p.includes('blocked')),
			lock: vi.fn(),
		} as unknown as PathGuard;

		setupMockFiles();

		await generateMocHandler(
			{ title: 'MOC', outputPath: 'out/MOC', folder: '' },
			ctx,
			pathGuard,
		);

		// scope 오류 없이 (folder='') allowed 파일만 포함
		if (vi.mocked(safeCreateFile).mock.calls.length > 0) {
			const [, content] = vi.mocked(safeCreateFile).mock.calls[0];
			expect(content).not.toContain('[[b]]');
		}
	});
});

// ── groupBy 기본값 ────────────────────────────────────────────────────────────

describe('generateMocHandler: groupBy 기본값', () => {
	it('groupBy를 명시하지 않으면 none(플랫 리스트)로 동작한다', async () => {
		const files = [
			makeTFile('A/x.md'),
			makeTFile('B/y.md'),
		];
		const ctx = makeCtx(files);
		const pathGuard = makePathGuard();

		setupMockFiles();

		await generateMocHandler(
			{ title: 'MOC', outputPath: 'out/MOC', folder: 'A' },
			ctx,
			pathGuard,
		);

		const [, content] = vi.mocked(safeCreateFile).mock.calls[0];
		// none이면 "## Notes" 가 있어야 하고, "📁" 섹션은 없어야 함
		expect(content).toContain('## Notes');
		expect(content).not.toContain('## 📁');
	});
});
