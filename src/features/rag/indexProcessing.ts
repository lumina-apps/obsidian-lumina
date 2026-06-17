/**
 * indexProcessing.ts
 *
 * 파일 목록을 읽고 청킹 → 임베딩하는 실제 처리 파이프라인입니다.
 *
 * 파일 개수에 따라 두 가지 전략으로 분기:
 *   [순차] ≤ SMALL_VAULT_THRESHOLD(50): 1개씩 읽기 → 즉시 임베딩 → 진행률 +1
 *   [배치] 51개 이상: readConcurrency 병렬 읽기 → 청크 배치 임베딩
 *
 * ── 성능 최적화 (2026.06) ──
 * - CHUNK_EMBED_BATCH: 128 → 512 (워커 호출 횟수 1/4 감소)
 * - EMBED_CONCURRENCY: 1 (다중 Worker 풀이 이미 병렬 처리하므로 불필요)
 * - 청크 배치마다 진행률 로그 출력 (사용자 피드백)
 * - chunkPathMap: path → Set<chunk index> 매핑으로 O(1) 청크 제거
 * - 중간 checkpoint 저장 시 전체 인덱스 직렬화 제거 (경로 목록만 저장)
 * - 대규모 볼트에서 checkpoint 간격 동적 증가
 */

import { App, TFile } from 'obsidian';
import type { DocumentChunk, EmbedFn, ParseBinaryFn } from '../../shared/types/rag.types';
import { readAndPrepareFile } from './fileProcessor';
import {
	incrementProcessed,
	incrementProcessedBy,
} from '../../core/store/ragStore';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import {
	saveCheckpointIfNeeded,
	getCheckpointInterval,
	type CheckpointSaveContext,
} from './checkpointManager';

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** 워커에 한 번에 보낼 청크 수 (512 → 대부분 파일의 전체 청크를 1회로 처리) */
const CHUNK_EMBED_BATCH = 512;

/** 극소량: 파일 1개씩 순차 처리 */
const SMALL_VAULT_THRESHOLD = 50;

// ─── ProcessContext ──────────────────────────────────────────────────────────

export interface ProcessContext {
	app: App;
	embedFn: EmbedFn;
	parseBinaryFn: ParseBinaryFn;
	chunkSize: number;
	chunkOverlap: number;
	modelName: string;
	/** VaultIndexer의 chunks 배열 (직접 mutate) */
	chunks: DocumentChunk[];
	/** VaultIndexer의 indexedPaths Set (직접 mutate) */
	indexedPaths: Set<string>;
	/** VaultIndexer의 fileMtimes (직접 mutate) */
	fileMtimes: Record<string, number>;
	/** VaultIndexer의 fileHashes (직접 mutate) */
	fileHashes: Record<string, number>;
	/** 중단 감지 */
	isDestroyed: boolean;
	currentProcessId: number;
	/** 체크포인트 저장 시 호출할 수 있는 콜백 (옵션) */
	persistCache?: () => Promise<void>;
	/** 체크포인트 저장 시 임베딩 캐시를 실제로 저장할 간격 (N번째 체크포인트마다). 기본 1 = 매번 */
	cachePersistCheckpointInterval?: number;
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * 파일 목록을 읽고 임베딩합니다.
 */
export async function processFiles(
	files: TFile[],
	ctx: ProcessContext,
	startedAt: number,
): Promise<void> {
	const fileCount = files.length;
	const readConcurrency =
		fileCount <= SMALL_VAULT_THRESHOLD ? 1 : 32;

	debugLogger.logSystem(
		'rag',
		`처리 전략: ${fileCount}개 파일 → 읽기=${readConcurrency}, 임베딩배치=${CHUNK_EMBED_BATCH}`,
	);
	debugLogger.logSystem('rag', `인덱싱 파이프라인 시작: ${fileCount}개 파일 처리 대기 중`);

	// path → chunk 인덱스 Set 매핑 빌드 (O(1) 청크 제거용)
	const chunkPathMap = buildChunkPathMap(ctx.chunks);

	const processedPaths: string[] = [];

	const checkpointCtx: CheckpointSaveContext = {
		processedPaths,
		totalFiles: fileCount,
		startedAt,
		lastCheckpointAt: 0,
		checkpointInterval: getCheckpointInterval(fileCount),
		checkpointSaves: 0,
	};

	if (readConcurrency === 1) {
		await processSequential(files, ctx, processedPaths, checkpointCtx, chunkPathMap);
	} else {
		await processBatched(
			files,
			readConcurrency,
			ctx,
			processedPaths,
			checkpointCtx,
			chunkPathMap,
		);
	}
}

// ─── Chunk-Path Map ─────────────────────────────────────────────────────────

function buildChunkPathMap(chunks: DocumentChunk[]): Map<string, Set<number>> {
	const map = new Map<string, Set<number>>();
	for (let i = 0; i < chunks.length; i++) {
		const path = chunks[i].path;
		const set = map.get(path);
		if (set) {
			set.add(i);
		} else {
			map.set(path, new Set([i]));
		}
	}
	return map;
}

function removeChunksByPath(
	chunks: DocumentChunk[],
	chunkPathMap: Map<string, Set<number>>,
	path: string,
): void {
	const indices = chunkPathMap.get(path);
	if (!indices || indices.size === 0) return;

	const sorted = Array.from(indices).sort((a, b) => b - a);
	for (const idx of sorted) {
		chunks.splice(idx, 1);
	}
	chunkPathMap.delete(path);

	const shift = sorted.length;
	for (const [p, idxSet] of chunkPathMap) {
		if (p === path) continue;
		const newSet = new Set<number>();
		for (const i of idxSet) {
			if (i >= 0) {
				let shifted = i;
				for (const removedIdx of sorted) {
					if (i > removedIdx) shifted--;
				}
				if (shifted >= 0) newSet.add(shifted);
			}
		}
		chunkPathMap.set(p, newSet);
	}
}

function registerChunksInMap(
	chunkPathMap: Map<string, Set<number>>,
	chunks: DocumentChunk[],
	newChunks: DocumentChunk[],
): void {
	const startIdx = chunks.length - newChunks.length;
	for (let i = 0; i < newChunks.length; i++) {
		const path = newChunks[i].path;
		const set = chunkPathMap.get(path);
		if (set) {
			set.add(startIdx + i);
		} else {
			chunkPathMap.set(path, new Set([startIdx + i]));
		}
	}
}

// ─── 순차 처리 (≤50개) ──────────────────────────────────────────────────────

async function processSequential(
	files: TFile[],
	ctx: ProcessContext,
	processedPaths: string[],
	checkpointCtx: CheckpointSaveContext,
	chunkPathMap: Map<string, Set<number>>,
): Promise<void> {
	debugLogger.logSystem('rag', `순차 인덱싱 모드 활성화: ${files.length}개 파일`);
	for (const file of files) {
		if (ctx.isDestroyed) return;

		try {
			const result = await readAndPrepareFile(
				file,
				ctx.app,
				ctx.parseBinaryFn,
				ctx.chunkSize,
				ctx.chunkOverlap,
				ctx.fileHashes,
				ctx.indexedPaths,
			);

			if (result.skip || result.chunks.length === 0) {
				ctx.fileMtimes[file.path] = file.stat.mtime;
			} else {
				removeChunksByPath(ctx.chunks, chunkPathMap, file.path);
				ctx.indexedPaths.delete(file.path);

				try {
					const embeddings = await ctx.embedFn(
						result.chunks.map(c => c.text),
					);
					for (let j = 0; j < result.chunks.length; j++) {
						result.chunks[j].embedding = embeddings[j];
					}
					ctx.chunks.push(...result.chunks);
					registerChunksInMap(chunkPathMap, ctx.chunks, result.chunks);
					ctx.indexedPaths.add(file.path);
					ctx.fileHashes[file.path] = result.contentHash;
					ctx.fileMtimes[file.path] = file.stat.mtime;
				} catch (embedErr) {
					debugLogger.logError(
						'rag',
						normalizeError(embedErr, `임베딩 실패: ${file.path}`),
					);
					ctx.fileMtimes[file.path] = file.stat.mtime;
				}
			}

			incrementProcessed();
			processedPaths.push(file.path);

			const prevLast = checkpointCtx.lastCheckpointAt;
			checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
				ctx.app,
				checkpointCtx,
			);
			if (checkpointCtx.lastCheckpointAt > prevLast) {
				checkpointCtx.checkpointSaves = (checkpointCtx.checkpointSaves || 0) + 1;
				const persistInterval = ctx.cachePersistCheckpointInterval ?? 1;
				if (ctx.persistCache && (checkpointCtx.checkpointSaves % persistInterval === 0)) {
					void ctx.persistCache().catch((e) => {
						debugLogger.logError('rag', new Error(`임베딩 캐시 저장 실패: ${e}`));
					});
				}
			}
		} catch (err) {
			debugLogger.logError(
				'rag',
				normalizeError(err, `파일 인덱싱 실패: ${file.path}`),
			);
			ctx.fileMtimes[file.path] = file.stat.mtime;
			processedPaths.push(file.path);
			incrementProcessed();
		}
	}

	if (processedPaths.length > checkpointCtx.lastCheckpointAt) {
		const prevLastFinal = checkpointCtx.lastCheckpointAt;
		checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
			ctx.app,
			checkpointCtx,
		);
		if (checkpointCtx.lastCheckpointAt > prevLastFinal) {
			checkpointCtx.checkpointSaves = (checkpointCtx.checkpointSaves || 0) + 1;
			const persistIntervalFinal = ctx.cachePersistCheckpointInterval ?? 1;
			if (ctx.persistCache && (checkpointCtx.checkpointSaves % persistIntervalFinal === 0)) {
				void ctx.persistCache().catch((e) => {
					debugLogger.logError('rag', new Error(`임베딩 캐시 저장 실패: ${e}`));
				});
			}
		}
	}
}

// ─── 배치 처리 (>50개) ──────────────────────────────────────────────────────

async function processBatched(
	files: TFile[],
	readConcurrency: number,
	ctx: ProcessContext,
	processedPaths: string[],
	checkpointCtx: CheckpointSaveContext,
	chunkPathMap: Map<string, Set<number>>,
): Promise<void> {
	for (
		let batchStart = 0;
		batchStart < files.length;
		batchStart += readConcurrency
	) {
		if (ctx.isDestroyed) return;

		const fileBatch = files.slice(batchStart, batchStart + readConcurrency);
		const batchNum = Math.floor(batchStart / readConcurrency) + 1;
		const totalBatches = Math.ceil(files.length / readConcurrency);
		debugLogger.logSystem(
			'rag',
			`배치 인덱싱 [${batchNum}/${totalBatches}]: ${batchStart + 1} ~ ${Math.min(batchStart + readConcurrency, files.length)} / ${files.length}`,
		);

		// ① 파일 읽기 + 청킹을 병렬 실행
		const readResults = await Promise.allSettled(
			fileBatch.map(file =>
				readAndPrepareFile(
					file,
					ctx.app,
					ctx.parseBinaryFn,
					ctx.chunkSize,
					ctx.chunkOverlap,
					ctx.fileHashes,
					ctx.indexedPaths,
				),
			),
		);

		// ② 결과 분류
		const toEmbedFiles: TFile[] = [];
		const toEmbedChunks: DocumentChunk[] = [];
		const toEmbedHashes: number[] = [];
		let skipCount = 0;

		for (let i = 0; i < fileBatch.length; i++) {
			const file = fileBatch[i];
			const result = readResults[i];

			if (result.status === 'rejected') {
				debugLogger.logError(
					'rag',
					normalizeError(result.reason, `파일 읽기 실패: ${file.path}`),
				);
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

		// ③ 수집된 청크를 CHUNK_EMBED_BATCH 단위로 순차 임베딩 (진행률 로그 포함)
		if (toEmbedChunks.length > 0 && !ctx.isDestroyed) {
			const totalChunkBatches = Math.ceil(toEmbedChunks.length / CHUNK_EMBED_BATCH);

			try {
				for (let i = 0; i < toEmbedChunks.length; i += CHUNK_EMBED_BATCH) {
					if (ctx.isDestroyed) break;

					const batch = toEmbedChunks.slice(i, i + CHUNK_EMBED_BATCH);
					const chunkBatchNum = Math.floor(i / CHUNK_EMBED_BATCH) + 1;
					debugLogger.logSystem(
						'rag',
						`  청크 임베딩 [${chunkBatchNum}/${totalChunkBatches}]: ${batch.length}개 (${i + 1}~${Math.min(i + CHUNK_EMBED_BATCH, toEmbedChunks.length)}/${toEmbedChunks.length})`,
					);

					const embeddings = await ctx.embedFn(batch.map(c => c.text));
					for (let j = 0; j < batch.length; j++) {
						batch[j].embedding = embeddings[j];
					}
				}

				// 임베딩 완료 → 인덱스에 추가
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
				debugLogger.logError(
					'rag',
					normalizeError(embedErr, `배치 임베딩 실패`),
				);
				for (const file of toEmbedFiles) {
					ctx.fileMtimes[file.path] = file.stat.mtime;
					processedPaths.push(file.path);
				}
			}
		}

		// ④ 진행률 업데이트
		const filesDoneThisBatch = skipCount + toEmbedFiles.length;
		incrementProcessedBy(filesDoneThisBatch);
		debugLogger.logSystem(
			'rag',
			`배치 완료: ${Math.min(batchStart + fileBatch.length, files.length)}/${files.length} 파일 처리됨 (${toEmbedChunks.length} 청크 임베딩)`,
		);

		// ⑤ 체크포인트 저장
		checkpointCtx.lastCheckpointAt = await saveCheckpointIfNeeded(
			ctx.app,
			checkpointCtx,
		);
	}
}