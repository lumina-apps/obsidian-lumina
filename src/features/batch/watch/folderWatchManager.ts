/**
 * folderWatchManager.ts
 *
 * Pro 백그라운드 폴더 자동감시 매니저.
 * - `vault.on('create' | 'modify' | 'rename' | 'delete')` + 주기 스캔(`interval`) 지원
 * - 시작 유예·Sync mtime 신선도 검사·자가수정 쿨다운·활성 에디터 보류·버스트 차단·일일 상한 적용
 * - `auto-stage`(검토 대기열) 및 `auto-apply`(즉시 반영 + 원클릭 롤백 스냅샷) 지원
 */

import { Notice, Platform, TFile, normalizePath, type App, type EventRef, type TAbstractFile } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { addBatchHistoryEntry } from '../../../core/store/batchStore';
import {
	addWatchActivityLog,
	batchWatchStore,
	getBatchWatchState,
	getTodayProcessedCount,
	incrementDailyProcessed,
	patchBatchWatchState,
	readDeviceWatchEnabled,
	removeWatchStagedItem,
	upsertWatchStagedItem,
	writeDeviceWatchEnabled,
} from '../../../core/store/batchWatchStore';
import { canUseProFeature } from '../../../core/store/entitlementStore';
import { getActiveProject } from '../../../core/store/projectStore';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import type { BatchRecipeId } from '../../../shared/types/batch.types';
import type {
	FolderWatchRule,
	WatchStagedItem,
	WatchStagedStep,
} from '../../../shared/types/batchWatch.types';
import { normalizeError } from '../../../shared/utils/errorUtils';
import { isExcluded } from '../../../shared/utils/exclusions';
import { normalizeFrontmatterTags } from '../../../shared/utils/frontmatterSanitizer';
import { mergeExcludedPathsWithHistory } from '../../../shared/utils/historyPathUtils';
import { formatLlmError } from '../../../shared/utils/llmErrorFormatter';
import { applyProposedToFile } from '../batchApplyHelper';
import { isRateLimitError, splitFrontmatterAndBody } from '../recipes/batchLlmHelper';
import { executeRecipeForFile } from '../recipes/batchRecipes';
import {
	executeSafeFileMove,
	getParentFolder,
	resolveMoveTargetPath,
	sanitizeFolderPath,
} from './folderMover';

/** 시작 직후 초기 Sync 유입 이벤트를 무시하는 유예 시간 (ms) */
const DEFAULT_STARTUP_GRACE_MS = 8000;
/** 신규 파일 생성 시 로컬 생성으로 간주하는 최대 mtime 경과 시간 (ms) */
const DEFAULT_MTIME_MAX_AGE_MS = 10000;
/** 자가 수정/이동 직후 재트리거를 막기 위한 쿨다운 시간 (ms) */
const DEFAULT_SELF_COOLDOWN_MS = 3500;
/** 버스트 유입 판별 윈도우 (ms) */
const DEFAULT_BURST_WINDOW_MS = 10000;
/** 429 Rate Limit 발생 시 재시도 대기 시간 (ms) */
const DEFAULT_RATE_LIMIT_WAIT_MS = 10000;
/** 429 Rate Limit 최대 재시도 횟수 */
const MAX_RATE_LIMIT_RETRIES = 2;

export interface FolderWatchManagerOptions {
	/** 시작 유예 시간 (ms, 테스트용 단축 가능) */
	startupGraceMs?: number;
	/** mtime 신선도 기준 (ms, 0이면 검사 생략) */
	mtimeMaxAgeMs?: number;
	/** 자가 수정 쿨다운 (ms) */
	selfCooldownMs?: number;
	/** 버스트 윈도우 (ms) */
	burstWindowMs?: number;
	/** Rate Limit 재시도 대기 시간 (ms) */
	rateLimitRetryWaitMs?: number;
}

interface WatchJob {
	ruleId: string;
	filePath: string;
}

/**
 * 폴더 자동감시 백그라운드 런타임 매니저
 */
export class FolderWatchManager {
	private plugin: LuminaPlugin;
	private app: App;
	private destroyed = false;
	private startedAt = 0;

	private readonly startupGraceMs: number;
	private readonly mtimeMaxAgeMs: number;
	private readonly selfCooldownMs: number;
	private readonly burstWindowMs: number;
	private readonly rateLimitRetryWaitMs: number;

	private vaultEventRefs: EventRef[] = [];
	private workspaceEventRefs: EventRef[] = [];
	private debounceTimers: Map<string, number> = new Map();
	private intervalTimers: number[] = [];

	private processingPaths: Set<string> = new Set();
	private selfActionCooldown: Map<string, number> = new Map();
	private activeFilePath: string | null = null;
	private deferredActivePaths: Map<string, Set<string>> = new Map();

	private burstTimestamps: Map<string, number[]> = new Map();
	private burstCooldownUntil: Map<string, number> = new Map();

	private jobQueue: WatchJob[] = [];
	private queuedKeys: Set<string> = new Set();
	private draining = false;
	private activeAbortController: AbortController | null = null;

	private statusBarEl: HTMLElement | null = null;
	private unsubWatchStore: (() => void) | null = null;

	constructor(plugin: LuminaPlugin, opts?: FolderWatchManagerOptions) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.startupGraceMs = opts?.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
		this.mtimeMaxAgeMs = opts?.mtimeMaxAgeMs ?? DEFAULT_MTIME_MAX_AGE_MS;
		this.selfCooldownMs = opts?.selfCooldownMs ?? DEFAULT_SELF_COOLDOWN_MS;
		this.burstWindowMs = opts?.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS;
		this.rateLimitRetryWaitMs = opts?.rateLimitRetryWaitMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
	}

	/**
	 * 매니저를 초기화하고 기기별 활성화 상태 복원, 상태바 등록 및 감시 리스너를 시작합니다.
	 */
	init(): void {
		if (this.destroyed) return;
		this.startedAt = Date.now();
		const isMobile = typeof Platform !== 'undefined' && Boolean(Platform?.isMobile);
		const deviceEnabled = readDeviceWatchEnabled(isMobile);
		patchBatchWatchState({ deviceWatchEnabled: deviceEnabled });

		this.activeFilePath = this.app.workspace?.getActiveFile?.()?.path ?? null;

		if (
			!isMobile &&
			(this.plugin.settings.batchWatch?.showStatusBar ?? true) &&
			typeof this.plugin.addStatusBarItem === 'function'
		) {
			this.statusBarEl = this.plugin.addStatusBarItem();
			this.statusBarEl.addClass('lumina-watch-statusbar');
			this.statusBarEl.addEventListener('click', () => {
				void this.openWatchTab();
			});
			this.unsubWatchStore = batchWatchStore.subscribe(() => {
				this.updateStatusBar();
			});
		}

		this.syncWatchers();
	}

	/**
	 * 현재 기기의 백그라운드 자동감시 활성화 상태를 변경하고 localStorage에 저장합니다.
	 */
	setDeviceEnabled(enabled: boolean): void {
		writeDeviceWatchEnabled(enabled);
		patchBatchWatchState({ deviceWatchEnabled: enabled });
		this.syncWatchers();
	}

	/**
	 * 설정 변경 또는 권한/활성 토글 변화에 맞춰 볼트 이벤트·타이머를 재구성합니다.
	 */
	syncWatchers(): void {
		this.clearWatchListenersAndTimers();
		this.updateStatusBar();

		if (this.destroyed || !canUseProFeature('batch-studio')) {
			return;
		}

		const deviceEnabled = getBatchWatchState().deviceWatchEnabled;
		const enabledRules = this.getEnabledRules();
		if (!deviceEnabled || enabledRules.length === 0) {
			return;
		}

		this.activeFilePath = this.app.workspace?.getActiveFile?.()?.path ?? null;

		const refCreate = this.app.vault.on('create', (file: TAbstractFile) => {
			this.handleVaultEvent('create', file);
		});
		const refModify = this.app.vault.on('modify', (file: TAbstractFile) => {
			this.handleVaultEvent('modify', file);
		});
		const refRename = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
			this.handleRenameEvent(file, oldPath);
		});
		const refDelete = this.app.vault.on('delete', (file: TAbstractFile) => {
			this.handleDeleteEvent(file);
		});
		this.vaultEventRefs.push(refCreate, refModify, refRename, refDelete);

		if (this.app.workspace && typeof this.app.workspace.on === 'function') {
			const refFileOpen = this.app.workspace.on('file-open', (file) => {
				this.handleFileOpen(file);
			});
			this.workspaceEventRefs.push(refFileOpen);
		}

		// 주기적 스캔(interval) 규칙 타이머 등록
		for (const rule of enabledRules) {
			if (rule.triggerMode !== 'interval') continue;
			const intervalMs = Math.max(1, rule.intervalMin || 15) * 60 * 1000;
			const timer = window.setInterval(() => {
				void this.scanRuleFolder(rule.id);
			}, intervalMs);
			this.intervalTimers.push(timer);
		}
	}

	/**
	 * 지정한 파일 경로가 활성화된 자동감시 규칙의 `frontmatter` 레시피에 의해 관리되는지 반환합니다.
	 * (`FrontmatterManager`가 동일 파일에 중복 LLM 호출을 하지 않도록 양보 판단에 사용)
	 */
	isPathManagedForFrontmatter(filePath: string): boolean {
		if (this.destroyed || !canUseProFeature('batch-studio')) return false;
		if (!getBatchWatchState().deviceWatchEnabled) return false;
		if (!filePath || this.isExcludedPath(filePath)) return false;

		const enabledRules = this.getEnabledRules();
		for (const rule of enabledRules) {
			if (!rule.recipes.includes('frontmatter')) continue;
			if (this.matchesRuleFolder(filePath, rule)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * 특정 감시 규칙 대상 폴더를 즉시 1회 스캔하여 대기열에 추가합니다.
	 */
	async runRuleNow(ruleId: string): Promise<number> {
		if (this.destroyed || !canUseProFeature('batch-studio')) return 0;
		const rule = this.getAllRules().find((r) => r.id === ruleId);
		if (!rule) return 0;

		const matchedFiles = this.collectMatchingFilesForRule(rule);
		for (const file of matchedFiles) {
			this.enqueueJob(rule.id, file.path);
		}
		if (matchedFiles.length > 0) {
			void this.drainQueue();
		}
		return matchedFiles.length;
	}

	/**
	 * Auto-Stage 검토 대기 항목 1건을 실제 볼트 파일에 적용(내용 수정 + 폴더 이동)하고 롤백 스냅샷을 기록합니다.
	 */
	async approveStagedItem(stagedId: string): Promise<boolean> {
		if (this.destroyed || !canUseProFeature('batch-studio')) return false;
		const item = getBatchWatchState().stagedItems.find((s) => s.id === stagedId);
		if (!item) return false;

		const abstractFile = this.app.vault.getAbstractFileByPath(item.path);
		if (!(abstractFile instanceof TFile)) {
			removeWatchStagedItem(stagedId);
			addWatchActivityLog({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				ruleId: item.ruleId,
				ruleName: item.ruleName,
				path: item.path,
				status: 'failed',
				detail: `File not found: ${item.path}`,
			});
			return false;
		}

		const rule = this.getAllRules().find((r) => r.id === item.ruleId);
		const excludedPaths = this.getExcludedPaths();

		this.processingPaths.add(item.path);
		this.markSelfCooldown(item.path);
		if (item.moveProposal?.toPath) {
			this.markSelfCooldown(item.moveProposal.toPath);
		}

		try {
			const originalRawContent = await this.app.vault.read(abstractFile);
			let didModify = false;

			for (const step of item.steps) {
				this.markSelfCooldown(abstractFile.path);
				await applyProposedToFile(this.app, abstractFile, step.proposed, { excludedPaths });
				didModify = true;
			}

			let moved: { movedFromPath: string; movedToPath: string } | null = null;
			if (item.moveProposal?.toPath) {
				this.markSelfCooldown(abstractFile.path);
				this.markSelfCooldown(item.moveProposal.toPath);
				moved = await executeSafeFileMove(this.app, abstractFile, item.moveProposal.toPath, {
					conflictPolicy: rule?.moveAction.conflictPolicy ?? 'rename-suffix',
					createFolderIfMissing: rule?.moveAction.createFolderIfMissing ?? true,
					excludedPaths,
				});
			}

			if (didModify || moved) {
				const primaryRecipe: BatchRecipeId =
					item.steps[0]?.recipeId ?? 'folder-move';
				addBatchHistoryEntry({
					id: crypto.randomUUID(),
					timestamp: Date.now(),
					recipeId: primaryRecipe,
					appliedCount: 1,
					rolledBack: false,
					source: 'watch',
					ruleName: item.ruleName,
					snapshots: [
						{
							path: moved?.movedFromPath ?? item.path,
							originalRawContent,
							...(moved
								? {
										movedFromPath: moved.movedFromPath,
										movedToPath: moved.movedToPath,
									}
								: {}),
						},
					],
				});
			}

			removeWatchStagedItem(stagedId);
			addWatchActivityLog({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				ruleId: item.ruleId,
				ruleName: item.ruleName,
				path: item.path,
				...(moved ? { targetPath: moved.movedToPath } : {}),
				status: moved ? 'moved' : 'applied',
			});
			return true;
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError('batch_watch', normalizeError(err, `Approve staged failed: ${msg}`));
			addWatchActivityLog({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				ruleId: item.ruleId,
				ruleName: item.ruleName,
				path: item.path,
				status: 'failed',
				detail: msg,
			});
			return false;
		} finally {
			this.processingPaths.delete(item.path);
		}
	}

	/**
	 * 검토 대기열의 모든 Auto-Stage 항목을 순차 적용합니다.
	 */
	async approveAllStaged(): Promise<number> {
		if (this.destroyed || !canUseProFeature('batch-studio')) return 0;
		const items = [...getBatchWatchState().stagedItems];
		let applied = 0;
		for (const item of items) {
			if (this.destroyed) break;
			const ok = await this.approveStagedItem(item.id);
			if (ok) applied++;
		}
		return applied;
	}

	/**
	 * Auto-Stage 검토 대기 항목 1건을 거절하고 대기열에서 제거합니다.
	 */
	rejectStagedItem(stagedId: string): void {
		removeWatchStagedItem(stagedId);
	}

	/**
	 * 모든 이벤트 리스너, 타이머, 진행 중인 작업, 상태바 UI를 완전히 정리합니다.
	 */
	destroy(): void {
		this.destroyed = true;
		if (this.activeAbortController) {
			this.activeAbortController.abort();
			this.activeAbortController = null;
		}
		this.clearWatchListenersAndTimers();
		this.jobQueue = [];
		this.queuedKeys.clear();
		this.processingPaths.clear();
		this.selfActionCooldown.clear();
		this.deferredActivePaths.clear();
		this.burstTimestamps.clear();
		this.burstCooldownUntil.clear();
		this.draining = false;

		this.unsubWatchStore?.();
		this.unsubWatchStore = null;
		if (this.statusBarEl) {
			this.statusBarEl.detach();
			this.statusBarEl = null;
		}
		patchBatchWatchState({ isProcessing: false, activeJobPath: null });
	}

	// ── Private Event & Queue Helpers ────────────────────────────────────────

	private clearWatchListenersAndTimers(): void {
		for (const ref of this.vaultEventRefs) {
			this.app.vault?.offref?.(ref);
		}
		this.vaultEventRefs = [];

		for (const ref of this.workspaceEventRefs) {
			this.app.workspace?.offref?.(ref);
		}
		this.workspaceEventRefs = [];

		for (const timer of this.debounceTimers.values()) {
			window.clearTimeout(timer);
		}
		this.debounceTimers.clear();

		for (const timer of this.intervalTimers) {
			window.clearInterval(timer);
		}
		this.intervalTimers = [];

		this.deferredActivePaths.clear();
	}

	private getAllRules(): FolderWatchRule[] {
		return this.plugin.settings.batchWatch?.rules ?? [];
	}

	private getEnabledRules(): FolderWatchRule[] {
		return this.getAllRules().filter(
			(r) => r.enabled && sanitizeFolderPath(r.sourceFolder).length > 0,
		);
	}

	private getExcludedPaths(): string[] {
		const projectExcluded = getActiveProject()?.ragExcludedPaths ?? [];
		const merged = mergeExcludedPathsWithHistory(
			projectExcluded,
			this.plugin.settings.chat?.historyPath,
		);
		const configDir = this.app.vault?.configDir;
		if (configDir && !merged.includes(configDir)) {
			merged.push(configDir);
		}
		return merged;
	}

	private isExcludedPath(filePath: string): boolean {
		return isExcluded(filePath, this.getExcludedPaths());
	}

	private isEligibleMarkdownFile(file: TAbstractFile): file is TFile {
		if (!(file instanceof TFile)) return false;
		if (file.extension?.toLowerCase() !== 'md') return false;
		if (file.path.startsWith('.') || file.path.includes('/.')) return false;
		if (this.isExcludedPath(file.path)) return false;
		return true;
	}

	private matchesRuleFolder(filePath: string, rule: FolderWatchRule): boolean {
		const srcFolder = sanitizeFolderPath(rule.sourceFolder);
		if (!srcFolder) return false;
		const normFile = normalizePath(filePath);
		if (rule.includeSubfolders) {
			return normFile.startsWith(`${srcFolder}/`);
		}
		return getParentFolder(normFile) === srcFolder;
	}

	private matchesRuleTagFilter(file: TFile, rawTagFilter: string): boolean {
		const target = rawTagFilter.trim().replace(/^#+/, '').toLowerCase();
		if (!target) return true;
		const cache = this.app.metadataCache?.getFileCache(file);
		if (!cache) return false;
		const fmTags = normalizeFrontmatterTags(cache.frontmatter?.tags).map((tag) =>
			tag.toLowerCase(),
		);
		const inlineTags = (cache.tags ?? []).map((tag) =>
			tag.tag.replace(/^#+/, '').toLowerCase(),
		);
		return [...fmTags, ...inlineTags].some(
			(tag) => tag === target || tag.startsWith(`${target}/`),
		);
	}

	private markSelfCooldown(filePath: string): void {
		this.selfActionCooldown.set(normalizePath(filePath), Date.now() + this.selfCooldownMs);
	}

	private isInSelfCooldown(filePath: string): boolean {
		const norm = normalizePath(filePath);
		const until = this.selfActionCooldown.get(norm);
		if (!until) return false;
		if (Date.now() > until) {
			this.selfActionCooldown.delete(norm);
			return false;
		}
		return true;
	}

	private handleVaultEvent(kind: 'create' | 'modify', abstractFile: TAbstractFile): void {
		if (this.destroyed || !canUseProFeature('batch-studio')) return;
		if (!getBatchWatchState().deviceWatchEnabled) return;
		if (!this.isEligibleMarkdownFile(abstractFile)) return;

		const filePath = normalizePath(abstractFile.path);
		if (this.processingPaths.has(filePath) || this.isInSelfCooldown(filePath)) {
			return;
		}

		if (kind === 'create') {
			// 1. 시작 유예 기간 중 초기 동기화 이벤트 무시
			if (this.startupGraceMs > 0 && Date.now() - this.startedAt < this.startupGraceMs) {
				return;
			}
			// 2. 외부 동기화로 내려온 과거 mtime 파일 무시
			const mtime = abstractFile.stat?.mtime ?? 0;
			if (
				this.mtimeMaxAgeMs > 0 &&
				mtime > 0 &&
				Date.now() - mtime > this.mtimeMaxAgeMs
			) {
				return;
			}
		}

		const matchingRules = this.getEnabledRules().filter((rule) => {
			if (kind === 'create') {
				if (rule.triggerMode !== 'on-create' && rule.triggerMode !== 'on-create-or-modify') {
					return false;
				}
			} else if (rule.triggerMode !== 'on-create-or-modify') {
				return false;
			}
			return this.matchesRuleFolder(filePath, rule);
		});

		if (matchingRules.length === 0) return;

		for (const rule of matchingRules) {
			// 현재 사용자가 직접 편집 중인 파일은 다른 노트로 이동할 때까지 보류
			if (this.activeFilePath && normalizePath(this.activeFilePath) === filePath) {
				let set = this.deferredActivePaths.get(filePath);
				if (!set) {
					set = new Set<string>();
					this.deferredActivePaths.set(filePath, set);
				}
				set.add(rule.id);
				continue;
			}

			this.scheduleRuleForFile(rule, filePath);
		}
	}

	private handleFileOpen(file: TFile | null): void {
		const prev = this.activeFilePath ? normalizePath(this.activeFilePath) : null;
		const next = file ? normalizePath(file.path) : null;
		this.activeFilePath = next;

		if (!prev || prev === next) return;

		const deferredRuleIds = this.deferredActivePaths.get(prev);
		if (!deferredRuleIds) return;
		this.deferredActivePaths.delete(prev);

		for (const ruleId of deferredRuleIds) {
			const rule = this.getEnabledRules().find((r) => r.id === ruleId);
			if (rule && this.matchesRuleFolder(prev, rule)) {
				this.scheduleRuleForFile(rule, prev);
			}
		}
	}

	private handleRenameEvent(file: TAbstractFile, oldPath: string): void {
		const normOld = normalizePath(oldPath);
		const normNew = normalizePath(file.path);

		for (const rule of this.getEnabledRules()) {
			const oldKey = `${rule.id}::${normOld}`;
			const timer = this.debounceTimers.get(oldKey);
			if (timer !== undefined) {
				window.clearTimeout(timer);
				this.debounceTimers.delete(oldKey);
			}
		}

		const deferred = this.deferredActivePaths.get(normOld);
		if (deferred) {
			this.deferredActivePaths.delete(normOld);
			this.deferredActivePaths.set(normNew, deferred);
		}
	}

	private handleDeleteEvent(file: TAbstractFile): void {
		const norm = normalizePath(file.path);
		for (const rule of this.getEnabledRules()) {
			const key = `${rule.id}::${norm}`;
			const timer = this.debounceTimers.get(key);
			if (timer !== undefined) {
				window.clearTimeout(timer);
				this.debounceTimers.delete(key);
			}
		}
		this.deferredActivePaths.delete(norm);
	}

	private scheduleRuleForFile(rule: FolderWatchRule, filePath: string): void {
		const now = Date.now();
		const cooldownUntil = this.burstCooldownUntil.get(rule.id) ?? 0;
		if (now < cooldownUntil) {
			return;
		}

		const burstLimit = Math.max(2, this.plugin.settings.batchWatch?.burstLimit ?? 8);
		const prevTimes = (this.burstTimestamps.get(rule.id) ?? []).filter(
			(ts) => now - ts <= this.burstWindowMs,
		);
		prevTimes.push(now);
		this.burstTimestamps.set(rule.id, prevTimes);

		// 버스트 차단(Circuit Breaker): 단시간 내 대량 유입 시 자동 실행 중단
		if (prevTimes.length >= burstLimit) {
			this.burstTimestamps.delete(rule.id);
			this.burstCooldownUntil.set(rule.id, now + this.burstWindowMs);
			const prefix = `${rule.id}::`;
			for (const [key, timer] of this.debounceTimers.entries()) {
				if (key.startsWith(prefix)) {
					window.clearTimeout(timer);
					this.debounceTimers.delete(key);
				}
			}

			addWatchActivityLog({
				id: crypto.randomUUID(),
				timestamp: now,
				ruleId: rule.id,
				ruleName: rule.name,
				path: filePath,
				status: 'burst-paused',
				detail: `${prevTimes.length} files in ${Math.round(this.burstWindowMs / 1000)}s`,
			});
			new Notice(
				t('batchStudio.watch.burstPausedNotice', {
					count: prevTimes.length,
					folder: rule.sourceFolder,
				}),
				6000,
			);
			return;
		}

		const timerKey = `${rule.id}::${filePath}`;
		const existingTimer = this.debounceTimers.get(timerKey);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		const delayMs = Math.max(0, rule.debounceSec) * 1000;
		const timer = window.setTimeout(() => {
			this.debounceTimers.delete(timerKey);
			this.enqueueJob(rule.id, filePath);
			void this.drainQueue();
		}, delayMs);
		this.debounceTimers.set(timerKey, timer);
	}

	private collectMatchingFilesForRule(rule: FolderWatchRule): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const matched: TFile[] = [];
		for (const file of files) {
			if (!this.isEligibleMarkdownFile(file)) continue;
			if (!this.matchesRuleFolder(file.path, rule)) continue;
			if (rule.tagFilter.trim() && !this.matchesRuleTagFilter(file, rule.tagFilter)) continue;
			matched.push(file);
		}
		return matched.sort((a, b) => a.path.localeCompare(b.path));
	}

	private async scanRuleFolder(ruleId: string): Promise<void> {
		if (this.destroyed || !canUseProFeature('batch-studio')) return;
		if (!getBatchWatchState().deviceWatchEnabled) return;
		const rule = this.getEnabledRules().find((r) => r.id === ruleId);
		if (!rule) return;

		const matched = this.collectMatchingFilesForRule(rule);
		for (const file of matched) {
			if (this.activeFilePath && normalizePath(this.activeFilePath) === normalizePath(file.path)) {
				continue;
			}
			this.enqueueJob(rule.id, file.path);
		}
		if (matched.length > 0) {
			void this.drainQueue();
		}
	}

	private enqueueJob(ruleId: string, filePath: string): void {
		const normPath = normalizePath(filePath);
		const key = `${ruleId}::${normPath}`;
		if (this.queuedKeys.has(key)) return;
		this.queuedKeys.add(key);
		this.jobQueue.push({ ruleId, filePath: normPath });
	}

	private async drainQueue(): Promise<void> {
		if (this.draining || this.destroyed) return;
		this.draining = true;
		const ac = new AbortController();
		this.activeAbortController = ac;

		try {
			while (this.jobQueue.length > 0 && !this.destroyed && !ac.signal.aborted) {
				if (!canUseProFeature('batch-studio') || !getBatchWatchState().deviceWatchEnabled) {
					break;
				}
				const job = this.jobQueue.shift();
				if (!job) break;
				this.queuedKeys.delete(`${job.ruleId}::${job.filePath}`);

				const rule = this.getAllRules().find((r) => r.id === job.ruleId);
				if (!rule || !rule.enabled) continue;

				patchBatchWatchState({ isProcessing: true, activeJobPath: job.filePath });
				await this.processJob(rule, job.filePath, ac.signal);
			}
		} finally {
			if (this.activeAbortController === ac) {
				this.activeAbortController = null;
			}
			this.draining = false;
			patchBatchWatchState({ isProcessing: false, activeJobPath: null });
		}
	}

	private async processJob(
		rule: FolderWatchRule,
		filePath: string,
		signal: AbortSignal,
	): Promise<void> {
		const maxDaily = Math.max(1, this.plugin.settings.batchWatch?.dailyMaxItems ?? 30);
		if (getTodayProcessedCount() >= maxDaily) {
			addWatchActivityLog({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				ruleId: rule.id,
				ruleName: rule.name,
				path: filePath,
				status: 'daily-cap',
				detail: `Daily limit ${maxDaily} reached`,
			});
			return;
		}

		const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!(abstractFile instanceof TFile)) return;
		if (!this.isEligibleMarkdownFile(abstractFile)) return;
		if (!this.matchesRuleFolder(abstractFile.path, rule)) return;
		if (rule.tagFilter.trim() && !this.matchesRuleTagFilter(abstractFile, rule.tagFilter)) {
			return;
		}

		const excludedPaths = this.getExcludedPaths();
		this.processingPaths.add(filePath);

		try {
			const originalRawContent = await this.app.vault.read(abstractFile);
			const bodyLength = splitFrontmatterAndBody(originalRawContent).body.trim().length;
			if (rule.minContentLength > 0 && bodyLength < Math.max(10, rule.minContentLength)) {
				return;
			}

			let effectiveTags: string[] | undefined;
			let totalTokens = 0;

			if (rule.executionMode === 'auto-stage') {
				const steps: WatchStagedStep[] = [];
				for (const recipeId of rule.recipes) {
					if (signal.aborted || this.destroyed) return;
					const res = await this.executeRecipeWithRetry(
						abstractFile,
						recipeId,
						rule,
						excludedPaths,
						signal,
					);
					totalTokens += res.tokensUsed;
					if (res.proposed) {
						steps.push({ recipeId, proposed: res.proposed });
						if (recipeId === 'frontmatter' && res.proposed.afterTags) {
							effectiveTags = [...res.proposed.afterTags];
						}
					}
				}

				let moveProposal: WatchStagedItem['moveProposal'];
				if (rule.moveAction.mode !== 'none' && !signal.aborted && !this.destroyed) {
					const moveRes = await this.resolveMoveWithRetry(
						abstractFile,
						rule,
						effectiveTags,
						excludedPaths,
						signal,
					);
					totalTokens += moveRes.tokensUsed;
					if (moveRes.targetPath) {
						moveProposal = {
							fromPath: abstractFile.path,
							toPath: moveRes.targetPath,
							reason: moveRes.reason,
						};
					}
				}

				if (steps.length === 0 && !moveProposal) {
					addWatchActivityLog({
						id: crypto.randomUUID(),
						timestamp: Date.now(),
						ruleId: rule.id,
						ruleName: rule.name,
						path: filePath,
						status: 'skipped',
					});
					return;
				}

				incrementDailyProcessed();
				upsertWatchStagedItem({
					id: crypto.randomUUID(),
					ruleId: rule.id,
					ruleName: rule.name,
					path: abstractFile.path,
					basename: abstractFile.basename,
					createdAt: Date.now(),
					steps,
					...(moveProposal ? { moveProposal } : {}),
					tokensUsed: totalTokens,
				});
				addWatchActivityLog({
					id: crypto.randomUUID(),
					timestamp: Date.now(),
					ruleId: rule.id,
					ruleName: rule.name,
					path: abstractFile.path,
					...(moveProposal ? { targetPath: moveProposal.toPath } : {}),
					status: 'staged',
				});
				return;
			}

			// auto-apply 모드: 즉시 반영 + 롤백 스냅샷 저장
			let didModify = false;
			this.markSelfCooldown(abstractFile.path);

			for (const recipeId of rule.recipes) {
				if (signal.aborted || this.destroyed) return;
				const res = await this.executeRecipeWithRetry(
					abstractFile,
					recipeId,
					rule,
					excludedPaths,
					signal,
				);
				totalTokens += res.tokensUsed;
				if (res.proposed) {
					this.markSelfCooldown(abstractFile.path);
					await applyProposedToFile(this.app, abstractFile, res.proposed, {
						excludedPaths,
					});
					didModify = true;
					if (recipeId === 'frontmatter' && res.proposed.afterTags) {
						effectiveTags = [...res.proposed.afterTags];
					}
				}
			}

			let moved: { movedFromPath: string; movedToPath: string } | null = null;
			if (rule.moveAction.mode !== 'none' && !signal.aborted && !this.destroyed) {
				const moveRes = await this.resolveMoveWithRetry(
					abstractFile,
					rule,
					effectiveTags,
					excludedPaths,
					signal,
				);
				totalTokens += moveRes.tokensUsed;
				if (moveRes.targetPath) {
					this.markSelfCooldown(abstractFile.path);
					this.markSelfCooldown(moveRes.targetPath);
					moved = await executeSafeFileMove(this.app, abstractFile, moveRes.targetPath, {
						conflictPolicy: rule.moveAction.conflictPolicy,
						createFolderIfMissing: rule.moveAction.createFolderIfMissing,
						excludedPaths,
					});
				}
			}

			if (!didModify && !moved) {
				addWatchActivityLog({
					id: crypto.randomUUID(),
					timestamp: Date.now(),
					ruleId: rule.id,
					ruleName: rule.name,
					path: filePath,
					status: 'skipped',
				});
				return;
			}

			incrementDailyProcessed();
			const primaryRecipe: BatchRecipeId = rule.recipes[0] ?? 'folder-move';
			addBatchHistoryEntry({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				recipeId: primaryRecipe,
				appliedCount: 1,
				rolledBack: false,
				source: 'watch',
				ruleName: rule.name,
				snapshots: [
					{
						path: moved?.movedFromPath ?? filePath,
						originalRawContent,
						...(moved
							? {
									movedFromPath: moved.movedFromPath,
									movedToPath: moved.movedToPath,
								}
							: {}),
					},
				],
			});

			addWatchActivityLog({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				ruleId: rule.id,
				ruleName: rule.name,
				path: filePath,
				...(moved ? { targetPath: moved.movedToPath } : {}),
				status: moved ? 'moved' : 'applied',
			});
		} catch (err) {
			if (signal.aborted) return;
			const msg = formatLlmError(err);
			debugLogger.logError(
				'batch_watch',
				normalizeError(err, `Watch job failed (${filePath}): ${msg}`),
			);
			addWatchActivityLog({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				ruleId: rule.id,
				ruleName: rule.name,
				path: filePath,
				status: 'failed',
				detail: msg,
			});
		} finally {
			this.processingPaths.delete(filePath);
		}
	}

	private async executeRecipeWithRetry(
		file: TFile,
		recipeId: FolderWatchRule['recipes'][number],
		rule: FolderWatchRule,
		excludedPaths: string[],
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
					rule.recipeOptions,
					{
						skipIfAlreadyHasTarget: rule.skipIfAlreadyHasTarget,
						minContentLength: rule.minContentLength,
						excludedPaths,
					},
					signal,
				);
			} catch (err) {
				if (signal.aborted || !isRateLimitError(err) || attempt >= MAX_RATE_LIMIT_RETRIES) {
					throw err;
				}
				attempt++;
				await this.waitAbortable(this.rateLimitRetryWaitMs, signal);
			}
		}
	}

	private async resolveMoveWithRetry(
		file: TFile,
		rule: FolderWatchRule,
		effectiveTags: readonly string[] | undefined,
		excludedPaths: string[],
		signal: AbortSignal,
	) {
		let attempt = 0;
		while (true) {
			try {
				return await resolveMoveTargetPath(this.app, this.plugin, file, rule.moveAction, {
					effectiveTags,
					excludedPaths,
					providerId: rule.recipeOptions.providerId,
					modelId: rule.recipeOptions.modelId,
					minContentLength: rule.minContentLength,
					disallowedSourceFolder: rule.sourceFolder,
					includeSubfolders: rule.includeSubfolders,
					signal,
				});
			} catch (err) {
				if (signal.aborted || !isRateLimitError(err) || attempt >= MAX_RATE_LIMIT_RETRIES) {
					throw err;
				}
				attempt++;
				await this.waitAbortable(this.rateLimitRetryWaitMs, signal);
			}
		}
	}

	private async waitAbortable(ms: number, signal: AbortSignal): Promise<void> {
		if (ms <= 0 || signal.aborted) return;
		await new Promise<void>((resolve) => {
			const onAbort = () => {
				window.clearTimeout(timer);
				resolve();
			};
			const timer = window.setTimeout(() => {
				signal.removeEventListener('abort', onAbort);
				resolve();
			}, ms);
			signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	private updateStatusBar(): void {
		if (!this.statusBarEl) return;
		if (this.destroyed || !canUseProFeature('batch-studio')) {
			this.statusBarEl.style.display = 'none';
			return;
		}
		const state = getBatchWatchState();
		const enabledRules = this.getEnabledRules();
		const stagedCount = state.stagedItems.length;

		if ((!state.deviceWatchEnabled || enabledRules.length === 0) && stagedCount === 0) {
			this.statusBarEl.style.display = 'none';
			return;
		}

		this.statusBarEl.style.display = '';
		if (state.isProcessing) {
			this.statusBarEl.setText(t('batchStudio.watch.statusBarProcessing'));
		} else if (stagedCount > 0) {
			this.statusBarEl.setText(
				t('batchStudio.watch.statusBarStaged', { count: stagedCount }),
			);
		} else {
			this.statusBarEl.setText(
				t('batchStudio.watch.statusBarActive', { count: enabledRules.length }),
			);
		}
	}

	private async openWatchTab(): Promise<void> {
		const { patchBatchState } = await import('../../../core/store/batchStore');
		const { activateMainView } = await import('../../../core/views/viewHelper');
		const { BATCH_STUDIO_VIEW_TYPE } = await import('../../../shared/constants/viewTypes');
		patchBatchState({ activeMainTab: 'watch' });
		await activateMainView(this.app.workspace, BATCH_STUDIO_VIEW_TYPE);
	}
}
