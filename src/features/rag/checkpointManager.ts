/**
 * checkpointManager.ts
 *
 * 인덱싱 체크포인트 복원 및 저장 로직을 통합합니다.
 * indexVault()와 updateIndex() 양쪽에서 재사용됩니다.
 *
 * ── 성능 최적화 (2025.06) ──
 * - 중간 checkpoint 저장 시 saveIndex(전체 인덱스 직렬화) 제거
 *   → 체크포인트(경로 목록만 JSON)만 저장하고, 전체 인덱스는 종료 시 1회만 저장
 * - 대규모 볼트(≥5000파일)에서 체크포인트 간격을 500→2000으로 동적 조정
 *   → 디스크 I/O 부하 분산
 */

import { App, TFile } from 'obsidian';
import {
	loadIndex,
	saveCheckpoint,
	loadCheckpoint,
	deleteCheckpoint,
} from './indexPersistence';
import { setIndexingStatus, setTotalFiles, resumedFromCheckpoint } from '../../core/store/ragStore';
import { debugLogger } from '../../shared/debugLogger';

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** 기본 체크포인트 저장 간격 (파일 수) */
const BASE_CHECKPOINT_INTERVAL = 500;
/** 대규모 볼트에서 체크포인트 저장 간격을 늘릴 임계값 */
const LARGE_CHECKPOINT_THRESHOLD = 5000;
/** 대규모 볼트용 체크포인트 저장 간격 (디스크 I/O 부하 감소) */
const LARGE_CHECKPOINT_INTERVAL = 2000;

/**
 * 파일 수에 따라 동적 체크포인트 저장 간격을 반환합니다.
 * 대규모 볼트에서는 디스크 I/O 부하를 줄이기 위해 간격을 늘립니다.
 */
function getCheckpointInterval(totalFiles: number): number {
	return totalFiles >= LARGE_CHECKPOINT_THRESHOLD ? LARGE_CHECKPOINT_INTERVAL : BASE_CHECKPOINT_INTERVAL;
}

// ─── 반환 타입 ───────────────────────────────────────────────────────────────

export interface RestoreResult {
	/** 처리해야 할 파일 목록 (체크포인트 미완료분) */
	filesToProcess: TFile[];
	/** 이미 처리 완료된 파일 수 */
	alreadyProcessed: number;
	/** 인덱스 복원 여부 (기존 인덱스 로드 성공 시 true) */
	indexRestored: boolean;
	/** 체크포인트의 인덱싱 시작 시각 */
	startedAt: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 체크포인트에서 인덱싱 상태를 복원합니다.
 *
 * indexVault / updateIndex 진입 시 공통으로 호출되어
 *   - 기존 인덱스 로드
 *   - 체크포인트 확인 및 미처리 파일 목록 계산
 *   - store 상태 초기화
 * 를 수행합니다.
 *
 * @param app            Obsidian App 인스턴스
 * @param modelName      현재 임베딩 모델명 (스키마 무효화 감지용)
 * @param totalFiles     전체 대상 파일 목록
 * @param clearOnFullReindex  true=체크포인트 불일치 시 상태 초기화 (indexVault용)
 */
export async function restoreFromCheckpoint(
	app: App,
	modelName: string,
	totalFiles: TFile[],
	clearOnFullReindex: boolean,
): Promise<RestoreResult> {
	const checkpoint = await loadCheckpoint(app);

	// 기존 인덱스 로드 시도
	const loadResult = await loadIndex(app, modelName);

	// 스키마/모델 불일치 → 전체 재인덱싱
	if (loadResult.needsFullReindex) {
		if (checkpoint) await deleteCheckpoint(app);
		return {
			filesToProcess: totalFiles,
			alreadyProcessed: 0,
			indexRestored: false,
			startedAt: Date.now(),
		};
	}

	// 체크포인트가 있고, 파일 수가 일치하는지 확인
	if (checkpoint && checkpoint.totalFiles === totalFiles.length) {
		const processedSet = new Set(checkpoint.processedPaths);
		const filesToProcess = totalFiles.filter(f => !processedSet.has(f.path));
		const alreadyProcessed = checkpoint.processedPaths.length;

		if (filesToProcess.length === 0) {
			// 모든 파일이 이미 처리됨 → 완료
			if (totalFiles.length === 0 || loadResult.chunks.length > 0) {
				setIndexingStatus('ready', {
					totalFiles: totalFiles.length,
					processedFiles: totalFiles.length,
				});
				await deleteCheckpoint(app);
				return {
					filesToProcess: [],
					alreadyProcessed: totalFiles.length,
					indexRestored: true,
					startedAt: checkpoint.startedAt,
				};
			}

			debugLogger.logSystem(
				'rag',
				'완료 체크포인트 발견: 인덱스 파일이 없으므로 전체 재인덱싱을 다시 실행합니다.',
			);
			if (checkpoint) await deleteCheckpoint(app);
			setTotalFiles(totalFiles.length);
			return {
				filesToProcess: totalFiles,
				alreadyProcessed: 0,
				indexRestored: false,
				startedAt: Date.now(),
			};
		}

		debugLogger.logSystem(
			'rag',
			`체크포인트에서 이어서 인덱싱: ${alreadyProcessed}/${totalFiles.length}개 완료, ${filesToProcess.length}개 남음`,
		);
		resumedFromCheckpoint.set(true);
		setTotalFiles(totalFiles.length, alreadyProcessed, checkpoint.startedAt);

		return {
			filesToProcess,
			alreadyProcessed,
			indexRestored: true,
			startedAt: checkpoint.startedAt,
		};
	}

	// 체크포인트 없음 또는 불일치
	if (checkpoint) await deleteCheckpoint(app);

	if (clearOnFullReindex) {
		// 완전 초기화 모드 (indexVault)
		setTotalFiles(totalFiles.length);
		return {
			filesToProcess: totalFiles,
			alreadyProcessed: 0,
			indexRestored: false,
			startedAt: Date.now(),
		};
	}

	// 증분 모드 (updateIndex) — 기존 인덱스 유지
	setTotalFiles(totalFiles.length);
	return {
		filesToProcess: totalFiles,
		alreadyProcessed: 0,
		indexRestored: loadResult.chunks.length > 0,
		startedAt: Date.now(),
	};
}

// ─── Checkpoint Save ─────────────────────────────────────────────────────────

export interface CheckpointSaveContext {
	processedPaths: string[];
	totalFiles: number;
	startedAt: number;
	lastCheckpointAt: number;
	/** 파일 수 기반 동적 저장 간격 */
	checkpointInterval: number;
	/** 체크포인트가 실제로 저장된 횟수 (indexProcessing에서 사용 가능) */
	checkpointSaves?: number;
}

/**
 * 처리된 파일 수가 checkpointInterval 이상 누적되었으면
 * 체크포인트(경로 목록)만 저장하고 lastCheckpointAt을 갱신합니다.
 *
 * 성능: 중간 저장에서는 전체 인덱스(saveIndex)를 호출하지 않습니다.
 * 인덱스는 인덱싱 종료 시점에 1회만 저장됩니다.
 *
 * @returns 갱신된 lastCheckpointAt 값
 */
export async function saveCheckpointIfNeeded(
	app: App,
	ctx: CheckpointSaveContext,
): Promise<number> {
	const accumulated = ctx.processedPaths.length - ctx.lastCheckpointAt;
	if (accumulated < ctx.checkpointInterval) {
		return ctx.lastCheckpointAt;
	}

	const newLastCheckpoint = ctx.processedPaths.length;
	await saveCheckpoint(app, ctx.processedPaths, ctx.totalFiles, ctx.startedAt);
	return newLastCheckpoint;
}

/**
 * 인덱싱 완료 후 최종 체크포인트 저장 및 정리
 */
export async function finalizeCheckpoint(
	app: App,
	processedPaths: string[],
	totalFiles: number,
	startedAt: number,
): Promise<void> {
	await saveCheckpoint(app, processedPaths, totalFiles, startedAt);
}

export { getCheckpointInterval };