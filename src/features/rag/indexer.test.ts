import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VaultIndexer } from './indexer';
import { App, TFile } from 'obsidian';
import * as indexPersistence from './indexPersistence';
import * as fileFilter from './fileFilter';
import * as checkpointManager from './checkpointManager';
import * as indexProcessing from './indexProcessing';
import * as indexDiff from './utils/indexDiff';
import { EmbeddingStore } from './embeddingStore';
import type { RagSettings } from '../../core/settings/settings.types';
import * as ragStore from '../../core/store/ragStore';

vi.mock('obsidian');
vi.mock('./indexPersistence');
vi.mock('./fileFilter');
vi.mock('./checkpointManager');
vi.mock('./indexProcessing');
vi.mock('./utils/indexDiff');
vi.mock('../../core/store/ragStore');
vi.mock('../../shared/debugLogger', () => ({
	debugLogger: { logWarn: vi.fn(), logInfo: vi.fn(), logError: vi.fn() }
}));

const mockOramaInit = vi.fn();
const mockOramaInsert = vi.fn();
const mockOramaClear = vi.fn();
const mockOramaDelete = vi.fn();

vi.mock('./oramaStore', () => {
	return {
		OramaStore: class {
			init = mockOramaInit;
			insertChunks = mockOramaInsert;
			clear = mockOramaClear;
			deleteByIds = mockOramaDelete;
		}
	};
});

describe('VaultIndexer', () => {
	let mockApp: App;
	let mockEmbedFn: any;
	let mockParseBinaryFn: any;
	let mockSettings: RagSettings;
	let mockEmbeddingStore: any;
	let indexer: VaultIndexer;

	beforeEach(() => {
		vi.useFakeTimers();
		mockApp = {} as App;
		mockEmbedFn = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
		mockParseBinaryFn = vi.fn();
		mockSettings = {} as RagSettings;
		mockEmbeddingStore = {
			clear: vi.fn().mockResolvedValue(undefined),
			loadEmbeddings: vi.fn().mockResolvedValue(undefined),
			storeEmbeddings: vi.fn().mockResolvedValue(undefined),
			deleteEmbeddings: vi.fn().mockResolvedValue(undefined),
			close: vi.fn()
		};

		indexer = new VaultIndexer({
			app: mockApp,
			embedFn: mockEmbedFn,
			parseBinaryFn: mockParseBinaryFn,
			settings: mockSettings,
			includedPaths: [],
			excludedPaths: [],
			chatHistoryPath: '',
			modelName: 'test-model',
			projectId: 'default',
			embeddingStore: mockEmbeddingStore as unknown as EmbeddingStore
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it('should init OramaStore and use dimension from embedFn if no chunks exist', async () => {
		await indexer.initOramaStore();
		expect(mockEmbedFn).toHaveBeenCalledWith(['test']);
		expect(mockOramaInit).toHaveBeenCalled();
	});

	it('should prevent concurrent indexing', async () => {
		vi.mocked(fileFilter.getTargetFiles).mockReturnValue([]);
		vi.mocked(checkpointManager.restoreFromCheckpoint).mockResolvedValue({
			filesToProcess: [], alreadyProcessed: 0, indexRestored: false, processedPaths: [], startedAt: 0
		});

		const p1 = indexer.indexVault();
		const p2 = indexer.indexVault(); // Should return immediately
		const p3 = indexer.updateIndex(); // Should return immediately
		
		await Promise.all([p1, p2, p3]);
		
		expect(fileFilter.getTargetFiles).toHaveBeenCalledTimes(1);
	});

	it('should destroy properly', () => {
		indexer.destroy();
		expect(indexer.isDestroyed).toBe(true);
		expect(mockEmbeddingStore.close).toHaveBeenCalled();
	});

	describe('indexVault', () => {
		it('should early return if no files to process', async () => {
			vi.mocked(fileFilter.getTargetFiles).mockReturnValue([]);
			vi.mocked(checkpointManager.restoreFromCheckpoint).mockResolvedValue({
				filesToProcess: [], alreadyProcessed: 0, indexRestored: false, processedPaths: [], startedAt: 0
			});

			await indexer.indexVault();

			expect(ragStore.setIndexingStatus).toHaveBeenCalledWith('ready', { totalFiles: 0, processedFiles: 0 });
			expect(indexProcessing.processFiles).not.toHaveBeenCalled();
		});

		it('should load index if indexRestored is true', async () => {
			vi.mocked(fileFilter.getTargetFiles).mockReturnValue([{ path: 'test.md' } as TFile]);
			vi.mocked(checkpointManager.restoreFromCheckpoint).mockResolvedValue({
				filesToProcess: [{ path: 'test.md' } as TFile], alreadyProcessed: 0, indexRestored: true, processedPaths: [], startedAt: 0
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(indexPersistence.loadIndex).mockResolvedValue({ needsFullReindex: false, chunks: [], childChunks: [{id: '1', embedding: [0.1]} as any], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });

			await indexer.indexVault();

			// Because indexRestored is true, it calls loadIndex and initOramaStore without calling embedFn for test
			expect(mockEmbedFn).not.toHaveBeenCalled(); // dimension taken from childChunks[0]
			expect(mockOramaInsert).toHaveBeenCalled();
			expect(indexProcessing.processFiles).toHaveBeenCalled();
			expect(indexPersistence.saveIndex).toHaveBeenCalled();
		});
	});

	describe('updateIndex', () => {
		it('should perform full reindex if loadIndex returns needsFullReindex', async () => {
			vi.mocked(fileFilter.getTargetFiles).mockReturnValue([{ path: 'test.md' } as TFile]);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(indexPersistence.loadIndex).mockResolvedValue({ needsFullReindex: true, chunks: [], childChunks: [], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });
			vi.mocked(checkpointManager.restoreFromCheckpoint).mockResolvedValue({
				filesToProcess: [{ path: 'test.md' } as TFile], alreadyProcessed: 0, indexRestored: false, processedPaths: [], startedAt: 0
			});

			await indexer.updateIndex();

			expect(mockEmbeddingStore.clear).toHaveBeenCalled();
			expect(indexProcessing.processFiles).toHaveBeenCalled();
		});

		it('should early return if target files is 0 but indexedFileCount > 0', async () => {
			vi.mocked(fileFilter.getTargetFiles).mockReturnValue([]);
			// Mocking fileMtimes with 1 item so indexedFileCount > 0
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(indexPersistence.loadIndex).mockResolvedValue({ needsFullReindex: false, chunks: [], childChunks: [], fileMtimes: { 'old.md': 1000 }, fileHashes: {}, indexedPaths: new Set(['old.md']) });

			await indexer.updateIndex();

			expect(ragStore.setIndexingStatus).toHaveBeenCalledWith('ready', { totalFiles: 1, processedFiles: 1 });
			expect(indexDiff.calculateIndexDiff).not.toHaveBeenCalled();
		});

		it('should call removePaths and delete embeddings when pathsToDelete > 0', async () => {
			const targetFile = { path: 'new.md' } as TFile;
			vi.mocked(fileFilter.getTargetFiles).mockReturnValue([targetFile]);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(indexPersistence.loadIndex).mockResolvedValue({ 
				needsFullReindex: false, chunks: [], childChunks: [{id: 'child1', path: 'old.md'} as any], 
				fileMtimes: {}, fileHashes: {}, indexedPaths: new Set(['old.md']) 
			});
			
			vi.mocked(indexDiff.calculateIndexDiff).mockResolvedValue({ pathsToDelete: new Set(['old.md']), changedFiles: [targetFile] });
			vi.mocked(checkpointManager.restoreFromCheckpoint).mockResolvedValue({
				filesToProcess: [targetFile], alreadyProcessed: 0, indexRestored: false, processedPaths: [], startedAt: 0
			});

			await indexer.updateIndex();

			expect(mockOramaDelete).toHaveBeenCalledWith(['child1']);
			expect(mockEmbeddingStore.deleteEmbeddings).toHaveBeenCalledWith(['child1']);
		});

		it('should early return if changedFiles is empty', async () => {
			const targetFile = { path: 'unchanged.md' } as TFile;
			vi.mocked(fileFilter.getTargetFiles).mockReturnValue([targetFile]);
			vi.mocked(indexPersistence.loadIndex).mockResolvedValue({ needsFullReindex: false, chunks: [], childChunks: [], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });
			vi.mocked(indexDiff.calculateIndexDiff).mockResolvedValue({ pathsToDelete: new Set(), changedFiles: [] });

			await indexer.updateIndex();

			expect(ragStore.setIndexingStatus).toHaveBeenCalledWith('ready', { totalFiles: 1, processedFiles: 1 });
			expect(checkpointManager.restoreFromCheckpoint).not.toHaveBeenCalled();
		});

		it('should clear checkpoint and early return if filesToProcess is empty after changedFiles intersection', async () => {
			const targetFile = { path: 'changed.md' } as TFile;
			vi.mocked(fileFilter.getTargetFiles).mockReturnValue([targetFile]);
			vi.mocked(indexPersistence.loadIndex).mockResolvedValue({ needsFullReindex: false, chunks: [], childChunks: [], fileMtimes: {}, fileHashes: {}, indexedPaths: new Set() });
			vi.mocked(indexDiff.calculateIndexDiff).mockResolvedValue({ pathsToDelete: new Set(), changedFiles: [targetFile] });
			
			// checkpoint says it doesn't need to process 'changed.md'
			vi.mocked(checkpointManager.restoreFromCheckpoint).mockResolvedValue({
				filesToProcess: [], alreadyProcessed: 1, indexRestored: false, processedPaths: ['changed.md'], startedAt: 0
			});

			await indexer.updateIndex();

			expect(indexPersistence.deleteCheckpoint).toHaveBeenCalled();
			expect(indexPersistence.saveIndex).toHaveBeenCalled(); // via persist()
			expect(ragStore.setIndexingStatus).toHaveBeenCalledWith('ready', { totalFiles: 1, processedFiles: 1 });
		});
	});

	describe('resetIndex', () => {
		it('should clear everything and reset states', async () => {
			await indexer.initOramaStore(); // so oramaStore is populated
			const p = indexer.resetIndex();
			vi.runAllTimers();
			await p;

			expect(mockOramaClear).toHaveBeenCalled();
			expect(ragStore.resetIndexing).toHaveBeenCalled();
			expect(indexPersistence.deleteCheckpoint).toHaveBeenCalled();
			expect(mockEmbeddingStore.clear).toHaveBeenCalled();
			expect(indexPersistence.saveIndex).toHaveBeenCalled();
		});
	});
});
