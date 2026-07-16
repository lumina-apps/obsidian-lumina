/**
 * 볼트 파일을 청킹 + 임베딩하여 벡터 인덱스를 관리합니다.
 */

/**
 * ## VaultIndexer
 * 
 * 볼트 파일을 청킹 + 임베딩하여 벡터 인덱스를 생성/관리하는 핵심 클래스입니다.
 * 
 * ### 주요 역할
 * - **전체 인덱싱 (indexVault)**: 볼트의 모든 대상 파일을 청킹 → 임베딩 → 인덱스 저장
 * - **증분 업데이트 (updateIndex)**: 파일 변경/삭제를 감지하고 변경분만 재처리
 * - **체크포인트 복구**: 이전 인덱싱 진행 상태에서 재개 가능
 * - **Orama BM25 + 벡터 검색 통합**: 하이브리드 검색을 위한 이중 인덱스 관리
 * 
 * ### 라이프사이클
 * 1. `constructor` → `indexVault()` 또는 `updateIndex()` 호출
 * 2. 내부에서 `restoreFromCheckpoint` → `processFiles` → `persist()` 순서로 진행
 * 3. `destroy()` 호출 시 임베딩 DB 연결 해제
 */

import { App, TFile } from 'obsidian';
import type { ParentChunk, ChildChunk, EmbedFn, ParseBinaryFn } from '../../shared/types/rag.types';
import type { RagSettings } from '../../core/settings/settings.types';
import { setIndexingStatus, resetIndexing, resumedFromCheckpoint, setTotalFiles } from '../../core/store/ragStore';
import { loadIndex, saveIndex, deleteCheckpoint } from './indexPersistence';
import { getTargetFiles } from './fileFilter';
import { restoreFromCheckpoint } from './checkpointManager';
import { processFiles } from './indexProcessing';
import type { EmbeddingStore } from './embeddingStore';
import { OramaStore } from './oramaStore';
import { IndexState } from './utils/indexState';
import { calculateIndexDiff } from './utils/indexDiff';
import { debugLogger } from '../../shared/debugLogger';

export interface VaultIndexerConfig {
	app: App;
	embedFn: EmbedFn;
	parseBinaryFn: ParseBinaryFn;
	settings: RagSettings;
	includedPaths: string[];
	excludedPaths: string[];
	chatHistoryPath: string;
	modelName: string;
	projectId: string;
	embeddingStore: EmbeddingStore;
	persistCacheFn?: () => Promise<void>;
}

export class VaultIndexer {
	/** Obsidian 앱 인스턴스 */
	private readonly app: App;
	/** 임베딩 함수 (텍스트 → 벡터) */
	private readonly embedFn: EmbedFn;
	/** 바이너리 파일 파서 (PDF, DOCX, XLSX 등) */
	private readonly parseBinaryFn: ParseBinaryFn;
	/** RAG 설정 (청크 크기, Top-K 등) */
	private readonly settings: RagSettings;
	/** 인덱싱 포함 경로 목록 */
	private readonly includedPaths: string[];
	/** 인덱싱 제외 경로 목록 */
	private readonly excludedPaths: string[];
	/** 채팅 기록 저장 경로 (인덱싱 제외 대상) */
	private readonly chatHistoryPath: string;
	/** 사용 중인 임베딩 모델명 */
	private readonly modelName: string;
	/** 프로젝트 식별자 (멀티 프로젝트 지원) */
	public readonly projectId: string;
	/** 임베딩 벡터 영구 저장소 (IndexedDB/SQLite) */
	private readonly embeddingStore: EmbeddingStore;
	/** Orama 하이브리드 검색 인덱스 (BM25 + 벡터) */
	private oramaStore: OramaStore | null = null;
	/** 임베딩 캐시 디스크 저장 콜백 */
	private persistCacheFn?: () => Promise<void>;
	/** 인덱싱 상태 (청크, 파일 메타데이터 등) */
	private state: IndexState = new IndexState();
	/** 인스턴스 파괴 여부 — true면 모든 작업 중단 */
	public isDestroyed = false;
	/** 현재 실행 중인 처리 프로세스 ID (중복 실행 방지) */
	public currentProcessId = 0;
	/** 인덱싱 시작 타임스탬프 (소요 시간 측정용) */
	private indexingStartedAt = 0;
	/** 인덱싱 진행 중 여부 (중복 호출 방지 잠금) */
	private isIndexing = false;

	constructor(config: VaultIndexerConfig) {
		this.app = config.app;
		this.embedFn = config.embedFn;
		this.parseBinaryFn = config.parseBinaryFn;
		this.settings = config.settings;
		this.includedPaths = config.includedPaths;
		this.excludedPaths = config.excludedPaths;
		this.chatHistoryPath = config.chatHistoryPath;
		this.modelName = config.modelName;
		this.projectId = config.projectId;
		this.embeddingStore = config.embeddingStore;
		this.persistCacheFn = config.persistCacheFn;
	}

	public destroy(): void {
		this.isDestroyed = true;
		if (this.embeddingStore) {
			this.embeddingStore.close();
		}
	}

	get indexedParentChunks(): ParentChunk[] { return this.state.parentChunks; }
	get indexedChildChunks(): ChildChunk[] { return this.state.childChunks; }
	get indexedFileCount(): number { return this.state.indexedFileCount; }
	get indexedPaths(): Set<string> { return this.state.indexedPaths; }
	get fileMtimes(): Record<string, number> { return this.state.fileMtimes; }
	get fileHashes(): Record<string, number> { return this.state.fileHashes; }
	get oramaDb(): OramaStore | null { return this.oramaStore; }
	
	async embed(texts: string[]): Promise<number[][]> { return this.embedFn(texts); }

	private async getDimension(): Promise<number> {
		if (this.state.childChunks.length > 0 && this.state.childChunks[0].embedding) {
			return this.state.childChunks[0].embedding.length;
		}
		const testEmbed = await this.embedFn(["test"]);
		return testEmbed[0].length;
	}

	public async initOramaStore(): Promise<void> {
		if (!this.oramaStore) {
			const dim = await this.getDimension();
			this.oramaStore = new OramaStore(dim);
			await this.oramaStore.init();
			if (this.state.childChunks.length > 0) {
				await this.oramaStore.insertChunks(this.state.childChunks);
			}
		}
	}

	async indexVault(): Promise<void> {
		if (this.isIndexing) return;
		this.isIndexing = true;
		try {
			await this.processSync(false);
		} finally {
			this.isIndexing = false;
		}
	}

	async updateIndex(): Promise<void> {
		if (this.isIndexing) return;
		this.isIndexing = true;
		try {
			await this.processSync(true);
		} finally {
			this.isIndexing = false;
		}
	}

	private async processSync(isUpdate: boolean): Promise<void> {
		const files = getTargetFiles(this.app, this.settings, this.chatHistoryPath, this.includedPaths, this.excludedPaths);
		debugLogger.logSystem('rag', `VaultIndexer.processSync (project=${this.projectId}): found ${files.length} target files. Included=${JSON.stringify(this.includedPaths)}, Excluded=${JSON.stringify(this.excludedPaths)}`);

		if (isUpdate) {
			const loadResult = await loadIndex(this.app, this.modelName, this.projectId);
			if (loadResult.needsFullReindex) {
				this.state.clear();
				await this.embeddingStore.clear();
				// Full reindex -> proceed with normal indexing flow below
			} else {
				this.state.loadFrom(loadResult);
				await this.embeddingStore.loadEmbeddings(this.state.childChunks).catch((e) => {
					debugLogger.logError('rag', e instanceof Error ? e : new Error(`loadEmbeddings failed: ${e}`));
				});
				const withEmb = this.state.childChunks.filter(c => c.embedding && c.embedding.length > 0).length;
				debugLogger.logSystem('rag', `updateIndex: childChunks=${this.state.childChunks.length}, with embedding=${withEmb}`);
				await this.initOramaStore();
				
				if (files.length === 0 && this.state.indexedFileCount > 0) {
					setIndexingStatus('ready', { totalFiles: this.state.indexedFileCount, processedFiles: this.state.indexedFileCount });
					return;
				}

				const { pathsToDelete, changedFiles } = await calculateIndexDiff(this.app, files, this.state.fileMtimes);
				
				if (pathsToDelete.size > 0) {
					await this.removePaths(pathsToDelete);
				}

				if (changedFiles.length === 0) {
					setIndexingStatus('ready', { totalFiles: files.length, processedFiles: files.length });
					return;
				}

				const restoreResult = await restoreFromCheckpoint(this.app, this.modelName, files, false, this.projectId);
				const changedSet = new Set(changedFiles.map(f => f.path));
				const filesToProcess = restoreResult.filesToProcess.filter(f => changedSet.has(f.path));

				if (filesToProcess.length === 0) {
					await deleteCheckpoint(this.app, this.projectId);
					await this.persist();
					setIndexingStatus('ready', { totalFiles: files.length, processedFiles: files.length });
					return;
				}

				this.indexingStartedAt = restoreResult.alreadyProcessed > 0 ? restoreResult.startedAt : Date.now();
				await this.runProcessing(files, filesToProcess, restoreResult.alreadyProcessed, restoreResult.processedPaths);
				return;
			}
		}

		// Initial Indexing Flow (or Fallback from needsFullReindex)
		const restoreResult = await restoreFromCheckpoint(this.app, this.modelName, files, true, this.projectId);

		if (restoreResult.filesToProcess.length === 0) { 
			setIndexingStatus('ready', { totalFiles: files.length, processedFiles: files.length });
			return; 
		}

		if (restoreResult.indexRestored) {
			const loadResult = await loadIndex(this.app, this.modelName, this.projectId);
			this.state.loadFrom(loadResult);
			await this.embeddingStore.loadEmbeddings(this.state.childChunks).catch((e) => {
				debugLogger.logError('rag', e instanceof Error ? e : new Error(`loadEmbeddings (indexVault path) failed: ${e}`));
			});
			const withEmb = this.state.childChunks.filter(c => c.embedding && c.embedding.length > 0).length;
			debugLogger.logSystem('rag', `indexVault (restored): childChunks=${this.state.childChunks.length}, with embedding=${withEmb}`);
		} else {
			this.state.clear();
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

	async resetIndex(): Promise<void> {
		this.currentProcessId++;
		await new Promise<void>(resolve => window.setTimeout(resolve, 0));
		this.state.clear();
		if (this.oramaStore) {
			await this.oramaStore.clear();
		}
		resetIndexing();
		await deleteCheckpoint(this.app, this.projectId);
		await this.embeddingStore.clear();
		await this.persist();
		this.isIndexing = false;
	}

	private async removePaths(paths: Set<string>): Promise<void> {
		const removedChildChunks = this.state.getRemovedChildChunks(paths);
		
		this.state.removePaths(paths);
		
		if (this.oramaStore && removedChildChunks.length > 0) {
			void this.oramaStore.deleteByIds(removedChildChunks.map(c => c.id)).catch(err => {
				debugLogger.logError('rag', err instanceof Error ? err : new Error(`Orama delete failed: ${err}`));
			});
		}
		
		if (removedChildChunks.length > 0) {
			void this.embeddingStore.deleteEmbeddings(removedChildChunks.map(c => c.id)).catch(err => {
				debugLogger.logError('rag', err instanceof Error ? err : new Error(`Embedding DB delete failed: ${err}`));
			});
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
				modelName: this.modelName, projectId: this.projectId, parentChunks: this.state.parentChunks, childChunks: this.state.childChunks,
				oramaStore: this.oramaStore!, indexedPaths: this.state.indexedPaths,
				fileMtimes: this.state.fileMtimes, fileHashes: this.state.fileHashes,
				getIsDestroyed: () => this.isDestroyed, getCurrentProcessId: () => this.currentProcessId,
				persistCache: this.persistCacheFn,
				cachePersistCheckpointInterval: this.settings.cachePersistCheckpointInterval,
				totalFileCount: totalFiles.length,
			}, this.indexingStartedAt, previousProcessedPaths);
		} finally {
			await this.persist();
		}

		setIndexingStatus('ready', { totalFiles: totalFiles.length, processedFiles: totalFiles.length });
		await deleteCheckpoint(this.app, this.projectId);
		resumedFromCheckpoint.set(false);
	}

	private async persist(): Promise<void> {
		await saveIndex(this.app, this.modelName, this.state.parentChunks, this.state.childChunks, this.state.fileMtimes, this.state.fileHashes, this.projectId);
		await this.embeddingStore.storeEmbeddings(this.state.childChunks).catch((err) => {
			debugLogger.logWarn('indexer', `embeddingStore.storeEmbeddings failed: ${err}`);
		});
	}
}