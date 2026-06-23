/**
 * 인덱싱 체크포인트 복원 및 저장 로직을 통합합니다.
 */

import { App, TFile } from 'obsidian';
import {
	loadIndex,
	saveIndex,
	saveCheckpoint,
	loadCheckpoint,
	deleteCheckpoint,
} from './indexPersistence';
import type { ParentChunk, ChildChunk } from '../../shared/types/rag.types';
import { setIndexingStatus, setTotalFiles, resumedFromCheckpoint } from '../../core/store/ragStore';

/** 체크포인트 저장 간격 (파일 수) */
const CHECKPOINT_INTERVAL = 500;

function getCheckpointInterval(_totalFiles: number): number {
	return CHECKPOINT_INTERVAL;
}

const EMPTY_PATHS: string[] = [];

export interface RestoreResult {
	filesToProcess: TFile[];
	alreadyProcessed: number;
	indexRestored: boolean;
	startedAt: number;
	processedPaths: string[];
}

export async function restoreFromCheckpoint(
	app: App,
	modelName: string,
	totalFiles: TFile[],
	clearOnFullReindex: boolean,
): Promise<RestoreResult> {
	let checkpoint = await loadCheckpoint(app);
	const loadResult = await loadIndex(app, modelName);

	if (loadResult.needsFullReindex) {
		if (checkpoint) await deleteCheckpoint(app);
		return { filesToProcess: totalFiles, alreadyProcessed: 0, indexRestored: false, startedAt: Date.now(), processedPaths: EMPTY_PATHS };
	}

	// 100% 완료된 체크포인트가 남아있는 경우(Windows 파일락 등) 무시하고 삭제
	if (checkpoint && checkpoint.totalFiles > 0 && checkpoint.processedPaths.length >= checkpoint.totalFiles) {
		await deleteCheckpoint(app);
		// 체크포인트가 없는 것과 동일하게 처리하기 위해 변수 초기화
		checkpoint = null;
	}

	if (checkpoint && (clearOnFullReindex ? checkpoint.totalFiles === totalFiles.length : true)) {
		const processedSet = new Set(checkpoint.processedPaths);
		const filesToProcess = totalFiles.filter(f => !processedSet.has(f.path));
		const alreadyProcessed = checkpoint.processedPaths.length;

		if (filesToProcess.length === 0) {
			if (totalFiles.length === 0 || loadResult.chunks.length > 0) {
				setIndexingStatus('ready', { totalFiles: totalFiles.length, processedFiles: totalFiles.length });
				await deleteCheckpoint(app);
				return { filesToProcess: [], alreadyProcessed: totalFiles.length, indexRestored: true, startedAt: checkpoint.startedAt, processedPaths: checkpoint.processedPaths };
			}
			if (checkpoint) await deleteCheckpoint(app);
			setTotalFiles(totalFiles.length);
			return { filesToProcess: totalFiles, alreadyProcessed: 0, indexRestored: false, startedAt: Date.now(), processedPaths: EMPTY_PATHS };
		}

		resumedFromCheckpoint.set(true);
		setTotalFiles(totalFiles.length, alreadyProcessed, checkpoint.startedAt);
		return { filesToProcess, alreadyProcessed, indexRestored: true, startedAt: checkpoint.startedAt, processedPaths: checkpoint.processedPaths };
	}

	if (checkpoint) await deleteCheckpoint(app);

	if (clearOnFullReindex) {
		setTotalFiles(totalFiles.length);
		return { filesToProcess: totalFiles, alreadyProcessed: 0, indexRestored: false, startedAt: Date.now(), processedPaths: EMPTY_PATHS };
	}

	setTotalFiles(totalFiles.length);
	return { filesToProcess: totalFiles, alreadyProcessed: 0, indexRestored: loadResult.chunks.length > 0, startedAt: Date.now(), processedPaths: EMPTY_PATHS };
}

export interface CheckpointSaveContext {
	processedPaths: string[];
	totalFiles: number;
	startedAt: number;
	lastCheckpointAt: number;
	checkpointInterval: number;
	checkpointSaves?: number;
}

export interface IndexPersistContext {
	modelName: string;
	chunks: ParentChunk[];
	childChunks: ChildChunk[];
	fileMtimes: Record<string, number>;
	fileHashes: Record<string, number>;
}

export async function saveCheckpointIfNeeded(
	app: App,
	ctx: CheckpointSaveContext,
	persistIndexCtx?: IndexPersistContext,
	persistIndexInterval: number = 1,
): Promise<number> {
	const accumulated = ctx.processedPaths.length - ctx.lastCheckpointAt;
	if (accumulated < ctx.checkpointInterval) {
		return ctx.lastCheckpointAt;
	}

	const newLastCheckpoint = ctx.processedPaths.length;

	await saveCheckpoint(app, ctx.processedPaths, ctx.totalFiles, ctx.startedAt);

	if (persistIndexCtx) {
		const saves = (ctx.checkpointSaves ?? 0) + 1;
		ctx.checkpointSaves = saves;
		if (saves % persistIndexInterval === 0) {
			await saveIndex(app, persistIndexCtx.modelName, persistIndexCtx.chunks, persistIndexCtx.childChunks, persistIndexCtx.fileMtimes, persistIndexCtx.fileHashes);
		}
	}

	return newLastCheckpoint;
}

export async function finalizeCheckpoint(app: App, processedPaths: string[], totalFiles: number, startedAt: number): Promise<void> {
	await saveCheckpoint(app, processedPaths, totalFiles, startedAt);
}

export { getCheckpointInterval };