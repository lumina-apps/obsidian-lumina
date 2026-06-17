/**
 * indexer.ts
 *
 * 볼트의 마크다운 파일을 청킹 + 임베딩하여 벡터 인덱스를 관리합니다.
 *
 * 주요 기능:
 * - mtime 기반 증분 업데이트 (변경된 파일만 재인덱싱)
 * - 파일 수 기반 3단계 처리 전략 (극소량/중간/대량)
 * - checkpoint.json 기반 인덱싱 중간 저장 및 재개
 * - JSON 형태로 .obsidian/plugins/lumina/storage/index.json에 영속화
 * - schemaVersion + modelName 조합으로 모델 변경 시 자동 무효화
 * - 대용량 파일 자동 제외 (maxFileSizeMB)
 *
 * ── 구조 ──
 * VaultIndexer (본 파일)          → 오케스트레이션 + 공개 API
 * checkpointManager.ts             → 체크포인트 복원/저장 통합
 * indexProcessing.ts               → 실제 파일 읽기 + 임베딩 처리
 * fileProcessor.ts                 → 단일 파일 읽기 + 청킹
 * indexPersistence.ts              → 디스크 I/O
 */

import { App, TFile } from 'obsidian';
import type {
	DocumentChunk,
	EmbedFn,
	ParseBinaryFn,
} from '../../shared/types/rag.types';
import type { RagSettings } from '../../core/settings/settings.types';
import {
	setIndexingStatus,
	resetIndexing,
	resumedFromCheckpoint,
	setTotalFiles,
} from '../../core/store/ragStore';
import { debugLogger } from '../../shared/debugLogger';
import {
	loadIndex,
	saveIndex,
	deleteCheckpoint,
} from './indexPersistence';
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

	constructor(
		app: App,
		embedFn: EmbedFn,
		parseBinaryFn: ParseBinaryFn,
		settings: RagSettings,
		modelName: string,
		// optional callback to persist embed cache to disk
		persistCacheFn?: () => Promise<void>,
	) {
		this.app = app;
		this.embedFn = embedFn;
		this.parseBinaryFn = parseBinaryFn;
		this.settings = settings;
		this.modelName = modelName;
		this.persistCacheFn = persistCacheFn;
	}

	private persistCacheFn?: () => Promise<void>;

	// ─── Public API ──────────────────────────────────────────────────────────

	public destroy(): void {
		this.isDestroyed = true;
	}

	get indexedChunks(): DocumentChunk[] {
		return this.chunks;
	}

	get indexedFileCount(): number {
		return Object.keys(this.fileMtimes).length;
	}

	async embed(texts: string[]): Promise<number[][]> {
		return this.embedFn(texts);
	}

	/**
	 * 전체 볼트 재인덱싱 (기존 인덱스 완전히 교체).
	 * 체크포인트가 있으면 이어서 진행합니다.
	 */
	async indexVault(): Promise<void> {
		const files = getTargetFiles(this.app, this.settings);

		const restoreResult = await restoreFromCheckpoint(
			this.app,
			this.modelName,
			files,
			true, // clearOnFullReindex
		);

		debugLogger.logSystem('rag', `전체 인덱싱 시작: ${files.length}개 대상, ${restoreResult.filesToProcess.length}개 미처리`);

		// 완전히 처리 완료된 경우
		if (restoreResult.filesToProcess.length === 0) {
			// 체크포인트 복원으로 이미 완료된 상태
			return;
		}

		// 인덱스 복원
		if (restoreResult.indexRestored) {
			const loadResult = await loadIndex(this.app, this.modelName);
			this.chunks = loadResult.chunks;
			this.indexedPaths = loadResult.indexedPaths;
			this.fileMtimes = loadResult.fileMtimes;
			this.fileHashes = loadResult.fileHashes;
		} else {
			this.clearState();
		}

		this.indexingStartedAt =
			restoreResult.alreadyProcessed > 0
				? restoreResult.startedAt
				: Date.now();

		await this.runProcessing(files, restoreResult.filesToProcess);
	}

	/**
	 * 변경된 파일만 증분 업데이트.
	 */
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
			debugLogger.logSystem('rag', '파일 목록 로드 지연으로 인덱스 초기화 방지.');
			setIndexingStatus('ready', {
				totalFiles: Object.keys(this.fileMtimes).length,
				processedFiles: Object.keys(this.fileMtimes).length,
			});
			return;
		}

		// 삭제된 파일 처리
		const currentPaths = new Set(files.map(f => f.path));
		const pathsToDelete = await detectDeletedPaths(
			this.app,
			currentPaths,
			Object.keys(this.fileMtimes),
		);
		if (pathsToDelete.size > 0) {
			this.removePaths(pathsToDelete);
		}

		// 변경된 파일 감지
		const changed = files.filter(f => {
			const prev = this.fileMtimes[f.path];
			return prev === undefined || f.stat.mtime !== prev;
		});

		if (changed.length === 0) {
			setIndexingStatus('ready', {
				totalFiles: files.length,
				processedFiles: files.length,
			});
			return;
		}

		// 증분 업데이트도 체크포인트 지원
		const restoreResult = await restoreFromCheckpoint(
			this.app,
			this.modelName,
			changed,
			false, // 증분 모드 → 기존 인덱스 유지
		);
		debugLogger.logSystem('rag', `증분 인덱싱 시작: ${changed.length}개 변경 발견, ${restoreResult.filesToProcess.length}개 미처리`);

		if (restoreResult.filesToProcess.length === 0) {
			await deleteCheckpoint(this.app);
			await this.persist();
			return;
		}

		this.indexingStartedAt =
			restoreResult.alreadyProcessed > 0 ? restoreResult.startedAt : Date.now();

		await this.runProcessing(changed, restoreResult.filesToProcess);
	}

	/** 인덱스 전체 초기화 (디스크 + 메모리). 진행 중인 인덱싱이 있으면 먼저 중단합니다. */
	async resetIndex(): Promise<void> {
		this.isDestroyed = true;
		this.currentProcessId++;
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		this.clearState();
		resetIndexing();
		await deleteCheckpoint(this.app);
		await this.persist();
	}

	// ─── Internals ───────────────────────────────────────────────────────────

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
	): Promise<void> {
		this.currentProcessId++;

		debugLogger.logSystem(
			'rag',
			`인덱싱 시작: 전체 ${totalFiles.length}개, 처리할 ${filesToProcess.length}개`,
		);
		setTotalFiles(
			totalFiles.length,
			totalFiles.length - filesToProcess.length,
			this.indexingStartedAt,
		);

		await processFiles(
			filesToProcess,
			{
				app: this.app,
				embedFn: this.embedFn,
				parseBinaryFn: this.parseBinaryFn,
				chunkSize: this.settings.chunkSize,
				chunkOverlap: this.settings.chunkOverlap,
				modelName: this.modelName,
				chunks: this.chunks,
				indexedPaths: this.indexedPaths,
				fileMtimes: this.fileMtimes,
				fileHashes: this.fileHashes,
				isDestroyed: this.isDestroyed,
				currentProcessId: this.currentProcessId,
				persistCache: this.persistCacheFn,
				cachePersistCheckpointInterval: this.settings.cachePersistCheckpointInterval,
			},
			this.indexingStartedAt,
		);

		debugLogger.logSystem('rag', `인덱싱 완료: ${totalFiles.length}개`);
		setIndexingStatus('ready', {
			totalFiles: totalFiles.length,
			processedFiles: totalFiles.length,
		});
		await deleteCheckpoint(this.app);
		resumedFromCheckpoint.set(false);
		await this.persist();
	}

	private async persist(): Promise<void> {
		await saveIndex(
			this.app,
			this.modelName,
			this.chunks,
			this.fileMtimes,
			this.fileHashes,
		);
	}
}


