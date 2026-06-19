/**
 * 볼트 파일을 청킹 + 임베딩하여 벡터 인덱스를 관리합니다.
 */

import { App, TFile } from 'obsidian';
import type { ParentChunk, ChildChunk, EmbedFn, ParseBinaryFn } from '../../shared/types/rag.types';
import type { RagSettings } from '../../core/settings/settings.types';
import { setIndexingStatus, resetIndexing, resumedFromCheckpoint, setTotalFiles } from '../../core/store/ragStore';
import { loadIndex, saveIndex, deleteCheckpoint } from './indexPersistence';
import { getTargetFiles, detectDeletedPaths } from './fileFilter';
import { restoreFromCheckpoint } from './checkpointManager';
import { processFiles } from './indexProcessing';
import type { EmbeddingStore } from './embeddingStore';
import { OramaStore } from './oramaStore';

export class VaultIndexer {
	private readonly app: App;
	private readonly embedFn: EmbedFn;
	private readonly parseBinaryFn: ParseBinaryFn;
	private readonly settings: RagSettings;
	private readonly chatHistoryPath: string;
	private readonly modelName: string;
	private readonly embeddingStore: EmbeddingStore;
	private oramaStore: OramaStore | null = null;
	private persistCacheFn?: () => Promise<void>;

	private parentChunks: ParentChunk[] = [];
	private childChunks: ChildChunk[] = [];
	public indexedPaths: Set<string> = new Set();
	public fileMtimes: Record<string, number> = {};
	public fileHashes: Record<string, number> = {};
	public isDestroyed = false;
	public currentProcessId = 0;
	private indexingStartedAt = 0;
	private isIndexing = false;

	constructor(app: App, embedFn: EmbedFn, parseBinaryFn: ParseBinaryFn, settings: RagSettings, chatHistoryPath: string, modelName: string, embeddingStore: EmbeddingStore, persistCacheFn?: () => Promise<void>) {
		this.app = app;
		this.embedFn = embedFn;
		this.parseBinaryFn = parseBinaryFn;
		this.settings = settings;
		this.chatHistoryPath = chatHistoryPath;
		this.modelName = modelName;
		this.embeddingStore = embeddingStore;
		this.persistCacheFn = persistCacheFn;
	}

	public destroy(): void { this.isDestroyed = true; }

	get indexedParentChunks(): ParentChunk[] { return this.parentChunks; }
	get indexedChildChunks(): ChildChunk[] { return this.childChunks; }
	get indexedFileCount(): number { return Object.keys(this.fileMtimes).length; }
	get oramaDb(): OramaStore | null { return this.oramaStore; }
	
	async embed(texts: string[]): Promise<number[][]> { return this.embedFn(texts); }

	private async getDimension(): Promise<number> {
		if (this.childChunks.length > 0 && this.childChunks[0].embedding) {
			return this.childChunks[0].embedding.length;
		}
		const testEmbed = await this.embedFn(["test"]);
		return testEmbed[0].length;
	}

	public async initOramaStore(): Promise<void> {
		if (!this.oramaStore) {
			const dim = await this.getDimension();
			this.oramaStore = new OramaStore(dim);
			await this.oramaStore.init();
			if (this.childChunks.length > 0) {
				await this.oramaStore.insertChunks(this.childChunks);
			}
		}
	}

	async indexVault(): Promise<void> {
		this.isIndexing = true;
		const files = getTargetFiles(this.app, this.settings, this.chatHistoryPath);
		const restoreResult = await restoreFromCheckpoint(this.app, this.modelName, files, true);

		if (restoreResult.filesToProcess.length === 0) { 
			this.isIndexing = false;
			return; 
		}

		if (restoreResult.indexRestored) {
			const loadResult = await loadIndex(this.app, this.modelName);
			this.parentChunks.length = 0;
			this.parentChunks.push(...loadResult.chunks);
			this.childChunks.length = 0;
			this.childChunks.push(...loadResult.childChunks);
			this.indexedPaths = loadResult.indexedPaths;
			this.fileMtimes = loadResult.fileMtimes;
			this.fileHashes = loadResult.fileHashes;
			// IndexedDB에서 embedding 복원
			await this.embeddingStore.loadEmbeddings(this.childChunks).catch(() => {
				// 로드 실패는 무시 → embedding 없이 인덱싱 계속
			});
		} else {
			this.clearState();
			await this.embeddingStore.clear();
		}
		
		await this.initOramaStore();

		this.indexingStartedAt = restoreResult.alreadyProcessed > 0 ? restoreResult.startedAt : Date.now();
		await this.runProcessing(
			files,
			restoreResult.filesToProcess,
			restoreResult.alreadyProcessed,
			restoreResult.processedPaths,
		);
	}

	async updateIndex(): Promise<void> {
		if (this.isIndexing) return;
		this.isIndexing = true;
		try {
			const loadResult = await loadIndex(this.app, this.modelName);

			if (loadResult.needsFullReindex) {
				this.clearState();
				await this.indexVault();
				return;
			}

			this.parentChunks.length = 0;
			this.parentChunks.push(...loadResult.chunks);
			this.childChunks.length = 0;
			this.childChunks.push(...loadResult.childChunks);
			this.indexedPaths = loadResult.indexedPaths;
			this.fileMtimes = loadResult.fileMtimes;
			this.fileHashes = loadResult.fileHashes;

			// IndexedDB에서 embedding 복원
			await this.embeddingStore.loadEmbeddings(this.childChunks).catch(() => {
				// 로드 실패는 무시 → embedding 없이 인덱싱 계속
			});

			await this.initOramaStore();
		} finally {
			this.isIndexing = false;
		}

		const files = getTargetFiles(this.app, this.settings, this.chatHistoryPath);

		if (files.length === 0 && Object.keys(this.fileMtimes).length > 0) {
			setIndexingStatus('ready', { totalFiles: Object.keys(this.fileMtimes).length, processedFiles: Object.keys(this.fileMtimes).length });
			this.isIndexing = false;
			return;
		}

		const currentPaths = new Set(files.map(f => f.path));

		// 디스크에서 삭제된 파일 감지
		const pathsToDelete = await detectDeletedPaths(this.app, currentPaths, Object.keys(this.fileMtimes));

		// 제외 경로가 변경되어 더 이상 인덱싱 대상이 아닌 파일도 제거
		for (const indexedPath of Object.keys(this.fileMtimes)) {
			if (!currentPaths.has(indexedPath)) {
				pathsToDelete.add(indexedPath);
			}
		}

		if (pathsToDelete.size > 0) { await this.removePaths(pathsToDelete); }

		const changed = files.filter(f => {
			const prev = this.fileMtimes[f.path];
			return prev === undefined || f.stat.mtime !== prev;
		});


		if (changed.length === 0) {
			setIndexingStatus('ready', { totalFiles: files.length, processedFiles: files.length });
			this.isIndexing = false;
			return;
		}

		const restoreResult = await restoreFromCheckpoint(this.app, this.modelName, files, false);
		const changedSet = new Set(changed.map(f => f.path));
		const filesToProcess = restoreResult.filesToProcess.filter(f => changedSet.has(f.path));


		if (filesToProcess.length === 0) {
			await deleteCheckpoint(this.app);
			await this.persist();
			this.isIndexing = false;
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
		await new Promise<void>(resolve => window.setTimeout(resolve, 0));
		this.clearState();
		if (this.oramaStore) {
			await this.oramaStore.clear();
		}
		resetIndexing();
		await deleteCheckpoint(this.app);
		await this.embeddingStore.clear();
		await this.persist();
		this.isIndexing = false;
	}

	private clearState(): void {
		this.isDestroyed = false;
		this.parentChunks.length = 0;
		this.childChunks.length = 0;
		this.indexedPaths.clear();
		this.fileMtimes = {};
		this.fileHashes = {};
	}

	private async removePaths(paths: Set<string>): Promise<void> {
		const removedChildChunks = this.childChunks.filter(c => paths.has(c.path));
		
		for (let i = this.parentChunks.length - 1; i >= 0; i--) {
			if (paths.has(this.parentChunks[i].path)) {
				this.parentChunks.splice(i, 1);
			}
		}
		
		for (let i = this.childChunks.length - 1; i >= 0; i--) {
			if (paths.has(this.childChunks[i].path)) {
				this.childChunks.splice(i, 1);
			}
		}
		
		paths.forEach(p => {
			this.indexedPaths.delete(p);
			delete this.fileMtimes[p];
			delete this.fileHashes[p];
			if (this.oramaStore) {
				void this.oramaStore.deleteByPathPrefix(p);
			}
		});
		// IndexedDB에서 해당 청크 임베딩 삭제
		if (removedChildChunks.length > 0) {
			void this.embeddingStore.deleteEmbeddings(removedChildChunks.map(c => c.id)).catch(() => {});
		}
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
				parentChunkSize: this.settings.parentChunkSize, parentChunkOverlap: this.settings.parentChunkOverlap,
				childChunkSize: this.settings.childChunkSize, childChunkOverlap: this.settings.childChunkOverlap,
				modelName: this.modelName, parentChunks: this.parentChunks, childChunks: this.childChunks,
				oramaStore: this.oramaStore!, indexedPaths: this.indexedPaths,
				fileMtimes: this.fileMtimes, fileHashes: this.fileHashes,
				isDestroyed: this.isDestroyed, currentProcessId: this.currentProcessId,
				persistCache: this.persistCacheFn,
				cachePersistCheckpointInterval: this.settings.cachePersistCheckpointInterval,
				totalFileCount: totalFiles.length,
			}, this.indexingStartedAt, previousProcessedPaths);
		} finally {
			await this.persist();
			this.isIndexing = false;
		}

		setIndexingStatus('ready', { totalFiles: totalFiles.length, processedFiles: totalFiles.length });
		await deleteCheckpoint(this.app);
		resumedFromCheckpoint.set(false);
	}

	private async persist(): Promise<void> {
		// 1. 메타데이터를 JSON으로 저장 (embedding 제외)
		await saveIndex(this.app, this.modelName, this.parentChunks, this.childChunks, this.fileMtimes, this.fileHashes);
		// 2. 임베딩을 IndexedDB에 저장 (childChunks만 임베딩 존재)
		await this.embeddingStore.storeEmbeddings(this.childChunks).catch((err) => {
			console.warn('[VaultIndexer] embeddingStore.storeEmbeddings failed:', err);
		});
	}
}