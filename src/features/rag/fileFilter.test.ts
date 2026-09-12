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

	it('detectDeletedPaths는 파일명의 대소문자만 변경된 경우 구버전 대소문자 경로를 삭제 대상으로 감지한다', async () => {
		// readme.md 가 README.md 로 변경된 상황
		const currentPaths = new Set(['README.md']);
		const indexedPaths = ['readme.md'];

		// adapter.exists는 Windows 환경처럼 대소문자 무시하고 true 반환하도록 설정
		vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(true);

		const deleted = await detectDeletedPaths(mockApp, currentPaths, indexedPaths);
		expect(deleted.has('readme.md')).toBe(true);
	});

	it('getTargetFiles should handle files with undefined or missing extension without throwing toLowerCase error', () => {
		const f1 = { path: 'a.md', extension: 'md', stat: { size: 100 } } as TFile;
		const f2 = { path: 'LICENSE', extension: undefined, stat: { size: 100 } } as unknown as TFile;
		const f3 = { path: 'Makefile', stat: { size: 100 } } as unknown as TFile;
		const f4 = { path: '.gitignore', extension: null, stat: { size: 100 } } as unknown as TFile;

		vi.mocked(mockApp.vault.getFiles).mockReturnValue([f1, f2, f3, f4]);

		const result = getTargetFiles(mockApp, mockSettings, 'chatHistory.md', [], []);
		expect(result).toEqual([f1]);
	});

	it('getTargetFiles should respect includedPaths even if vault has extensionless files', () => {
		const f1 = { path: 'docs/a.md', extension: 'md', stat: { size: 100 } } as TFile;
		const f2 = { path: 'other/b.md', extension: 'md', stat: { size: 100 } } as TFile;
		const f3 = { path: 'LICENSE', extension: undefined, stat: { size: 100 } } as unknown as TFile;

		vi.mocked(mockApp.vault.getFiles).mockReturnValue([f1, f2, f3]);

		const result = getTargetFiles(mockApp, mockSettings, 'chatHistory.md', ['docs'], []);
		expect(result).toEqual([f1]);
	});

	it('detectDeletedPaths should safely handle empty or malformed paths', async () => {
		const currentPaths = new Set(['a.md', '']);
		const indexedPaths = ['a.md', '', undefined as unknown as string, 'deleted.md'];

		vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(false);

		const deleted = await detectDeletedPaths(mockApp, currentPaths, indexedPaths);
		expect(deleted.has('deleted.md')).toBe(true);
		expect(deleted.has('a.md')).toBe(false);
	});
});
