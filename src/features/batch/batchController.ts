/**
 * batchController.ts
 *
 * Lumina Batch Studio의 실행 오케스트레이터 컨트롤러.
 * - 1개 노트 샘플 미리보기 실행
 * - 백그라운드 배치 큐 순차 실행 (일시정지/재개/중단/429 자동 대기/실패 항목 재시도)
 * - 개별 수락(Auto-advance) 및 일괄 수락 처리
 * - 반영 직전 원본 스냅샷 저장 및 원클릭 배치 롤백(Undo)
 */

import { App, Notice, TFile } from 'obsidian';
import type LuminaPlugin from '../../main';
import {
	addBatchHistoryEntry,
	appendSnapshotsToHistoryEntry,
	getBatchState,
	markBatchHistoryRolledBack,
	patchBatchState,
	setBatchQueue,
	setBatchSelectedPath,
	updateBatchQueueItem,
} from '../../core/store/batchStore';
import {
	canUseFeature,
	canUseProFeature,
	FREE_MAX_BATCH_FILES,
} from '../../core/store/entitlementStore';
import { notifyProFeatureLocked } from '../../shared/utils/proUpgradeModal';
import { getActiveProject } from '../../core/store/projectStore';
import { debugLogger } from '../../shared/debugLogger';
import { t } from '../../shared/locales/helpers';
import type {
	BatchProposedChange,
	BatchQueueItem,
	BatchRecipeId,
	BatchSnapshotEntry,
} from '../../shared/types/batch.types';
import { normalizeError } from '../../shared/utils/errorUtils';
import { ensureFolderExists } from '../../shared/utils/fileUtils';
import { formatLlmError } from '../../shared/utils/llmErrorFormatter';
import { applyProposedToFile } from './batchApplyHelper';
import {
	filterOutExistingSummaryCallouts,
	resolveTargetFiles,
} from './batchTargetResolver';
import {
	executeRecipeForFile,
	isRateLimitError,
	resolveBatchProviderAndModel,
} from './recipes/batchRecipes';

/** 기본 Rate Limit 재시도 대기 시간 (초) */
const DEFAULT_RATE_LIMIT_WAIT_SEC = 10;
/** Rate Limit 최대 자동 재시도 횟수 */
const MAX_RATE_LIMIT_RETRIES = 2;

/** 현재 활성 실행 중인 배치 AbortController (언로드/권한 해제 시 즉시 중단용) */
let activeRunAbortController: AbortController | null = null;
let activePauseWaker: (() => void) | null = null;

/**
 * 플러그인 언로드 또는 Pro 권한 해제 시 백그라운드에서 실행 중인 배치 작업을 즉시 중단합니다.
 */
export function abortActiveBatchRun(): void {
	if (activeRunAbortController) {
		activeRunAbortController.abort();
		activeRunAbortController = null;
	}
	if (activePauseWaker) {
		activePauseWaker();
		activePauseWaker = null;
	}
}

export interface BatchControllerOptions {
	/** 테스트 환경에서 Rate Limit 대기 시간을 단축하기 위한 옵션 (ms) */
	rateLimitRetryWaitMs?: number;
}

/**
 * Lumina Batch Studio 컨트롤러 클래스
 */
export class BatchStudioController {
	private app: App;
	private plugin: LuminaPlugin;
	private abortController: AbortController | null = null;
	private isPaused = false;
	private pauseResolver: (() => void) | null = null;
	private rateLimitRetryWaitMs: number;

	constructor(plugin: LuminaPlugin, opts?: BatchControllerOptions) {
		this.app = plugin.app;
		this.plugin = plugin;
		this.rateLimitRetryWaitMs = opts?.rateLimitRetryWaitMs ?? DEFAULT_RATE_LIMIT_WAIT_SEC * 1000;
	}

	/**
	 * 현재 선택된 조건의 첫 번째 노트(또는 지정한 샘플 노트) 1개로 미리보기 테스트를 실행합니다.
	 */
	async runSampleTest(explicitPath?: string): Promise<void> {
		if (!canUseFeature('batch-studio')) return;
		const state = getBatchState();
		if (!canUseProFeature('batch-studio') && state.activeRecipeId === 'custom-prompt') {
			notifyProFeatureLocked(this.app, 'batch-studio', t('batchStudio.proCustomPromptNotice'));
			return;
		}

		let { matched } = resolveTargetFiles(
			this.app,
			state.scopeConfig,
			state.activeRecipeId,
			state.recipeOptions,
			getActiveProject()?.ragExcludedPaths ?? [],
		);

		if (
			state.activeRecipeId === 'summary-callout' &&
			state.scopeConfig.skipIfAlreadyHasTarget &&
			matched.length > 0
		) {
			matched = await filterOutExistingSummaryCallouts(this.app, matched);
		}

		const validSamplePath =
			state.sampleFilePath && matched.some((m) => m.path === state.sampleFilePath)
				? state.sampleFilePath
				: '';
		const targetPath = explicitPath || validSamplePath || matched[0]?.path || '';
		if (!targetPath) {
			patchBatchState({
				sampleResult: null,
				sampleNoChanges: false,
				sampleError: t('batchStudio.sample.noTargetNotes'),
			});
			return;
		}

		const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
		if (!(abstractFile instanceof TFile)) {
			patchBatchState({
				sampleResult: null,
				sampleNoChanges: false,
				sampleError: t('batchStudio.sample.noTargetNotes'),
			});
			return;
		}

		patchBatchState({
			sampleFilePath: targetPath,
			sampleRunning: true,
			sampleResult: null,
			sampleNoChanges: false,
			sampleError: null,
		});

		try {
			const res = await executeRecipeForFile(
				this.app,
				this.plugin,
				abstractFile,
				state.activeRecipeId,
				state.recipeOptions,
				{
					skipIfAlreadyHasTarget: state.scopeConfig.skipIfAlreadyHasTarget,
					minContentLength: state.scopeConfig.minContentLength,
					excludedPaths: getActiveProject()?.ragExcludedPaths ?? [],
				},
			);

			if (res.proposed) {
				patchBatchState({
					sampleRunning: false,
					sampleResult: res.proposed,
					sampleNoChanges: false,
					sampleError: null,
				});
			} else {
				patchBatchState({
					sampleRunning: false,
					sampleResult: null,
					sampleNoChanges: true,
					sampleError: null,
				});
			}
		} catch (err) {
			const formatted = formatLlmError(err);
			debugLogger.logError('batch', normalizeError(err, `Sample test failed: ${formatted}`));
			patchBatchState({
				sampleRunning: false,
				sampleResult: null,
				sampleNoChanges: false,
				sampleError: formatted,
			});
		}
	}

	/**
	 * 필터링된 대상 노트 전체에 대한 배치 실행 큐를 생성하고 백그라운드 처리를 시작합니다.
	 */
	async startBatch(): Promise<void> {
		if (!canUseFeature('batch-studio')) return;
		const state = getBatchState();
		if (state.runState === 'running' || state.runState === 'paused') return;
		const isProBatch = canUseProFeature('batch-studio');
		if (!isProBatch && state.activeRecipeId === 'custom-prompt') {
			notifyProFeatureLocked(this.app, 'batch-studio', t('batchStudio.proCustomPromptNotice'));
			return;
		}

		// LLM 기반 레시피 및 폴더 이동 설정 선검증
		const needsLlm =
			state.activeRecipeId !== 'autolink' &&
			(state.activeRecipeId !== 'folder-move' ||
				state.recipeOptions.moveConfig?.mode === 'ai-route');

		if (needsLlm) {
			try {
				resolveBatchProviderAndModel(this.plugin, state.recipeOptions);
			} catch (err) {
				new Notice(formatLlmError(err));
				return;
			}
			if (
				state.activeRecipeId === 'custom-prompt' &&
				!state.recipeOptions.customPrompt.trim()
			) {
				new Notice(t('batchStudio.options.customPromptPlaceholder'));
				return;
			}
		}

		if (state.activeRecipeId === 'folder-move') {
			const moveCfg = state.recipeOptions.moveConfig;
			if (!moveCfg || moveCfg.mode === 'none') {
				new Notice(t('batchStudio.options.moveNoTargetNotice'));
				return;
			}
			if (moveCfg.mode === 'fixed' && !moveCfg.fixedTargetFolder.trim()) {
				new Notice(t('batchStudio.options.moveNoTargetNotice'));
				return;
			}
			if (
				moveCfg.mode === 'by-tag' &&
				moveCfg.tagMappings.length === 0 &&
				!moveCfg.fallbackFolder.trim()
			) {
				new Notice(t('batchStudio.options.moveNoRulesNotice'));
				return;
			}
			if (moveCfg.mode === 'ai-route' && moveCfg.aiCandidateFolders.length === 0) {
				new Notice(t('batchStudio.options.moveNoCandidatesNotice'));
				return;
			}
		}

		let { matched } = resolveTargetFiles(
			this.app,
			state.scopeConfig,
			state.activeRecipeId,
			state.recipeOptions,
			getActiveProject()?.ragExcludedPaths ?? [],
		);

		if (
			state.activeRecipeId === 'summary-callout' &&
			state.scopeConfig.skipIfAlreadyHasTarget &&
			matched.length > 0
		) {
			matched = await filterOutExistingSummaryCallouts(this.app, matched);
		}

		if (matched.length === 0) {
			new Notice(t('batchStudio.sample.noTargetNotes'));
			return;
		}

		const activeLimit = isProBatch ? matched.length : FREE_MAX_BATCH_FILES;
		const initialQueue: BatchQueueItem[] = matched.map((file, idx) => ({
			path: file.path,
			basename: file.basename,
			status: idx < activeLimit ? 'queued' : 'locked',
			selected: idx < activeLimit,
		}));

		const runHistoryId = crypto.randomUUID();
		setBatchQueue(initialQueue);
		patchBatchState({
			activeMainTab: 'workspace',
			isConfigCollapsed: true,
			runState: 'running',
			selectedPath: null,
			queueFilter: 'all',
			rateLimitCountdownSec: null,
			activeRunHistoryId: runHistoryId,
		});

		const targetPaths = new Set(
			initialQueue.filter((q) => q.status === 'queued').map((q) => q.path),
		);
		await this.processQueueItems(targetPaths, state.activeRecipeId);
	}

	/**
	 * 현재 실행 중인 배치 작업을 일시정지합니다.
	 */
	pauseBatch(): void {
		const state = getBatchState();
		if (state.runState !== 'running') return;
		this.isPaused = true;
		patchBatchState({ runState: 'paused' });
	}

	/**
	 * 일시정지된 배치 작업을 이어서 재개합니다.
	 */
	resumeBatch(): void {
		const state = getBatchState();
		if (state.runState !== 'paused') return;
		this.isPaused = false;
		patchBatchState({ runState: 'running' });
		if (this.pauseResolver) {
			const resolve = this.pauseResolver;
			this.pauseResolver = null;
			activePauseWaker = null;
			resolve();
		}
	}

	/**
	 * 실행 중이거나 일시정지된 배치 작업을 중단합니다. (이미 생성된 staged 항목은 유지됨)
	 */
	cancelBatch(): void {
		this.isPaused = false;
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		activeRunAbortController = null;

		if (this.pauseResolver) {
			const resolve = this.pauseResolver;
			this.pauseResolver = null;
			activePauseWaker = null;
			resolve();
		}

		const currentQueue = getBatchState().queue;
		for (const item of currentQueue) {
			if (item.status === 'queued' || item.status === 'running') {
				updateBatchQueueItem(item.path, {
					status: 'skipped',
					selected: false,
					cancelledByUser: true,
				});
			}
		}

		patchBatchState({
			runState: 'completed',
			rateLimitCountdownSec: null,
		});
	}

	/**
	 * 실패(failed) 상태인 항목들만 다시 대기열에 올려 재실행합니다.
	 */
	async retryFailedItems(): Promise<void> {
		if (!canUseFeature('batch-studio')) return;
		const state = getBatchState();
		if (state.runState === 'running' || state.runState === 'paused') return;

		const failedItems = state.queue.filter((item) => item.status === 'failed');
		if (failedItems.length === 0) return;

		const targetPaths = new Set<string>();
		for (const item of failedItems) {
			targetPaths.add(item.path);
			updateBatchQueueItem(item.path, {
				status: 'queued',
				selected: true,
				errorMessage: undefined,
			});
		}

		patchBatchState({
			runState: 'running',
			rateLimitCountdownSec: null,
		});

		await this.processQueueItems(targetPaths, state.activeRecipeId);
	}

	/**
	 * 사용자 중단(cancelBatch)으로 미실행된 항목들만 다시 대기열에 올려 이어서 실행합니다.
	 * 이미 생성된 staged/applied 항목은 그대로 보존됩니다.
	 */
	async resumeCancelledItems(): Promise<void> {
		if (!canUseFeature('batch-studio')) return;
		const state = getBatchState();
		if (state.runState === 'running' || state.runState === 'paused') return;

		const cancelledItems = state.queue.filter(
			(item) => item.status === 'skipped' && item.cancelledByUser,
		);
		if (cancelledItems.length === 0) return;

		const targetPaths = new Set<string>();
		for (const item of cancelledItems) {
			targetPaths.add(item.path);
			updateBatchQueueItem(item.path, {
				status: 'queued',
				selected: true,
				cancelledByUser: false,
				errorMessage: undefined,
			});
		}

		patchBatchState({
			runState: 'running',
			isConfigCollapsed: true,
			rateLimitCountdownSec: null,
		});

		await this.processQueueItems(targetPaths, state.activeRecipeId);
	}

	/**
	 * 우측 상세 검수 패널에서 사용자가 직접 수정한 프론트매터 제안(태그 추가/삭제, 설명 편집 등)을 반영합니다.
	 */
	updateProposedFrontmatter(
		path: string,
		updates: {
			afterTags?: string[];
			afterDescription?: string;
			afterCustomFmVal?: string;
		},
	): void {
		const item = getBatchState().queue.find((q) => q.path === path);
		if (!item?.proposed || item.proposed.kind !== 'frontmatter') return;

		updateBatchQueueItem(path, {
			proposed: {
				...item.proposed,
				...(updates.afterTags !== undefined ? { afterTags: [...updates.afterTags] } : {}),
				...(updates.afterDescription !== undefined
					? { afterDescription: updates.afterDescription }
					: {}),
				...(updates.afterCustomFmVal !== undefined
					? { afterCustomFmVal: updates.afterCustomFmVal }
					: {}),
			},
		});
	}

	/**
	 * 지정한 노트 1건의 제안을 실제 파일에 즉시 적용하고, 다음 'staged' 노트로 포커스를 자동 이동(Auto-advance)합니다.
	 * (마지막 staged 항목이었던 경우에는 적용 완료 배지를 확인할 수 있도록 현재 노트에 포커스를 유지합니다.)
	 */
	async applySingleItem(path: string): Promise<boolean> {
		if (!canUseFeature('batch-studio')) return false;
		const state = getBatchState();
		const item = state.queue.find((q) => q.path === path);
		if (!item || item.status !== 'staged' || !item.proposed) return false;

		const abstractFile = this.app.vault.getAbstractFileByPath(item.path);
		if (!(abstractFile instanceof TFile)) {
			updateBatchQueueItem(item.path, {
				status: 'failed',
				selected: false,
				errorMessage: `File not found: ${item.path}`,
			});
			return false;
		}

		try {
			const originalRawContent = await this.app.vault.read(abstractFile);
			const applyRes = await this.applyProposedToFile(abstractFile, item.proposed);

			this.recordSnapshotsToHistory(
				[
					{
						path: item.path,
						originalRawContent,
						...(applyRes.moved
							? {
									movedFromPath: applyRes.moved.movedFromPath,
									movedToPath: applyRes.moved.movedToPath,
								}
							: {}),
					},
				],
				state.activeRecipeId,
			);
			updateBatchQueueItem(item.path, { status: 'applied', selected: false });

			const nextPath = this.findNextStagedPath(item.path);
			if (nextPath) {
				setBatchSelectedPath(nextPath);
			}

			new Notice(t('batchStudio.inspector.applySuccessSingle', { name: item.basename }));
			return true;
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError('batch', normalizeError(err, `Failed to apply ${item.path}: ${msg}`));
			updateBatchQueueItem(item.path, {
				status: 'failed',
				selected: false,
				errorMessage: msg,
			});
			return false;
		}
	}

	/**
	 * 지정한 노트 1건의 제안을 거절하고, 다음 'staged' 노트로 포커스를 자동 이동(Auto-advance)합니다.
	 */
	rejectSingleItem(path: string): void {
		const item = getBatchState().queue.find((q) => q.path === path);
		if (!item || item.status !== 'staged') return;

		updateBatchQueueItem(item.path, { status: 'rejected', selected: false });
		const nextPath = this.findNextStagedPath(item.path);
		if (nextPath) {
			setBatchSelectedPath(nextPath);
		}
	}

	/**
	 * 거절('rejected')한 노트를 다시 검수 대기('staged') 상태로 되돌립니다.
	 */
	restoreRejectedItem(path: string): void {
		const item = getBatchState().queue.find((q) => q.path === path);
		if (!item || item.status !== 'rejected' || !item.proposed) return;

		updateBatchQueueItem(item.path, { status: 'staged', selected: true });
	}

	/**
	 * 체크박스로 선택된 모든 'staged' 노트의 변경사항을 일괄 반영하고 스냅샷 히스토리에 기록합니다.
	 */
	async applyAllSelectedStaged(): Promise<number> {
		if (!canUseFeature('batch-studio')) return 0;
		if (!canUseProFeature('batch-studio')) {
			notifyProFeatureLocked(this.app, 'batch-studio', t('batchStudio.proBulkApplyNotice'));
			return 0;
		}
		const state = getBatchState();
		const targets = state.queue.filter(
			(item) => item.status === 'staged' && item.selected && item.proposed,
		);
		if (targets.length === 0) return 0;

		const snapshots: BatchSnapshotEntry[] = [];
		for (const item of targets) {
			if (!item.proposed) continue;
			const abstractFile = this.app.vault.getAbstractFileByPath(item.path);
			if (!(abstractFile instanceof TFile)) {
				updateBatchQueueItem(item.path, {
					status: 'failed',
					selected: false,
					errorMessage: `File not found: ${item.path}`,
				});
				continue;
			}

			try {
				const originalRawContent = await this.app.vault.read(abstractFile);
				const applyRes = await this.applyProposedToFile(abstractFile, item.proposed);
				snapshots.push({
					path: item.path,
					originalRawContent,
					...(applyRes.moved
						? {
								movedFromPath: applyRes.moved.movedFromPath,
								movedToPath: applyRes.moved.movedToPath,
							}
						: {}),
				});
				updateBatchQueueItem(item.path, { status: 'applied', selected: false });
			} catch (err) {
				const msg = formatLlmError(err);
				debugLogger.logError(
					'batch',
					normalizeError(err, `Batch apply failed for ${item.path}: ${msg}`),
				);
				updateBatchQueueItem(item.path, {
					status: 'failed',
					selected: false,
					errorMessage: msg,
				});
			}
		}

		if (snapshots.length > 0) {
			this.recordSnapshotsToHistory(snapshots, state.activeRecipeId);
			new Notice(t('batchStudio.inspector.applySuccessBatch', { count: snapshots.length }));
		}

		return snapshots.length;
	}

	/**
	 * 특정 배치 히스토리 항목에 저장된 스냅샷을 이용해 수정된 노트들을 원래 상태로 일괄 복원합니다.
	 */
	async rollbackHistoryEntry(historyId: string): Promise<number> {
		if (!canUseFeature('batch-studio')) return 0;
		const entry = getBatchState().history.find((h) => h.id === historyId);
		if (!entry || entry.rolledBack || entry.snapshots.length === 0) {
			new Notice(t('batchStudio.history.snapshotsMissing'));
			return 0;
		}

		let restored = 0;
		const currentQueuePaths = new Set(getBatchState().queue.map((q) => q.path));

		for (const snap of entry.snapshots) {
			if (snap.trashed) {
				try {
					const existing = this.app.vault.getAbstractFileByPath(snap.path);
					if (existing) {
						debugLogger.logWarn(
							'batch',
							`Rollback skipped trashed file: path already exists at ${snap.path}`,
						);
						continue;
					}
					await ensureFolderExists(this.app, snap.path);
					await this.app.vault.create(snap.path, snap.originalRawContent);
					restored++;
				} catch (err) {
					debugLogger.logError(
						'batch',
						normalizeError(err, `Rollback failed for trashed ${snap.path}: ${err}`),
					);
				}
				continue;
			}

			const lookupPath = snap.movedToPath ?? snap.path;
			const abstractFile = this.app.vault.getAbstractFileByPath(lookupPath);
			if (!(abstractFile instanceof TFile)) continue;
			try {
				let targetFile: TFile = abstractFile;
				if (snap.movedToPath && snap.movedFromPath && snap.movedToPath !== snap.movedFromPath) {
					const occupied = this.app.vault.getAbstractFileByPath(snap.movedFromPath);
					if (occupied && occupied !== abstractFile) {
						debugLogger.logWarn(
							'batch',
							`Rollback skipped move: target already exists at ${snap.movedFromPath}`,
						);
						continue;
					}
					await ensureFolderExists(this.app, snap.movedFromPath);
					await this.app.fileManager.renameFile(abstractFile, snap.movedFromPath);
					const movedBack = this.app.vault.getAbstractFileByPath(snap.movedFromPath);
					if (movedBack instanceof TFile) {
						targetFile = movedBack;
					}
				}

				if (snap.movedToPath) {
					const currentContent = await this.app.vault.read(targetFile);
					if (currentContent !== snap.originalRawContent) {
						await this.app.vault.modify(targetFile, snap.originalRawContent);
					}
				} else {
					await this.app.vault.modify(targetFile, snap.originalRawContent);
				}

				restored++;
				if (currentQueuePaths.has(snap.path)) {
					const item = getBatchState().queue.find((q) => q.path === snap.path);
					if (item?.status === 'applied') {
						updateBatchQueueItem(snap.path, { status: 'staged', selected: true });
					}
				}
			} catch (err) {
				debugLogger.logError(
					'batch',
					normalizeError(err, `Rollback failed for ${snap.path}: ${err}`),
				);
			}
		}

		markBatchHistoryRolledBack(historyId);
		if (getBatchState().activeRunHistoryId === historyId) {
			patchBatchState({ activeRunHistoryId: null });
		}
		new Notice(t('batchStudio.history.rollbackDone', { count: restored }));
		return restored;
	}

	// ── Private Helpers ───────────────────────────────────────────────────

	/** 순차 큐 실행 루프 */
	private async processQueueItems(
		targetPaths: Set<string>,
		recipeId: BatchRecipeId,
	): Promise<void> {
		const ac = new AbortController();
		this.abortController = ac;
		activeRunAbortController = ac;
		this.isPaused = false;

		type WakeLockSentinelLike = { release: () => Promise<void> };
		type NavigatorWithWakeLock = Navigator & {
			wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
		};
		let wakeLockSentinel: WakeLockSentinelLike | null = null;
		// 배치 실행 중 모바일 화면 꺼짐으로 인한 작업 중단 방지
		try {
			if (typeof navigator !== 'undefined') {
				wakeLockSentinel = (await (navigator as NavigatorWithWakeLock).wakeLock?.request('screen')) ?? null;
			}
		} catch {
			// Wake Lock 미지원 환경 또는 권한 거부 시 무시
		}

		let runStaged = 0;
		let runSkipped = 0;
		let runFailed = 0;

		try {
			const queueSnapshot = [...getBatchState().queue];
			for (const qItem of queueSnapshot) {
				if (!targetPaths.has(qItem.path)) continue;
				if (ac.signal.aborted) break;

				// 일시정지 상태면 재개될 때까지 대기
				if (this.isPaused) {
					await new Promise<void>((resolve) => {
						this.pauseResolver = resolve;
						activePauseWaker = resolve;
					});
					if (ac.signal.aborted) break;
				}

				const abstractFile = this.app.vault.getAbstractFileByPath(qItem.path);
				if (!(abstractFile instanceof TFile)) {
					runFailed++;
					updateBatchQueueItem(qItem.path, {
						status: 'failed',
						selected: false,
						errorMessage: `File not found: ${qItem.path}`,
					});
					continue;
				}

				updateBatchQueueItem(qItem.path, { status: 'running' });

				try {
					const latestState = getBatchState();
					const res = await this.executeWithRateLimitRetry(
						abstractFile,
						recipeId,
						latestState.recipeOptions,
						latestState.scopeConfig,
						ac.signal,
					);

					if (ac.signal.aborted) break;

					if (res.proposed) {
						runStaged++;
						updateBatchQueueItem(qItem.path, {
							status: 'staged',
							selected: true,
							proposed: res.proposed,
							tokensUsed: res.tokensUsed,
							errorMessage: undefined,
						});
						// 첫 생성 완료 항목을 자동으로 우측 검수 패널에 포커스
						if (!getBatchState().selectedPath) {
							setBatchSelectedPath(qItem.path);
						}
					} else {
						runSkipped++;
						updateBatchQueueItem(qItem.path, {
							status: 'skipped',
							selected: false,
							tokensUsed: res.tokensUsed,
						});
					}
				} catch (err) {
					if (ac.signal.aborted) break;
					runFailed++;
					const msg = formatLlmError(err);
					debugLogger.logError(
						'batch',
						normalizeError(err, `Batch item failed (${qItem.path}): ${msg}`),
					);
					updateBatchQueueItem(qItem.path, {
						status: 'failed',
						selected: false,
						errorMessage: msg,
					});
				}
			}
		} finally {
			if (wakeLockSentinel) {
				try {
					await wakeLockSentinel.release();
				} catch {
					// Wake Lock 해제 오류 무시
				}
				wakeLockSentinel = null;
			}
			if (this.abortController === ac) {
				this.abortController = null;
			}
			if (activeRunAbortController === ac) {
				activeRunAbortController = null;
			}
			this.isPaused = false;
			this.pauseResolver = null;
			activePauseWaker = null;
			patchBatchState({
				runState: 'completed',
				rateLimitCountdownSec: null,
			});

			// 사용자가 직접 중단하지 않고 정상 종료된 경우 결과 요약 Notice 표시
			if (!ac.signal.aborted && runStaged + runSkipped + runFailed > 0) {
				if (runStaged > 0) {
					new Notice(
						t('batchStudio.execution.completedNotice', {
							staged: runStaged,
							skipped: runSkipped,
							failed: runFailed,
						}),
					);
				} else if (runFailed > 0) {
					new Notice(
						t('batchStudio.execution.completedFailedNotice', {
							failed: runFailed,
							skipped: runSkipped,
						}),
					);
				} else {
					new Notice(
						t('batchStudio.execution.completedAllSkippedNotice', {
							skipped: runSkipped,
						}),
					);
				}
			}
		}
	}

	/** 429 Rate Limit 발생 시 카운트다운 후 자동 재시도하는 실행 래퍼 */
	private async executeWithRateLimitRetry(
		file: TFile,
		recipeId: BatchRecipeId,
		recipeOptions: ReturnType<typeof getBatchState>['recipeOptions'],
		scopeConfig: ReturnType<typeof getBatchState>['scopeConfig'],
		signal: AbortSignal,
	) {
		let attempt = 0;
		while (true) {
			try {
				return await executeRecipeForFile(
					this.app,
					this.plugin,
					file,
					recipeId,
					recipeOptions,
					{
						skipIfAlreadyHasTarget: scopeConfig.skipIfAlreadyHasTarget,
						minContentLength: scopeConfig.minContentLength,
						excludedPaths: getActiveProject()?.ragExcludedPaths ?? [],
					},
					signal,
				);
			} catch (err) {
				if (signal.aborted || !isRateLimitError(err) || attempt >= MAX_RATE_LIMIT_RETRIES) {
					throw err;
				}
				attempt++;
				await this.waitWithCountdown(this.rateLimitRetryWaitMs, signal);
			}
		}
	}

	/** 중단 신호(AbortSignal)에 즉시 반응하는 대기 카운트다운 */
	private async waitWithCountdown(totalMs: number, signal: AbortSignal): Promise<void> {
		if (totalMs <= 0) return;
		const totalSec = Math.max(1, Math.ceil(totalMs / 1000));
		const stepMs = Math.min(1000, totalMs);

		for (let remain = totalSec; remain > 0; remain--) {
			if (signal.aborted) return;
			patchBatchState({ rateLimitCountdownSec: remain });
			await new Promise<void>((resolve) => {
				const onAbort = () => {
					window.clearTimeout(timer);
					resolve();
				};
				const timer = window.setTimeout(() => {
					signal.removeEventListener('abort', onAbort);
					resolve();
				}, stepMs);
				signal.addEventListener('abort', onAbort, { once: true });
			});
		}
		patchBatchState({ rateLimitCountdownSec: null });
	}

	/** 제안된 변경 내용을 실제 마크다운 파일에 기록 */
	private async applyProposedToFile(
		file: TFile,
		proposed: BatchProposedChange,
	) {
		const state = getBatchState();
		return applyProposedToFile(this.app, file, proposed, {
			conflictPolicy: state.recipeOptions.moveConfig?.conflictPolicy ?? 'rename-suffix',
			createFolderIfMissing: state.recipeOptions.moveConfig?.createFolderIfMissing ?? true,
			excludedPaths: getActiveProject()?.ragExcludedPaths ?? [],
		});
	}

	/** 현재 파일 이후의 다음 'staged' 상태 파일 경로를 탐색 (끝에 도달하면 앞에서부터 순환 탐색) */
	private findNextStagedPath(currentPath: string): string | null {
		const queue = getBatchState().queue;
		const idx = queue.findIndex((q) => q.path === currentPath);
		if (idx === -1) {
			return queue.find((q) => q.status === 'staged')?.path ?? null;
		}

		for (let i = idx + 1; i < queue.length; i++) {
			if (queue[i].status === 'staged') return queue[i].path;
		}
		for (let i = 0; i < idx; i++) {
			if (queue[i].status === 'staged') return queue[i].path;
		}
		return null;
	}

	/** 반영된 원본 스냅샷을 현재 배치 세션 히스토리에 누적하거나 새 히스토리 항목을 생성 */
	private recordSnapshotsToHistory(
		snapshots: BatchSnapshotEntry[],
		recipeId: BatchRecipeId,
	): void {
		if (snapshots.length === 0) return;
		const state = getBatchState();
		const runId = state.activeRunHistoryId;
		const existing = runId
			? state.history.find((h) => h.id === runId && !h.rolledBack)
			: undefined;

		if (existing && runId) {
			appendSnapshotsToHistoryEntry(runId, snapshots);
			return;
		}

		// 기존 activeRunHistoryId가 이미 롤백되었거나 없는 경우 반드시 새 고유 ID를 발급해 중복 키 충돌 방지
		const nextId = crypto.randomUUID();
		patchBatchState({ activeRunHistoryId: nextId });
		addBatchHistoryEntry({
			id: nextId,
			timestamp: Date.now(),
			recipeId,
			appliedCount: snapshots.length,
			rolledBack: false,
			snapshots,
		});
	}
}
