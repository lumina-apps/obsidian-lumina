import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchNotesHandler } from './searchHandlers';
import type { ToolHandlerContext } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import type { TFile } from 'obsidian';

describe('searchNotesHandler', () => {
	let mockCtx: ToolHandlerContext;
	let mockPathGuard: PathGuard;
	let mockFiles: TFile[];
	let fileContents: Record<string, string>;

	beforeEach(() => {
		fileContents = {
			'note1.md': 'Lumina is an AI assistant. Lumina helps with notes. Lumina is powerful.',
			'note2.md': 'Obsidian is a knowledge base. Notes are markdown files.',
			'excluded.md': 'Secret Lumina note.',
		};

		mockFiles = [
			{ path: 'note1.md', basename: 'note1' } as TFile,
			{ path: 'note2.md', basename: 'note2' } as TFile,
			{ path: 'excluded.md', basename: 'excluded' } as TFile,
		];

		mockPathGuard = {
			isAgentPathAllowed: vi.fn((path: string) => path !== 'excluded.md'),
			lock: vi.fn((_p, fn) => fn()),
		} as unknown as PathGuard;

		mockCtx = {
			plugin: {
				app: {
					vault: {
						getMarkdownFiles: vi.fn().mockReturnValue(mockFiles),
						read: vi.fn(async (file: TFile) => fileContents[file.path] || ''),
					},
					metadataCache: {
						getFileCache: vi.fn().mockReturnValue(null),
					},
				},
			},
			maxResults: 10,
			snippetLen: 20,
			limitRead: 5000,
			limitAppend: 2000,
		} as unknown as ToolHandlerContext;
	});

	it('query와 tags가 둘 다 없으면 에러를 반환한다', async () => {
		const result = await searchNotesHandler({}, mockCtx, mockPathGuard);
		expect(result.isError).toBe(true);
		const item = result.content[0];
		expect(item.type === 'text' ? item.text : '').toContain('Either query or tags must be provided');
	});

	it('파일 내 여러 개의 매칭을 최대 3개까지 찾아 스니펫으로 반환한다', async () => {
		const result = await searchNotesHandler({ query: 'lumina' }, mockCtx, mockPathGuard);
		expect(result.isError).toBeUndefined();
		const item = result.content[0];
		const text = item.type === 'text' ? item.text : '';
		expect(text).toContain('[note1.md]');
		// note1.md에는 Lumina가 3번 나옴
		expect(mockPathGuard.isAgentPathAllowed).toHaveBeenCalledWith('note1.md', expect.anything());
		expect(text).not.toContain('[note2.md]');
	});

	it('pathGuard에 의해 허용되지 않은 파일은 검색에서 제외된다', async () => {
		const result = await searchNotesHandler({ query: 'secret' }, mockCtx, mockPathGuard);
		const item = result.content[0];
		expect(item.type === 'text' ? item.text : '').not.toContain('excluded.md');
	});

	it('태그만 제공되었을 때 태그 매칭 파일의 서두 스니펫을 반환한다', async () => {
		mockCtx.plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
			tags: [{ tag: '#project' }],
		});

		const result = await searchNotesHandler({ tags: ['project'] }, mockCtx, mockPathGuard);
		const item = result.content[0];
		expect(item.type === 'text' ? item.text : '').toContain('[note1.md]');
	});
});
