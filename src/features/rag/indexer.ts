/**
 * indexer.ts
 *
 * 볼트의 마크다운 파일을 청킹 + 임베딩하여 벡터 인덱스를 관리합니다.
 */

import { App, TFile } from 'obsidian';
import type { DocumentChunk, EmbedFn, ParseBinaryFn } from '../../shared/types/rag.types';
import type { RagSettings } from '../../core/settings/settings.types';
import { setIndexingStatus, resetIndexing, resumedFromCheckpoint, setTotalFiles } from '../../core/store/ragStore';
import { loadIndex, saveIndex, deleteCheckpoint } from './indexPersistence';
import { getTargetFiles, detectDeletedPaths } from './fileFilter';
import { restoreFromCheckpoint } from './checkpointManager';
import { processFiles } from './indexProcessing';

export class VaultIndexer {
	private readonly app: App;
	private readonly embedFn: EmbedFn;
	private readonly parseBinaryFn: ParseBinaryFn;
	private readonly settings: RagSettings;
	private readonly modelName: string;

	private chunks: DocumentChunk[] = [];
	private indexedPaths: Set<string> = new Set();
	private fileMtimes: Record<string, number> = {};
	private fileHashes: Record<string, number> = {};

	private isDestroyed: boolean = false;
	private currentProcessId: number = 0;
	private indexingStartedAt: number = 0;

	constructor(app: App, embedFn: EmbedFn, parseBinaryFn: ParseBinaryFn, settings: RagSettings, modelName: string, persistCacheFn?: () => Promise<void>) {
		this.app = app;
		this.embedFn = embedFn;
		this.parseBinaryFn = parseBinaryFn;
		this.settings = settings;
		this.modelName = modelName;
		this.persistCacheFn = persistCacheFn;
	}

	private persistCacheFn?: () => Promise<void>;

	public destroy(): void { this.isDestroyed = true; }

	get indexedChunks(): DocumentChunk[] { return this.chunks; }
	get indexedFileCount(): number { return Object.keys(this.fileMtimes).length; }
	async embed(texts: string[]): Promise<number[][]> { return this.embedFn(texts); }

	async indexVault(): Promise<void> {
		const files = getTargetFiles(this.app, this.settings);
		const restoreResult = await restoreFromCheckpoint(this.app, this.modelName, files, true);

		if (restoreResult.filesToProcess.length === 0) { return; }

		if (restoreResult.indexRestored) {
			const loadResult = await loadIndex(this.app, this.modelName);
			this.chunks = loadResult.chunks;
			this.indexedPaths = loadResult.indexedPaths;
			this.fileMtimes = loadResult.fileMtimes;
			this.fileHashes = loadResult.fileHashes;
		} else {
			this.clearState();
		}

		this.indexingStartedAt = restoreResult.alreadyProcessed > 0 ? restoreResult.startedAt : Date.now();
		await this.runProcessing(
			files,
			restoreResult.filesToProcess,
			restoreResult.alreadyProcessed,
			restoreResult.processedPaths,
		);
	}

	async updateIndex(): Promise<void> {
		const loadResult = await loadIndex(this.app, this.modelName);

		if (loadResult.needsFullReindex) {
			this.clearState();
			await this.indexVault();
			return;
		}

		this.chunks = loadResult.chunks;
		this.indexedPaths = loadResult.indexedPaths;
		this.fileMtimes = loadResult.fileMtimes;
		this.fileHashes = loadResult.fileHashes;


		const files = getTargetFiles(this.app, this.settings);

		if (files.length === 0 && Object.keys(this.fileMtimes).length > 0) {
			setIndexingStatus('ready', { totalFiles: Object.keys(this.fileMtimes).length, processedFiles: Object.keys(this.fileMtimes).length });
			return;
		}

		const currentPaths = new Set(files.map(f => f.path));
		const pathsToDelete = await detectDeletedPaths(this.app, currentPaths, Object.keys(this.fileMtimes));
		if (pathsToDelete.size > 0) { this.removePaths(pathsToDelete); }

		const changed = files.filter(f => {
			const prev = this.fileMtimes[f.path];
			return prev === undefined || f.stat.mtime !== prev;
		});


		if (changed.length === 0) {
			setIndexingStatus('ready', { totalFiles: files.length, processedFiles: files.length });
			return;
		}

		const restoreResult = await restoreFromCheckpoint(this.app, this.modelName, files, false);
		const changedSet = new Set(changed.map(f => f.path));
		const filesToProcess = restoreResult.filesToProcess.filter(f => changedSet.has(f.path));


		if (filesToProcess.length === 0) {
			await deleteCheckpoint(this.app);
			await this.persist();
			return;
		}

		this.indexingStartedAt = restoreResult.alreadyProcessed > 0 ? restoreResult.startedAt : Date.now();
		await this.runProcessing(
			files,
			filesToProcess,
			restoreResult.alreadyProcessed,
			restoreResult.processedPaths,
		);
	}

	async resetIndex(): Promise<void> {
		this.isDestroyed = true;
		this.currentProcessId++;
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		this.clearState();
		resetIndexing();
		await deleteCheckpoint(this.app);
		await this.persist();
	}

	private clearState(): void {
		this.isDestroyed = false;
		this.chunks = [];
		this.indexedPaths = new Set();
		this.fileMtimes = {};
		this.fileHashes = {};
	}

	private removePaths(paths: Set<string>): void {
		this.chunks = this.chunks.filter(c => !paths.has(c.path));
		paths.forEach(p => {
			this.indexedPaths.delete(p);
			delete this.fileMtimes[p];
			delete this.fileHashes[p];
		});
	}

	private async runProcessing(
		totalFiles: TFile[],
		filesToProcess: TFile[],
		alreadyProcessed: number = 0,
		previousProcessedPaths: string[] = [],
	): Promise<void> {
		this.currentProcessId++;
		if (alreadyProcessed === 0 && filesToProcess.length === totalFiles.length) {
			setTotalFiles(totalFiles.length, 0, this.indexingStartedAt);
		}

		try {
			await processFiles(filesToProcess, {
				app: this.app, embedFn: this.embedFn, parseBinaryFn: this.parseBinaryFn,
				chunkSize: this.settings.chunkSize, chunkOverlap: this.settings.chunkOverlap,
				modelName: this.modelName, chunks: this.chunks, indexedPaths: this.indexedPaths,
				fileMtimes: this.fileMtimes, fileHashes: this.fileHashes,
				isDestroyed: this.isDestroyed, currentProcessId: this.currentProcessId,
				persistCache: this.persistCacheFn,
				cachePersistCheckpointInterval: this.settings.cachePersistCheckpointInterval,
				totalFileCount: totalFiles.length,
			}, this.indexingStartedAt, previousProcessedPaths);
		} finally {
			await this.persist();
		}

		setIndexingStatus('ready', { totalFiles: totalFiles.length, processedFiles: totalFiles.length });
		await deleteCheckpoint(this.app);
		resumedFromCheckpoint.set(false);
	}

	private async persist(): Promise<void> {
		await saveIndex(this.app, this.modelName, this.chunks, this.fileMtimes, this.fileHashes);
	}
}