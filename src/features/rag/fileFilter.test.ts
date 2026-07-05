import { describe, it, expect, vi } from 'vitest';
import { getTargetFiles, detectDeletedPaths } from './fileFilter';
import { App, TFile } from 'obsidian';
import type { RagSettings } from '../../core/settings/settings.types';

describe('fileFilter', () => {
	const mockApp = {
		vault: {
			configDir: '.obsidian',
			getFiles: vi.fn(),
			adapter: {
				exists: vi.fn()
			}
		}
	} as unknown as App;

	const mockSettings: RagSettings = {
		enabled: true,
		embeddingModel: 'test',
		searchResultCount: 5,
		chunkSize: 500,
		chunkOverlap: 50,
		childChunkSize: 100,
		childChunkOverlap: 10,
		includedPaths: ['/'],
		excludedPaths: [],
		maxFileSizeMB: 1
	} as any;

	it('getTargetFiles should filter by extension and size', () => {
		const f1 = { path: 'a.md', extension: 'md', stat: { size: 100 } } as TFile;
		const f2 = { path: 'b.pdf', extension: 'pdf', stat: { size: 100 } } as TFile;
		const f3 = { path: 'c.png', extension: 'png', stat: { size: 100 } } as TFile;
		const f4 = { path: 'd.md', extension: 'md', stat: { size: 2 * 1024 * 1024 } } as TFile; // Exceeds 1MB

		vi.mocked(mockApp.vault.getFiles).mockReturnValue([f1, f2, f3, f4]);

		const result = getTargetFiles(mockApp, mockSettings, 'chatHistory.md', [], []);
		expect(result).toEqual([f1, f2]);
	});

	it('getTargetFiles should filter by configDir and chatHistoryPath', () => {
		const f1 = { path: 'a.md', extension: 'md', stat: { size: 100 } } as TFile;
		const f2 = { path: '.obsidian/config.md', extension: 'md', stat: { size: 100 } } as TFile;
		const f3 = { path: 'history.md', extension: 'md', stat: { size: 100 } } as TFile;

		vi.mocked(mockApp.vault.getFiles).mockReturnValue([f1, f2, f3]);

		const result = getTargetFiles(mockApp, mockSettings, 'history.md', [], []);
		expect(result).toEqual([f1]); // f2 in configDir, f3 is chatHistory
	});
	
	it('detectDeletedPaths should check existence if not in currentPaths', async () => {
		const currentPaths = new Set(['a.md']);
		const indexedPaths = ['a.md', 'b.md', 'c.md'];
		
		vi.mocked(mockApp.vault.adapter.exists).mockImplementation(async (path) => {
			if (path === 'b.md') return true;
			return false; // c.md is false
		});

		const deleted = await detectDeletedPaths(mockApp, currentPaths, indexedPaths);
		expect(deleted.has('a.md')).toBe(false);
		expect(deleted.has('b.md')).toBe(false); // Actually exists
		expect(deleted.has('c.md')).toBe(true);  // Doesn't exist
	});
});
