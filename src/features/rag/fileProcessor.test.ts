import { describe, it, expect, vi } from 'vitest';
import { readAndPrepareFile } from './fileProcessor';
import { App, TFile } from 'obsidian';
import * as DocumentParserRouter from './parsers/DocumentParserRouter';
import * as chunker from './chunker';
import * as hashModule from '../../shared/utils/hash';


vi.mock('./chunker', () => ({
	chunkDocument: vi.fn()
}));
vi.mock('./parsers/DocumentParserRouter', () => ({
	DocumentParserRouter: {
		parseText: vi.fn()
	}
}));
vi.mock('../../shared/utils/hash', () => ({
	hashString: vi.fn()
}));
vi.mock('../../shared/utils/markdownPreprocessor', () => ({
	preprocessMarkdown: vi.fn((text) => text)
}));

describe('fileProcessor', () => {
	const mockApp = {
		vault: {
			read: vi.fn(),
			readBinary: vi.fn(),
		}
	} as unknown as App;
	
	const parseBinaryFn = vi.fn();

	it('should skip if hash matches and path is indexed', async () => {
		const f = { path: 'skip.md', extension: 'md', stat: { mtime: 100 } } as TFile;
		vi.mocked(mockApp.vault.read).mockResolvedValue('same content');
		vi.mocked(DocumentParserRouter.DocumentParserRouter.parseText).mockResolvedValue('same content');
		vi.mocked(hashModule.hashString).mockReturnValue(12345);
		
		const indexedPaths = new Set(['skip.md']);
		const hashes = { 'skip.md': 12345 };

		const result = await readAndPrepareFile(f, mockApp, parseBinaryFn, 100, 10, 50, 5, hashes, indexedPaths);
		
		expect(result.skip).toBe(true);
		expect(result.contentHash).toBe(12345);
		expect(chunker.chunkDocument).not.toHaveBeenCalled();
	});

	it('should not skip if hash is different', async () => {
		const f = { path: 'noskip.md', extension: 'md', stat: { mtime: 100 } } as TFile;
		vi.mocked(mockApp.vault.read).mockResolvedValue('different content');
		vi.mocked(DocumentParserRouter.DocumentParserRouter.parseText).mockResolvedValue('different content');
		vi.mocked(hashModule.hashString).mockReturnValue(54321);
		vi.mocked(chunker.chunkDocument).mockReturnValue({ parentChunks: [], childChunks: [] } as any);
		
		const indexedPaths = new Set(['noskip.md']);
		const hashes = { 'noskip.md': 12345 };

		const result = await readAndPrepareFile(f, mockApp, parseBinaryFn, 100, 10, 50, 5, hashes, indexedPaths);
		
		expect(result.skip).toBe(false);
		expect(chunker.chunkDocument).toHaveBeenCalled();
	});

	it('should read binary files properly', async () => {
		const f = { path: 'test.pdf', extension: 'pdf', stat: { mtime: 100 } } as TFile;
		vi.mocked(mockApp.vault.readBinary).mockResolvedValue(new ArrayBuffer(8));
		parseBinaryFn.mockResolvedValue('pdf content');
		vi.mocked(chunker.chunkDocument).mockReturnValue({ parentChunks: [], childChunks: [] });
		vi.mocked(hashModule.hashString).mockReturnValue(111);
		
		const result = await readAndPrepareFile(f, mockApp, parseBinaryFn, 100, 10, 50, 5, {}, new Set());
		expect(mockApp.vault.readBinary).toHaveBeenCalledWith(f);
		expect(parseBinaryFn).toHaveBeenCalled();
		expect(result.skip).toBe(false);
	});

	it('should return empty and false for empty content', async () => {
		const f = { path: 'empty.md', extension: 'md', stat: { mtime: 100 } } as TFile;
		vi.mocked(mockApp.vault.read).mockResolvedValue('');
		vi.mocked(DocumentParserRouter.DocumentParserRouter.parseText).mockResolvedValue('');
		
		const result = await readAndPrepareFile(f, mockApp, parseBinaryFn, 100, 10, 50, 5, {}, new Set());
		expect(result.parentChunks).toEqual([]);
		expect(result.skip).toBe(false);
	});
});
