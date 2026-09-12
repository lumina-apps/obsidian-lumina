import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryMetadataHandler } from './metadataHandlers';
import type { ToolHandlerContext } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import type { TFile } from 'obsidian';

describe('queryMetadataHandler', () => {
	let mockCtx: ToolHandlerContext;
	let mockPathGuard: PathGuard;
	let mockFiles: TFile[];

	beforeEach(() => {
		mockFiles = [
			{
				path: 'note-with-fm-tag.md',
				basename: 'note-with-fm-tag',
				stat: { ctime: 1000, mtime: 2000 },
			} as unknown as TFile,
			{
				path: 'note-with-inline-tag.md',
				basename: 'note-with-inline-tag',
				stat: { ctime: 3000, mtime: 4000 },
			} as unknown as TFile,
		];

		mockPathGuard = {
			isAgentPathAllowed: vi.fn().mockReturnValue(true),
			lock: vi.fn((_p, fn) => fn()),
		} as unknown as PathGuard;

		mockCtx = {
			plugin: {
				app: {
					vault: {
						getMarkdownFiles: vi.fn().mockReturnValue(mockFiles),
					},
					metadataCache: {
						getFileCache: vi.fn((file: TFile) => {
							if (file.path === 'note-with-fm-tag.md') {
								return {
									frontmatter: { tags: ['planning', 'lumina'] },
								};
							}
							if (file.path === 'note-with-inline-tag.md') {
								return {
									// frontmatter에는 없지만 인라인에 태그가 있는 경우
									frontmatter: null,
									tags: [{ tag: '#task' }, { tag: '#lumina' }],
								};
							}
							return null;
						}),
					},
				},
			},
			maxResults: 10,
			limitRead: 5000,
		} as unknown as ToolHandlerContext;
	});

	it('tags 필터로 frontmatter 태그와 본문 인라인 태그 모두를 검색할 수 있다', async () => {
		const result = await queryMetadataHandler(
			{
				tags: ['lumina'],
			},
			mockCtx,
			mockPathGuard,
		);

		expect(result.isError).toBeUndefined();
		const item = result.content[0];
		const text = item.type === 'text' ? item.text : '';
		expect(text).toContain('note-with-fm-tag.md');
		expect(text).toContain('note-with-inline-tag.md');
	});

	it('returnFields에 tags를 요청하면 인라인 태그도 포함하여 반환한다', async () => {
		const result = await queryMetadataHandler(
			{
				returnFields: ['tags'],
			},
			mockCtx,
			mockPathGuard,
		);

		expect(result.isError).toBeUndefined();
		const item = result.content[0];
		const text = item.type === 'text' ? item.text : '';
		expect(text).toContain('planning');
		expect(text).toContain('task');
	});
});
