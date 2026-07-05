import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFiles, type ProcessContext } from './indexProcessing';
import { App, TFile, Notice } from 'obsidian';
import * as fileProcessor from './fileProcessor';
import * as ragStore from '../../core/store/ragStore';
import * as checkpointManager from './checkpointManager';

vi.mock('obsidian', () => ({
	Notice: vi.fn()
}));
vi.mock('./fileProcessor');
vi.mock('../../core/store/ragStore');
vi.mock('./checkpointManager');
vi.mock('../../shared/debugLogger', () => ({
	debugLogger: { logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }
}));

describe('indexProcessing', () => {
	let mockApp: App;
	let mockOramaStore: any;
	let ctx: ProcessContext;
	let isDestroyed = false;
	let currentProcessId = 1;

	beforeEach(() => {
		mockApp = {} as App;
		mockOramaStore = {
			insertChunks: vi.fn().mockResolvedValue(undefined),
			deleteByIds: vi.fn().mockResolvedValue(undefined)
		};
		isDestroyed = false;
		currentProcessId = 1;

		ctx = {
			app: mockApp,
			embedFn: vi.fn().mockResolvedValue([[0.1]]),
			parseBinaryFn: vi.fn(),
			parentChunkSize: 100,
			parentChunkOverlap: 10,
			childChunkSize: 50,
			childChunkOverlap: 5,
			modelName: 'test',
			projectId: 'default',
			parentChunks: [],
			childChunks: [],
			oramaStore: mockOramaStore,
			indexedPaths: new Set(),
			fileMtimes: {},
			fileHashes: {},
			getIsDestroyed: () => isDestroyed,
			getCurrentProcessId: () => currentProcessId,
			persistCache: vi.fn().mockResolvedValue(undefined),
			cachePersistCheckpointInterval: 10,
			totalFileCount: 100
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should process files sequentially if file count <= 50', async () => {
		const files = [
			{ path: 'file1.md', stat: { mtime: 1000 } } as TFile,
			{ path: 'file2.md', stat: { mtime: 2000 } } as TFile
		];
		
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(fileProcessor.readAndPrepareFile).mockResolvedValue({
			parentChunks: [{ id: 'p1', path: 'file1.md', text: 'parent' } as any],
			childChunks: [{ id: 'c1', path: 'file1.md', text: 'child', parentId: 'p1', embedding: null as any } as any],
			contentHash: 1234,
			skip: false
		});
		vi.mocked(checkpointManager.saveCheckpointIfNeeded).mockResolvedValue(1);

		await processFiles(files, ctx, 0, []);

		expect(fileProcessor.readAndPrepareFile).toHaveBeenCalledTimes(2);
		expect(ctx.embedFn).toHaveBeenCalledTimes(2); // One for each file (since we mocked readAndPrepareFile to always return 1 childChunk)
		expect(ctx.parentChunks.length).toBe(2);
		expect(ctx.childChunks.length).toBe(2);
		expect(ragStore.incrementProcessed).toHaveBeenCalledTimes(2);
	});

	it('should process files in batches if file count > 50', async () => {
		const files: TFile[] = [];
		for (let i = 0; i < 55; i++) {
			files.push({ path: `file${i}.md`, stat: { mtime: 1000 } } as TFile);
		}
		
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(fileProcessor.readAndPrepareFile).mockResolvedValue({
			parentChunks: [{ id: 'p1', path: 'mock', text: 'parent' } as any],
			childChunks: [{ id: 'c1', path: 'mock', text: 'child', parentId: 'p1', embedding: null as any } as any],
			contentHash: 123,
			skip: false
		});
		vi.mocked(ctx.embedFn).mockResolvedValue(Array(32).fill([0.1]));

		await processFiles(files, ctx, 0, []);

		expect(fileProcessor.readAndPrepareFile).toHaveBeenCalledTimes(55);
		// Batches are 32. 55 files -> 2 batches (32, 23). Each batch triggers embedding.
		expect(ctx.embedFn).toHaveBeenCalledTimes(2);
		expect(ctx.parentChunks.length).toBe(55);
		expect(ctx.childChunks.length).toBe(55);
		expect(ragStore.incrementProcessedBy).toHaveBeenCalledTimes(2); // One per batch
	});

	it('should handle read error in batch gracefully', async () => {
		const files = Array.from({ length: 55 }).map((_, i) => ({ path: `file${i}.md`, stat: { mtime: 1000 } } as TFile));
		
		vi.mocked(fileProcessor.readAndPrepareFile).mockImplementation(async (f) => {
			if (f.path === 'file10.md') throw new Error('Read failed');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return { parentChunks: [], childChunks: [], contentHash: 123, skip: true }; // skip others to test error handling specifically
		});

		await processFiles(files, ctx, 0, []);

		// Processed normally, mtime updated for rejected file too
		expect(ctx.fileMtimes['file10.md']).toBe(1000);
		expect(ragStore.incrementProcessedBy).toHaveBeenCalledTimes(2);
	});

	it('should skip file if skip is true or chunks are empty', async () => {
		const files = [
			{ path: 'empty.md', stat: { mtime: 1000 } } as TFile
		];
		
		vi.mocked(fileProcessor.readAndPrepareFile).mockResolvedValue({
			parentChunks: [], childChunks: [], contentHash: 0, skip: true
		});

		await processFiles(files, ctx, 0, []);

		expect(ctx.embedFn).not.toHaveBeenCalled();
		expect(ctx.fileMtimes['empty.md']).toBe(1000);
	});

	it('should handle embedFn error in sequential mode and continue', async () => {
		const files = [
			{ path: 'err.md', stat: { mtime: 1000 } } as TFile,
			{ path: 'ok.md', stat: { mtime: 1000 } } as TFile
		];
		
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(fileProcessor.readAndPrepareFile).mockResolvedValue({
			parentChunks: [{ id: 'p', path: 'any', text: 't' } as any],
			childChunks: [{ id: 'c', path: 'any', text: 't', parentId: 'p', embedding: null as any } as any],
			contentHash: 1, skip: false
		});
		
		vi.mocked(ctx.embedFn).mockRejectedValueOnce(new Error('API Error')).mockResolvedValueOnce([[0.2]]);

		await processFiles(files, ctx, 0, []);

		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('API Error'));
		expect(ctx.fileMtimes['err.md']).toBe(1000); // Saved mtime despite error
		expect(ctx.fileMtimes['ok.md']).toBe(1000);
		expect(ctx.childChunks.length).toBe(1); // Only ok.md's chunk was added
	});

	it('should handle embedFn error in batch mode', async () => {
		const files = Array.from({ length: 55 }).map((_, i) => ({ path: `file${i}.md`, stat: { mtime: 1000 } } as TFile));
		
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(fileProcessor.readAndPrepareFile).mockResolvedValue({
			parentChunks: [{ id: 'p', path: 'any', text: 't' } as any],
			childChunks: [{ id: 'c', path: 'any', text: 't', parentId: 'p', embedding: null as any } as any],
			contentHash: 1, skip: false
		});
		
		vi.mocked(ctx.embedFn).mockRejectedValue(new Error('Batch Embed Error'));

		await processFiles(files, ctx, 0, []);

		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Batch Embed Error'));
		expect(ctx.childChunks.length).toBe(0); // Nothing inserted due to error
		expect(ctx.fileMtimes['file0.md']).toBe(1000); // Mtimes updated so we don't infinitely retry
	});

	it('should stop processing if cancelled (getIsDestroyed)', async () => {
		const files = [
			{ path: 'f1.md', stat: { mtime: 1000 } } as TFile,
			{ path: 'f2.md', stat: { mtime: 1000 } } as TFile
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(fileProcessor.readAndPrepareFile).mockResolvedValue({
			parentChunks: [{ id: 'p', path: 'any', text: 't' } as any],
			childChunks: [{ id: 'c', path: 'any', text: 't', parentId: 'p', embedding: null as any } as any],
			contentHash: 1, skip: false
		});

		isDestroyed = true; // Set to true immediately

		await processFiles(files, ctx, 0, []);

		// Should exit early without calling fileProcessor
		expect(fileProcessor.readAndPrepareFile).not.toHaveBeenCalled();
	});

	it('should stop processing if cancelled (processId changed)', async () => {
		const files = [
			{ path: 'f1.md', stat: { mtime: 1000 } } as TFile,
			{ path: 'f2.md', stat: { mtime: 1000 } } as TFile
		];
		
		vi.mocked(fileProcessor.readAndPrepareFile).mockImplementation(async () => {
			currentProcessId = 2; // Simulate a newer process started
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return { parentChunks: [], childChunks: [], contentHash: 1, skip: false } as any;
		});

		await processFiles(files, ctx, 0, []);

		// Should only be called once because it cancelled before the second file
		expect(fileProcessor.readAndPrepareFile).toHaveBeenCalledTimes(1);
	});
});
