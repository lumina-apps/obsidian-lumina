import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadIndex, saveIndex, saveCheckpoint, loadCheckpoint, deleteCheckpoint } from './indexPersistence';
import { App } from 'obsidian';
import { SCHEMA_VERSION } from '../../shared/types/rag.types';
import * as debugLoggerModule from '../../shared/debugLogger';

vi.mock('../../shared/debugLogger', () => ({
	debugLogger: {
		logError: vi.fn(),
		logSystem: vi.fn()
	}
}));
vi.mock('obsidian', () => ({
	normalizePath: vi.fn((p) => p)
}));

describe('indexPersistence', () => {
	const mockApp = {
		vault: {
			configDir: '.obsidian',
			adapter: {
				exists: vi.fn(),
				read: vi.fn(),
				write: vi.fn(),
				mkdir: vi.fn(),
				remove: vi.fn(),
			}
		}
	} as unknown as App;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('loadIndex', () => {
		it('should return empty result if file does not exist', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(false);
			const result = await loadIndex(mockApp, 'test-model', 'proj');
			expect(result.chunks).toEqual([]);
			expect(result.needsFullReindex).toBe(false);
		});

		it('should trigger full reindex if schema version mismatch', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(true);
			vi.mocked(mockApp.vault.adapter.read).mockResolvedValue(JSON.stringify({
				version: SCHEMA_VERSION - 1,
				modelName: 'test-model'
			}));
			const result = await loadIndex(mockApp, 'test-model', 'proj');
			expect(result.needsFullReindex).toBe(true);
			expect(debugLoggerModule.debugLogger.logSystem).toHaveBeenCalled();
		});

		it('should trigger full reindex if model name mismatch', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(true);
			vi.mocked(mockApp.vault.adapter.read).mockResolvedValue(JSON.stringify({
				version: SCHEMA_VERSION,
				modelName: 'old-model'
			}));
			const result = await loadIndex(mockApp, 'new-model', 'proj');
			expect(result.needsFullReindex).toBe(true);
		});

		it('should load data correctly', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(true);
			const data = {
				version: SCHEMA_VERSION,
				modelName: 'model',
				chunks: [{ path: 'a.md', content: 'test' }],
				childChunks: [],
				fileMtimes: { 'a.md': 100 },
				fileHashes: { 'a.md': 999 }
			};
			vi.mocked(mockApp.vault.adapter.read).mockResolvedValue(JSON.stringify(data));
			
			const result = await loadIndex(mockApp, 'model', 'proj');
			expect(result.needsFullReindex).toBe(false);
			expect(result.indexedPaths.has('a.md')).toBe(true);
			expect(result.fileMtimes['a.md']).toBe(100);
		});
	});

	describe('saveIndex', () => {
		it('should write data to adapter and remove child chunk embeddings', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(true);
			
			const chunks = [{ path: 'a.md', id: 'p1', content: 'c1' }] as any;
			const childChunks = [{ id: 'c1', parentId: 'p1', content: 'c1', embedding: [0.1] }] as any;
			
			await saveIndex(mockApp, 'model', chunks, childChunks, { 'a.md': 100 }, { 'a.md': 999 }, 'proj');
			
			expect(mockApp.vault.adapter.write).toHaveBeenCalled();
			const writeCall = vi.mocked(mockApp.vault.adapter.write).mock.calls[0];
			const writtenData = JSON.parse(writeCall[1] as string);
			expect(writtenData.childChunks[0].embedding).toBeUndefined(); // Embedding removed
		});
	});

	describe('Checkpoints', () => {
		it('should save checkpoint correctly', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(false);
			await saveCheckpoint(mockApp, ['a.md'], 1, 1000, 'proj');
			expect(mockApp.vault.adapter.mkdir).toHaveBeenCalled();
			expect(mockApp.vault.adapter.write).toHaveBeenCalled();
		});

		it('should load checkpoint correctly', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(true);
			vi.mocked(mockApp.vault.adapter.read).mockResolvedValue(JSON.stringify({
				processedPaths: ['a.md'],
				totalFiles: 1,
				startedAt: 1000,
				lastSavedAt: 2000
			}));
			const cp = await loadCheckpoint(mockApp, 'proj');
			expect(cp?.processedPaths).toEqual(['a.md']);
		});

		it('should return null for invalid checkpoint', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(true);
			vi.mocked(mockApp.vault.adapter.read).mockResolvedValue(JSON.stringify({ invalid: true }));
			const cp = await loadCheckpoint(mockApp, 'proj');
			expect(cp).toBeNull();
		});

		it('should delete checkpoint if exists', async () => {
			vi.mocked(mockApp.vault.adapter.exists).mockResolvedValue(true);
			await deleteCheckpoint(mockApp, 'proj');
			expect(mockApp.vault.adapter.remove).toHaveBeenCalled();
		});
	});
});
