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

const CHUNK_EMBED_BATCH = 512;
const SMALL_VAULT_THRESHOLD = 50;

export interface ProcessContext {
	app: App;
	embedFn: EmbedFn;
	parseBinaryFn: ParseBinaryFn;
	parentChunkSize: number;
	parentChunkOverlap: number;
	childChunkSize: number;
	childChunkOverlap: number;
	modelName: string;
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
		fileMtimes: ctx.fileMtimes, fileHashes: ctx.fileHashes,
	};

	if (readConcurrency === 1) {
		await processSequential(files, ctx, processedPaths, checkpointCtx, persistIndexCtx);
	} else {
		await processBatched(files, readConcurrency, ctx, processedPaths, checkpointCtx, persistIndexCtx);
	}
}

async function removePathChunks(path: string, ctx: ProcessContext): Promise<void> {
	for (let i = ctx.parentChunks.length - 1; i >= 0; i--) {
		if (ctx.parentChunks[i].path === path) {
			ctx.parentChunks.splice(i, 1);
		}
	}
	for (let i = ctx.childChunks.length - 1; i >= 0; i--) {
		if (ctx.childChunks[i].path === path) {
			ctx.childChunks.splice(i, 1);
		}
	}
	await ctx.oramaStore.deleteByPathPrefix(path);
}

async function processSequential(
	files: TFile[], ctx: ProcessContext, processedPaths: string[],
	checkpointCtx: CheckpointSaveContext, persistIndexCtx: IndexPersistContext,
): Promise<void> {
	for (const file of files) {
		if (ctx.getIsDestroyed()) return;
		try {
			const result = await readAndPrepareFile(file, ctx.app, ctx.parseBinaryFn,
				ctx.parentChunkSize, ctx.parentChunkOverlap, ctx.childChunkSize, ctx.childChunkOverlap,
				ctx.fileHashes, ctx.indexedPaths);
			
			if (result.skip || (result.parentChunks.length === 0 && result.childChunks.length === 0)) {
				ctx.fileMtimes[file.path] = file.stat.mtime;
			} else {
				await removePathChunks(file.path, ctx);
				ctx.indexedPaths.delete(file.path);
				
				try {
					if (result.childChunks.length > 0) {
						const embeddings = await ctx.embedFn(result.childChunks.map(c => c.text));
						for (let j = 0; j < result.childChunks.length; j++) {
							result.childChunks[j].embedding = new Float32Array(embeddings[j]);
						}
						await ctx.oramaStore.insertChunks(result.childChunks);
					}
					
					ctx.parentChunks.push(...result.parentChunks);
					ctx.childChunks.push(...result.childChunks);
					
					persistIndexCtx.chunks = ctx.parentChunks;
					persistIndexCtx.childChunks = ctx.childChunks;
					
					ctx.indexedPaths.add(file.path);
					ctx.fileHashes[file.path] = result.contentHash;
					ctx.fileMtimes[file.path] = file.stat.mtime;
				} catch (embedErr: unknown) {
					if (ctx.getIsDestroyed()) return;
					const errMsg = embedErr instanceof Error ? embedErr.message : String(embedErr);
					debugLogger.logError('rag', normalizeError(embedErr, `임베딩 실패: ${file.path}`));
					new Notice(`[Lumina] 인덱싱 중 임베딩 에러 발생: ${errMsg}`);
					ctx.fileMtimes[file.path] = file.stat.mtime;
				}
			}
			incrementProcessed();
			processedPaths.push(file.path);
			
			const prevLast = checkpointCtx.lastCheckpointAt;
			checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
				ctx.app, checkpointCtx, persistIndexCtx, ctx.cachePersistCheckpointInterval ?? 1);
			if (checkpointCtx.lastCheckpointAt > prevLast) {
				if (ctx.persistCache) { void ctx.persistCache().catch(() => {}); }
			}
		} catch (err) {
			debugLogger.logError('rag', normalizeError(err, `파일 인덱싱 실패: ${file.path}`));
			ctx.fileMtimes[file.path] = file.stat.mtime;
			processedPaths.push(file.path);
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
): Promise<void> {
	for (let batchStart = 0; batchStart < files.length; batchStart += readConcurrency) {
		if (ctx.getIsDestroyed()) return;
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
				ctx.fileMtimes[file.path] = file.stat.mtime;
				processedPaths.push(file.path);
				skipCount++;
			} else {
				const { parentChunks, childChunks, contentHash, skip } = result.value;
				if (skip || (parentChunks.length === 0 && childChunks.length === 0)) {
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
					skipCount++;
				} else {
					await removePathChunks(file.path, ctx);
					ctx.indexedPaths.delete(file.path);
					
					toEmbedFiles.push(file);
					toEmbedParentChunks.push(...parentChunks);
					toEmbedChildChunks.push(...childChunks);
					toEmbedHashes.push(contentHash);
				}
			}
		}

		if (toEmbedChildChunks.length > 0 && !ctx.getIsDestroyed()) {
			try {
				for (let i = 0; i < toEmbedChildChunks.length; i += CHUNK_EMBED_BATCH) {
					if (ctx.getIsDestroyed()) break;
					const batch = toEmbedChildChunks.slice(i, i + CHUNK_EMBED_BATCH);
					const embeddings = await ctx.embedFn(batch.map(c => c.text));
					for (let j = 0; j < batch.length; j++) {
						batch[j].embedding = new Float32Array(embeddings[j]);
					}
				}
				
				await ctx.oramaStore.insertChunks(toEmbedChildChunks);
				
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
			} catch (embedErr: unknown) {
				if (ctx.getIsDestroyed()) return;
				const errMsg = embedErr instanceof Error ? embedErr.message : String(embedErr);
				debugLogger.logError('rag', normalizeError(embedErr, `배치 임베딩 실패`));
				new Notice(`[Lumina] 인덱싱 중 임베딩 에러 발생: ${errMsg}`);
				for (const file of toEmbedFiles) {
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
				}
			}
		} else if (toEmbedParentChunks.length > 0 && !ctx.getIsDestroyed()) {
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

		const filesDoneThisBatch = skipCount + toEmbedFiles.length;
		incrementProcessedBy(filesDoneThisBatch);

		checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
			ctx.app, checkpointCtx, persistIndexCtx, ctx.cachePersistCheckpointInterval ?? 1);
	}
}