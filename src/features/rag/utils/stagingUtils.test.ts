import { describe, it, expect, vi } from 'vitest';
import { estimateFileTokens } from './stagingUtils';
import type LuminaPlugin from '../../../main';
import { TFile } from 'obsidian';

describe('stagingUtils - estimateFileTokens', () => {
	it('인덱서에 상위 청크가 존재할 때 해당 청크들의 텍스트를 합산해 토큰을 추정한다', async () => {
		const mockPlugin = {
			indexer: {
				indexedParentChunks: [
					{ id: '1', path: 'folder/doc.md', text: 'Hello world from chunk 1', chunkIndex: 0 },
					{ id: '2', path: 'folder/doc.md', text: 'Second chunk content here', chunkIndex: 1 },
					{ id: '3', path: 'other/file.md', text: 'Other file content', chunkIndex: 0 },
				],
			},
			app: {
				vault: {
					getAbstractFileByPath: vi.fn(),
					cachedRead: vi.fn(),
				},
			},
		} as unknown as LuminaPlugin;

		const tokens = await estimateFileTokens(mockPlugin, 'folder/doc.md');
		expect(tokens).toBeGreaterThan(0);
		expect(mockPlugin.app.vault.cachedRead).not.toHaveBeenCalled();
	});

	it('인덱서에 없지만 vault에 파일이 존재하는 경우 cachedRead를 사용해 토큰을 추정한다', async () => {
		const file = new TFile();
		const mockPlugin = {
			indexer: {
				indexedParentChunks: [],
			},
			app: {
				vault: {
					getAbstractFileByPath: vi.fn().mockReturnValue(file),
					cachedRead: vi.fn().mockResolvedValue('Direct markdown content here'),
				},
			},
		} as unknown as LuminaPlugin;

		const tokens = await estimateFileTokens(mockPlugin, 'unindexed.md');
		expect(tokens).toBeGreaterThan(0);
		expect(mockPlugin.app.vault.cachedRead).toHaveBeenCalledWith(file);
	});

	it('파일을 찾을 수 없거나 에러가 발생하면 0을 반환한다', async () => {
		const mockPlugin = {
			indexer: null,
			app: {
				vault: {
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					cachedRead: vi.fn(),
				},
			},
		} as unknown as LuminaPlugin;

		const tokens = await estimateFileTokens(mockPlugin, 'nonexistent.md');
		expect(tokens).toBe(0);
	});
});
