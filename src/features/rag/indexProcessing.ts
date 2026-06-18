/**
 * 파일 목록을 읽고 청킹 → 임베딩하는 실제 처리 파이프라인입니다.
 */

import { App, TFile } from 'obsidian';
import type { DocumentChunk, EmbedFn, ParseBinaryFn } from '../../shared/types/rag.types';
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

const CHUNK_EMBED_BATCH = 512;
const SMALL_VAULT_THRESHOLD = 50;

export interface ProcessContext {
	app: App;
	embedFn: EmbedFn;
	parseBinaryFn: ParseBinaryFn;
	chunkSize: number;
	chunkOverlap: number;
	modelName: string;
	chunks: DocumentChunk[];
	indexedPaths: Set<string>;
	fileMtimes: Record<string, number>;
	fileHashes: Record<string, number>;
	isDestroyed: boolean;
	currentProcessId: number;
	persistCache?: () => Promise<void>;
	cachePersistCheckpointInterval?: number;
	/** vault 전체 파일 수 (체크포인트 totalFiles 용) */
	totalFileCount: number;
}

export async function processFiles(files: TFile[], ctx: ProcessContext, startedAt: number, initialProcessedPaths: string[] = []): Promise<void> {
	const fileCount = files.length;
	const readConcurrency = fileCount <= SMALL_VAULT_THRESHOLD ? 1 : 32;
	const chunkPathMap = buildChunkPathMap(ctx.chunks);
	// 이전 체크포인트에서 복원된 경로를 포함 (중첩 종료/재시작 시 손실 방지)
	const processedPaths: string[] = [...initialProcessedPaths];

	// 체크포인트 totalFiles는 vault 전체 파일 수 기준 (재시작 시 불일치 방지)
	const ckptTotal = ctx.totalFileCount > 0 ? ctx.totalFileCount : fileCount;
	const initialCount = initialProcessedPaths.length;
	const checkpointCtx: CheckpointSaveContext = {
		processedPaths, totalFiles: ckptTotal, startedAt,
		lastCheckpointAt: initialCount, checkpointInterval: getCheckpointInterval(ckptTotal), checkpointSaves: 0,
	};

	const persistIndexCtx: IndexPersistContext = {
		modelName: ctx.modelName, chunks: ctx.chunks,
		fileMtimes: ctx.fileMtimes, fileHashes: ctx.fileHashes,
	};

	if (readConcurrency === 1) {
		await processSequential(files, ctx, processedPaths, checkpointCtx, persistIndexCtx, chunkPathMap);
	} else {
		await processBatched(files, readConcurrency, ctx, processedPaths, checkpointCtx, persistIndexCtx, chunkPathMap);
	}
}

function buildChunkPathMap(chunks: DocumentChunk[]): Map<string, Set<number>> {
	const map = new Map<string, Set<number>>();
	for (let i = 0; i < chunks.length; i++) {
		const path = chunks[i].path;
		const set = map.get(path);
		if (set) { set.add(i); } else { map.set(path, new Set([i])); }
	}
	return map;
}

function removeChunksByPath(chunks: DocumentChunk[], chunkPathMap: Map<string, Set<number>>, path: string): void {
	const indices = chunkPathMap.get(path);
	if (!indices || indices.size === 0) return;
	const sorted = Array.from(indices).sort((a, b) => b - a);
	for (const idx of sorted) { chunks.splice(idx, 1); }
	chunkPathMap.delete(path);
	for (const [p, idxSet] of chunkPathMap) {
		if (p === path) continue;
		const newSet = new Set<number>();
		for (const i of idxSet) {
			let shifted = i;
			for (const removedIdx of sorted) { if (i > removedIdx) shifted--; }
			if (shifted >= 0) newSet.add(shifted);
		}
		chunkPathMap.set(p, newSet);
	}
}

function registerChunksInMap(chunkPathMap: Map<string, Set<number>>, chunks: DocumentChunk[], newChunks: DocumentChunk[]): void {
	const startIdx = chunks.length - newChunks.length;
	for (let i = 0; i < newChunks.length; i++) {
		const path = newChunks[i].path;
		const set = chunkPathMap.get(path);
		if (set) { set.add(startIdx + i); } else { chunkPathMap.set(path, new Set([startIdx + i])); }
	}
}

async function processSequential(
	files: TFile[], ctx: ProcessContext, processedPaths: string[],
	checkpointCtx: CheckpointSaveContext, persistIndexCtx: IndexPersistContext,
	chunkPathMap: Map<string, Set<number>>,
): Promise<void> {
	for (const file of files) {
		if (ctx.isDestroyed) return;
		try {
			const result = await readAndPrepareFile(file, ctx.app, ctx.parseBinaryFn,
				ctx.chunkSize, ctx.chunkOverlap, ctx.fileHashes, ctx.indexedPaths);
			if (result.skip || result.chunks.length === 0) {
				ctx.fileMtimes[file.path] = file.stat.mtime;
			} else {
				removeChunksByPath(ctx.chunks, chunkPathMap, file.path);
				ctx.indexedPaths.delete(file.path);
				try {
					const embeddings = await ctx.embedFn(result.chunks.map(c => c.text));
					for (let j = 0; j < result.chunks.length; j++) {
						result.chunks[j].embedding = new Float32Array(embeddings[j]);
					}
					ctx.chunks.push(...result.chunks);
					registerChunksInMap(chunkPathMap, ctx.chunks, result.chunks);
					ctx.indexedPaths.add(file.path);
					ctx.fileHashes[file.path] = result.contentHash;
					ctx.fileMtimes[file.path] = file.stat.mtime;
				} catch (embedErr) {
					debugLogger.logError('rag', normalizeError(embedErr, `임베딩 실패: ${file.path}`));
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
	chunkPathMap: Map<string, Set<number>>,
): Promise<void> {
	for (let batchStart = 0; batchStart < files.length; batchStart += readConcurrency) {
		if (ctx.isDestroyed) return;
		const fileBatch = files.slice(batchStart, batchStart + readConcurrency);

		const readResults = await Promise.allSettled(fileBatch.map(file =>
			readAndPrepareFile(file, ctx.app, ctx.parseBinaryFn, ctx.chunkSize, ctx.chunkOverlap, ctx.fileHashes, ctx.indexedPaths)));

		const toEmbedFiles: TFile[] = [];
		const toEmbedChunks: DocumentChunk[] = [];
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
				const { chunks, contentHash, skip } = result.value;
				if (skip || chunks.length === 0) {
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
					skipCount++;
				} else {
					removeChunksByPath(ctx.chunks, chunkPathMap, file.path);
					ctx.indexedPaths.delete(file.path);
					toEmbedFiles.push(file);
					toEmbedChunks.push(...chunks);
					toEmbedHashes.push(contentHash);
				}
			}
		}

		if (toEmbedChunks.length > 0 && !ctx.isDestroyed) {
			try {
				for (let i = 0; i < toEmbedChunks.length; i += CHUNK_EMBED_BATCH) {
					if (ctx.isDestroyed) break;
					const batch = toEmbedChunks.slice(i, i + CHUNK_EMBED_BATCH);
					const embeddings = await ctx.embedFn(batch.map(c => c.text));
					for (let j = 0; j < batch.length; j++) {
						batch[j].embedding = new Float32Array(embeddings[j]);
					}
				}
				ctx.chunks.push(...toEmbedChunks);
				registerChunksInMap(chunkPathMap, ctx.chunks, toEmbedChunks);
				for (let i = 0; i < toEmbedFiles.length; i++) {
					const file = toEmbedFiles[i];
					ctx.indexedPaths.add(file.path);
					ctx.fileHashes[file.path] = toEmbedHashes[i];
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
				}
			} catch (embedErr) {
				debugLogger.logError('rag', normalizeError(embedErr, `배치 임베딩 실패`));
				for (const file of toEmbedFiles) {
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
				}
			}
		}

		const filesDoneThisBatch = skipCount + toEmbedFiles.length;
		incrementProcessedBy(filesDoneThisBatch);

		checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
			ctx.app, checkpointCtx, persistIndexCtx, ctx.cachePersistCheckpointInterval ?? 1);
	}
}