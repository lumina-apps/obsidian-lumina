/**
 * 파일 목록을 읽고 청킹 → 임베딩하는 실제 처리 파이프라인입니다.
 */

import { App, Notice, TFile } from 'obsidian';
import type { ParentChunk, ChildChunk, EmbedFn, ParseBinaryFn } from '../../shared/types/rag.types';
import { readAndPrepareFile } from './fileProcessor';
import { incrementProcessed, incrementProcessedBy } from '../../core/store/ragStore';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import {
	saveCheckpointIfNeeded,
	getCheckpointInterval,
	type CheckpointSaveContext,
	type IndexPersistContext,
} from './checkpointManager';
import type { OramaStore } from './oramaStore';
import type { EmbeddingStore } from './embeddingStore';

const CHUNK_EMBED_BATCH = 512;
const SMALL_VAULT_THRESHOLD = 50;
const MAX_CONSECUTIVE_EMBED_FAILURES = 3;

function isFatalEmbedError(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
	return (
		msg.includes('401') ||
		msg.includes('403') ||
		msg.includes('invalid_api_key') ||
		msg.includes('invalid api key') ||
		msg.includes('insufficient_quota') ||
		msg.includes('quota exceeded') ||
		msg.includes('unauthorized')
	);
}

function validateAndAssignEmbeddings(childChunks: ChildChunk[], embeddings: number[][]): void {
	if (!Array.isArray(embeddings) || embeddings.length < childChunks.length) {
		throw new Error(`임베딩 개수 불일치 (요청: ${childChunks.length}, 응답: ${embeddings?.length ?? 0})`);
	}
	for (let j = 0; j < childChunks.length; j++) {
		const emb = embeddings[j];
		if (!emb || emb.length === 0) {
			throw new Error(`빈 임베딩 벡터 반환 (index: ${j})`);
		}
		childChunks[j].embedding = new Float32Array(emb);
	}
}

export interface ProcessContext {
	app: App;
	embedFn: EmbedFn;
	parseBinaryFn: ParseBinaryFn;
	parentChunkSize: number;
	parentChunkOverlap: number;
	childChunkSize: number;
	childChunkOverlap: number;
	modelName: string;
	projectId: string;
	parentChunks: ParentChunk[];
	childChunks: ChildChunk[];
	oramaStore: OramaStore;
	indexedPaths: Set<string>;
	fileMtimes: Record<string, number>;
	fileHashes: Record<string, number>;
	getIsDestroyed: () => boolean;
	getCurrentProcessId: () => number;
	persistCache?: () => Promise<void>;
	cachePersistCheckpointInterval?: number;
	/** vault 전체 파일 수 (체크포인트 totalFiles 용) */
	totalFileCount: number;
	embeddingStore?: EmbeddingStore;
}

export async function processFiles(files: TFile[], ctx: ProcessContext, startedAt: number, initialProcessedPaths: string[] = []): Promise<void> {
	const fileCount = files.length;
	const readConcurrency = fileCount <= SMALL_VAULT_THRESHOLD ? 1 : 32;
	
	const processedPaths: string[] = [...initialProcessedPaths];
	const ckptTotal = ctx.totalFileCount > 0 ? ctx.totalFileCount : fileCount;
	const initialCount = initialProcessedPaths.length;
	
	const checkpointCtx: CheckpointSaveContext = {
		processedPaths, totalFiles: ckptTotal, startedAt,
		lastCheckpointAt: initialCount, checkpointInterval: getCheckpointInterval(ckptTotal), checkpointSaves: 0,
	};

	const persistIndexCtx: IndexPersistContext = {
		modelName: ctx.modelName, chunks: ctx.parentChunks, childChunks: ctx.childChunks,
		fileMtimes: ctx.fileMtimes, fileHashes: ctx.fileHashes, projectId: ctx.projectId,
	};

	const processId = ctx.getCurrentProcessId();
	const checkCancel = () => ctx.getIsDestroyed() || ctx.getCurrentProcessId() !== processId;

	if (readConcurrency === 1) {
		await processSequential(files, ctx, processedPaths, checkpointCtx, persistIndexCtx, checkCancel);
	} else {
		await processBatched(files, readConcurrency, ctx, processedPaths, checkpointCtx, persistIndexCtx, checkCancel);
	}
}

async function removePathChunks(path: string, ctx: ProcessContext): Promise<void> {
	for (let i = ctx.parentChunks.length - 1; i >= 0; i--) {
		if (ctx.parentChunks[i].path === path) {
			ctx.parentChunks.splice(i, 1);
		}
	}
	const idsToRemove: string[] = [];
	for (let i = ctx.childChunks.length - 1; i >= 0; i--) {
		if (ctx.childChunks[i].path === path) {
			idsToRemove.push(ctx.childChunks[i].id);
			ctx.childChunks.splice(i, 1);
		}
	}
	if (idsToRemove.length > 0) {
		await ctx.oramaStore.deleteByIds(idsToRemove);
		if (ctx.embeddingStore) {
			try {
				await ctx.embeddingStore.deleteEmbeddings(idsToRemove);
			} catch (err) {
				debugLogger.logWarn('rag', `Failed to delete old embeddings for ${path}: ${err}`);
			}
		}
	}
}

async function processSequential(
	files: TFile[], ctx: ProcessContext, processedPaths: string[],
	checkpointCtx: CheckpointSaveContext, persistIndexCtx: IndexPersistContext,
	checkCancel: () => boolean,
): Promise<void> {
	let consecutiveEmbedFailures = 0;
	let hasShownEmbedNotice = false;

	for (const file of files) {
		if (checkCancel()) return;
		try {
			const result = await readAndPrepareFile(file, ctx.app, ctx.parseBinaryFn,
				ctx.parentChunkSize, ctx.parentChunkOverlap, ctx.childChunkSize, ctx.childChunkOverlap,
				ctx.fileHashes, ctx.indexedPaths);
			
			if (result.skip) {
				ctx.fileMtimes[file.path] = file.stat.mtime;
				processedPaths.push(file.path);
			} else if (result.parentChunks.length === 0 && result.childChunks.length === 0) {
				await removePathChunks(file.path, ctx);
				ctx.indexedPaths.delete(file.path);
				delete ctx.fileHashes[file.path];
				ctx.fileMtimes[file.path] = file.stat.mtime;
				processedPaths.push(file.path);
			} else {
				try {
					if (result.childChunks.length > 0) {
						const embeddings = await ctx.embedFn(result.childChunks.map(c => c.text));
						if (checkCancel()) return;
						validateAndAssignEmbeddings(result.childChunks, embeddings);
					}

					// 임베딩 성공 후에 기존 청크를 교체 (실패 시 기존 인덱스 데이터 보존)
					await removePathChunks(file.path, ctx);
					ctx.indexedPaths.delete(file.path);

					if (result.childChunks.length > 0) {
						await ctx.oramaStore.insertChunks(result.childChunks);
						if (ctx.embeddingStore) {
							await ctx.embeddingStore.storeEmbeddings(result.childChunks).catch((e) => {
								debugLogger.logWarn('rag', `Incremental storeEmbeddings failed: ${e}`);
							});
						}
					}
					
					ctx.parentChunks.push(...result.parentChunks);
					ctx.childChunks.push(...result.childChunks);
					
					persistIndexCtx.chunks = ctx.parentChunks;
					persistIndexCtx.childChunks = ctx.childChunks;
					
					ctx.indexedPaths.add(file.path);
					ctx.fileHashes[file.path] = result.contentHash;
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
					consecutiveEmbedFailures = 0;
				} catch (embedErr: unknown) {
					if (checkCancel()) return;
					const errMsg = embedErr instanceof Error ? embedErr.message : String(embedErr);
					debugLogger.logError('rag', normalizeError(embedErr, `임베딩 실패: ${file.path}`));
					if (!hasShownEmbedNotice) {
						hasShownEmbedNotice = true;
						new Notice(`[Lumina] 인덱싱 중 임베딩 에러 발생: ${errMsg}`);
					}
					consecutiveEmbedFailures++;
					if (isFatalEmbedError(embedErr) || consecutiveEmbedFailures >= MAX_CONSECUTIVE_EMBED_FAILURES) {
						incrementProcessed();
						return;
					}
				}
			}
			incrementProcessed();
			
			const prevLast = checkpointCtx.lastCheckpointAt;
			checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
				ctx.app, checkpointCtx, persistIndexCtx, ctx.cachePersistCheckpointInterval ?? 1);
			if (checkpointCtx.lastCheckpointAt > prevLast) {
				if (ctx.persistCache) { void ctx.persistCache().catch(() => {}); }
			}
		} catch (err) {
			debugLogger.logError('rag', normalizeError(err, `파일 인덱싱 실패: ${file.path}`));
			incrementProcessed();
		}
	}
	
	if (processedPaths.length > checkpointCtx.lastCheckpointAt) {
		const prevLast = checkpointCtx.lastCheckpointAt;
		checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
			ctx.app, checkpointCtx, persistIndexCtx, ctx.cachePersistCheckpointInterval ?? 1);
		if (checkpointCtx.lastCheckpointAt > prevLast) {
			if (ctx.persistCache) { void ctx.persistCache().catch(() => {}); }
		}
	}
}

async function processBatched(
	files: TFile[], readConcurrency: number, ctx: ProcessContext, processedPaths: string[],
	checkpointCtx: CheckpointSaveContext, persistIndexCtx: IndexPersistContext,
	checkCancel: () => boolean,
): Promise<void> {
	let consecutiveEmbedFailures = 0;
	let hasShownEmbedNotice = false;

	for (let batchStart = 0; batchStart < files.length; batchStart += readConcurrency) {
		if (checkCancel()) return;
		const fileBatch = files.slice(batchStart, batchStart + readConcurrency);

		const readResults = await Promise.allSettled(fileBatch.map(file =>
			readAndPrepareFile(file, ctx.app, ctx.parseBinaryFn, 
				ctx.parentChunkSize, ctx.parentChunkOverlap, ctx.childChunkSize, ctx.childChunkOverlap,
				ctx.fileHashes, ctx.indexedPaths)));

		const toEmbedFiles: TFile[] = [];
		const toEmbedParentChunks: ParentChunk[] = [];
		const toEmbedChildChunks: ChildChunk[] = [];
		const toEmbedHashes: number[] = [];
		let skipCount = 0;

		for (let i = 0; i < fileBatch.length; i++) {
			const file = fileBatch[i];
			const result = readResults[i];
			if (result.status === 'rejected') {
				debugLogger.logError('rag', normalizeError(result.reason, `파일 읽기/파싱 실패: ${file.path}`));
				skipCount++;
			} else {
				const { parentChunks, childChunks, contentHash, skip } = result.value;
				if (skip) {
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
					skipCount++;
				} else if (parentChunks.length === 0 && childChunks.length === 0) {
					await removePathChunks(file.path, ctx);
					ctx.indexedPaths.delete(file.path);
					delete ctx.fileHashes[file.path];
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
					skipCount++;
				} else {
					toEmbedFiles.push(file);
					toEmbedParentChunks.push(...parentChunks);
					toEmbedChildChunks.push(...childChunks);
					toEmbedHashes.push(contentHash);
				}
			}
		}

		if (toEmbedChildChunks.length > 0 && !checkCancel()) {
			try {
				for (let i = 0; i < toEmbedChildChunks.length; i += CHUNK_EMBED_BATCH) {
					if (checkCancel()) break;
					const batch = toEmbedChildChunks.slice(i, i + CHUNK_EMBED_BATCH);
					const embeddings = await ctx.embedFn(batch.map(c => c.text));
					validateAndAssignEmbeddings(batch, embeddings);
				}
				
				if (checkCancel()) return;

				// 임베딩 성공 후 기존 청크 교체
				for (const file of toEmbedFiles) {
					await removePathChunks(file.path, ctx);
					ctx.indexedPaths.delete(file.path);
				}

				await ctx.oramaStore.insertChunks(toEmbedChildChunks);
				if (ctx.embeddingStore) {
					await ctx.embeddingStore.storeEmbeddings(toEmbedChildChunks).catch((e) => {
						debugLogger.logWarn('rag', `Batch storeEmbeddings failed: ${e}`);
					});
				}
				
				ctx.parentChunks.push(...toEmbedParentChunks);
				ctx.childChunks.push(...toEmbedChildChunks);

				persistIndexCtx.chunks = ctx.parentChunks;
				persistIndexCtx.childChunks = ctx.childChunks;
				
				for (let i = 0; i < toEmbedFiles.length; i++) {
					const file = toEmbedFiles[i];
					ctx.indexedPaths.add(file.path);
					ctx.fileHashes[file.path] = toEmbedHashes[i];
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
				}
				consecutiveEmbedFailures = 0;
			} catch (embedErr: unknown) {
				if (checkCancel()) return;
				const errMsg = embedErr instanceof Error ? embedErr.message : String(embedErr);
				debugLogger.logError('rag', normalizeError(embedErr, `배치 임베딩 실패`));
				if (!hasShownEmbedNotice) {
					hasShownEmbedNotice = true;
					new Notice(`[Lumina] 인덱싱 중 임베딩 에러 발생: ${errMsg}`);
				}
				consecutiveEmbedFailures++;
				if (isFatalEmbedError(embedErr) || consecutiveEmbedFailures >= MAX_CONSECUTIVE_EMBED_FAILURES) {
					incrementProcessedBy(skipCount + toEmbedFiles.length);
					return;
				}
			}
		} else if (toEmbedParentChunks.length > 0 && !checkCancel()) {
			for (const file of toEmbedFiles) {
				await removePathChunks(file.path, ctx);
				ctx.indexedPaths.delete(file.path);
			}
			ctx.parentChunks.push(...toEmbedParentChunks);
			persistIndexCtx.chunks = ctx.parentChunks;
			
			for (let i = 0; i < toEmbedFiles.length; i++) {
				const file = toEmbedFiles[i];
				ctx.indexedPaths.add(file.path);
				ctx.fileHashes[file.path] = toEmbedHashes[i];
				ctx.fileMtimes[file.path] = file.stat.mtime;
				processedPaths.push(file.path);
			}
		}

		if (checkCancel()) return;

		const filesDoneThisBatch = skipCount + toEmbedFiles.length;
		incrementProcessedBy(filesDoneThisBatch);

		checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
			ctx.app, checkpointCtx, persistIndexCtx, ctx.cachePersistCheckpointInterval ?? 1);
	}
}