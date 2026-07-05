import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, TFile } from 'obsidian';
import { restoreFromCheckpoint, saveCheckpointIfNeeded, type CheckpointSaveContext, type IndexPersistContext } from './checkpointManager';
import * as indexPersistence from './indexPersistence';
import * as ragStore from '../../core/store/ragStore';

// Mock dependencies
vi.mock('obsidian', () => ({
	App: vi.fn(),
	TFile: vi.fn(),
}));

vi.mock('./indexPersistence', () => ({
	loadIndex: vi.fn(),
	saveIndex: vi.fn(),
	saveCheckpoint: vi.fn(),
	loadCheckpoint: vi.fn(),
	deleteCheckpoint: vi.fn(),
}));

vi.mock('../../core/store/ragStore', () => {
	const resumedFromCheckpointStore = { set: vi.fn() };
	return {
		setIndexingStatus: vi.fn(),
		setTotalFiles: vi.fn(),
		resumedFromCheckpoint: resumedFromCheckpointStore
	};
});

describe('checkpointManager', () => {
	let mockApp: App;
	const modelName = 'test-model';
	const projectId = 'test-project';

	beforeEach(() => {
		vi.clearAllMocks();
		mockApp = {} as App;
	});

	describe('restoreFromCheckpoint', () => {
		it('should return all files and delete checkpoint if needsFullReindex is true', async () => {
			vi.mocked(indexPersistence.loadIndex).mockResolvedValueOnce({ needsFullReindex: true, chunks: [], childChunks: [], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });
			vi.mocked(indexPersistence.loadCheckpoint).mockResolvedValueOnce({ processedPaths: ['path/1'], totalFiles: 2, startedAt: 1000, lastSavedAt: 1000 });
			
			const totalFiles = [{ path: 'path/1' } as TFile, { path: 'path/2' } as TFile];
			
			const result = await restoreFromCheckpoint(mockApp, modelName, totalFiles, false, projectId);
			
			expect(indexPersistence.deleteCheckpoint).toHaveBeenCalledWith(mockApp, projectId);
			expect(result.filesToProcess).toEqual(totalFiles);
			expect(result.alreadyProcessed).toBe(0);
			expect(result.indexRestored).toBe(false);
		});

		it('should treat 100% completed checkpoint as null and delete it', async () => {
			vi.mocked(indexPersistence.loadIndex).mockResolvedValueOnce({ needsFullReindex: false, chunks: [], childChunks: [], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });
			// 100% completed checkpoint
			vi.mocked(indexPersistence.loadCheckpoint).mockResolvedValueOnce({ processedPaths: ['path/1', 'path/2'], totalFiles: 2, startedAt: 1000, lastSavedAt: 1000 });
			
			const totalFiles = [{ path: 'path/1' } as TFile, { path: 'path/2' } as TFile];
			
			const result = await restoreFromCheckpoint(mockApp, modelName, totalFiles, false, projectId);
			
			expect(indexPersistence.deleteCheckpoint).toHaveBeenCalledWith(mockApp, projectId);
			expect(result.filesToProcess).toEqual(totalFiles);
			expect(result.alreadyProcessed).toBe(0);
		});

		it('should resume from partial checkpoint and filter already processed files', async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(indexPersistence.loadIndex).mockResolvedValueOnce({ needsFullReindex: false, chunks: [{id: '1', path: 'path/1'} as any], childChunks: [], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });
			vi.mocked(indexPersistence.loadCheckpoint).mockResolvedValueOnce({ processedPaths: ['path/1'], totalFiles: 2, startedAt: 1000, lastSavedAt: 1000 });
			
			const totalFiles = [{ path: 'path/1' } as TFile, { path: 'path/2' } as TFile];
			
			const result = await restoreFromCheckpoint(mockApp, modelName, totalFiles, false, projectId);
			
			expect(indexPersistence.deleteCheckpoint).not.toHaveBeenCalled();
			expect(result.filesToProcess).toEqual([{ path: 'path/2' }]);
			expect(result.alreadyProcessed).toBe(1);
			expect(result.indexRestored).toBe(true);
			expect(ragStore.resumedFromCheckpoint.set).toHaveBeenCalledWith(true);
			expect(ragStore.setTotalFiles).toHaveBeenCalledWith(2, 1, 1000);
		});

		it('should handle case where all files are already processed', async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(indexPersistence.loadIndex).mockResolvedValueOnce({ needsFullReindex: false, chunks: [{id: '1', path: 'path/1'} as any], childChunks: [], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });
			// Make checkpoint totalFiles > processedPaths.length so it's not treated as 100% complete by the earlier check
			vi.mocked(indexPersistence.loadCheckpoint).mockResolvedValueOnce({ processedPaths: ['path/1'], totalFiles: 2, startedAt: 1000, lastSavedAt: 1000 });
			
			// But the actual totalFiles passed in only contains the already processed file
			const totalFiles = [{ path: 'path/1' } as TFile];
			
			const result = await restoreFromCheckpoint(mockApp, modelName, totalFiles, false, projectId);
			
			expect(result.filesToProcess).toEqual([]);
			expect(result.alreadyProcessed).toBe(1);
			expect(result.indexRestored).toBe(true);
			expect(indexPersistence.deleteCheckpoint).toHaveBeenCalledWith(mockApp, projectId);
			expect(ragStore.setIndexingStatus).toHaveBeenCalledWith('ready', { totalFiles: 1, processedFiles: 1 });
		});

		it('should handle clearOnFullReindex true when checkpoint totalFiles mismatches', async () => {
			vi.mocked(indexPersistence.loadIndex).mockResolvedValueOnce({ needsFullReindex: false, chunks: [], childChunks: [], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });
			// Mismatched totalFiles
			vi.mocked(indexPersistence.loadCheckpoint).mockResolvedValueOnce({ processedPaths: ['path/1'], totalFiles: 2, startedAt: 1000, lastSavedAt: 1000 });
			
			const totalFiles = [{ path: 'path/1' } as TFile, { path: 'path/2' } as TFile, { path: 'path/3' } as TFile];
			
			const result = await restoreFromCheckpoint(mockApp, modelName, totalFiles, true, projectId);
			
			expect(indexPersistence.deleteCheckpoint).toHaveBeenCalledWith(mockApp, projectId);
			expect(result.filesToProcess).toEqual(totalFiles);
			expect(result.alreadyProcessed).toBe(0);
			expect(result.indexRestored).toBe(false);
			expect(ragStore.setTotalFiles).toHaveBeenCalledWith(3);
		});
	});

	describe('saveCheckpointIfNeeded', () => {
		it('should not save if accumulated is less than interval', async () => {
			const ctx: CheckpointSaveContext = {
				processedPaths: ['1', '2'],
				totalFiles: 10,
				startedAt: 1000,
				lastCheckpointAt: 1,
				checkpointInterval: 5
			};
			
			const newLast = await saveCheckpointIfNeeded(mockApp, ctx);
			expect(newLast).toBe(1);
			expect(indexPersistence.saveCheckpoint).not.toHaveBeenCalled();
		});

		it('should save checkpoint if accumulated >= interval', async () => {
			const ctx: CheckpointSaveContext = {
				processedPaths: ['1', '2', '3', '4', '5', '6'],
				totalFiles: 10,
				startedAt: 1000,
				lastCheckpointAt: 1,
				checkpointInterval: 5,
				checkpointSaves: 0
			};
			
			const persistCtx: IndexPersistContext = {
				modelName,
				chunks: [],
				childChunks: [],
				fileMtimes: {},
				fileHashes: {},
				projectId
			};

			const newLast = await saveCheckpointIfNeeded(mockApp, ctx, persistCtx, 1);
			
			expect(newLast).toBe(6);
			expect(indexPersistence.saveCheckpoint).toHaveBeenCalledWith(mockApp, ctx.processedPaths, 10, 1000, projectId);
			expect(indexPersistence.saveIndex).toHaveBeenCalledWith(mockApp, modelName, [], [], {}, {}, projectId);
			expect(ctx.checkpointSaves).toBe(1);
		});
		
		it('should save checkpoint but not index if checkpointSaves % persistIndexInterval !== 0', async () => {
			const ctx: CheckpointSaveContext = {
				processedPaths: ['1', '2', '3', '4', '5', '6'],
				totalFiles: 10,
				startedAt: 1000,
				lastCheckpointAt: 1,
				checkpointInterval: 5,
				checkpointSaves: 0
			};
			
			const persistCtx: IndexPersistContext = {
				modelName,
				chunks: [],
				childChunks: [],
				fileMtimes: {},
				fileHashes: {},
				projectId
			};

			const newLast = await saveCheckpointIfNeeded(mockApp, ctx, persistCtx, 2);
			
			expect(newLast).toBe(6);
			expect(indexPersistence.saveCheckpoint).toHaveBeenCalledWith(mockApp, ctx.processedPaths, 10, 1000, projectId);
			expect(indexPersistence.saveIndex).not.toHaveBeenCalled();
			expect(ctx.checkpointSaves).toBe(1);
		});
	});
});
