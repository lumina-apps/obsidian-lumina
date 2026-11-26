/**
 * batchStore.ts
 *
 * Lumina Batch Studio의 전역 런타임 상태 스토어.
 * 중앙 워크스페이스 탭 전환, 백그라운드 배치 실행, 폴더 우클릭 진입 시 상태 보존 및
 * 플러그인 언로드/권한 해제 시 상태 초기화를 지원합니다.
 */

import { normalizePath } from 'obsidian';
import { derived, get, writable, type Readable } from 'svelte/store';
import type {
	BatchHistoryEntry,
	BatchMainTab,
	BatchProposedChange,
	BatchQueueFilter,
	BatchQueueItem,
	BatchRecipeId,
	BatchRecipeOptions,
	BatchRunState,
	BatchScopeConfig,
	BatchSnapshotEntry,
} from '../../shared/types/batch.types';
import type { FolderMoveConfig, FolderWatchRule } from '../../shared/types/batchWatch.types';

/** 기본 폴더 이동 설정을 생성합니다. */
export function createDefaultFolderMoveConfig(
	mode: FolderMoveConfig['mode'] = 'fixed',
): FolderMoveConfig {
	return {
		mode,
		fixedTargetFolder: '',
		tagMappings: [],
		aiCandidateFolders: [],
		fallbackFolder: '',
		conflictPolicy: 'rename-suffix',
		createFolderIfMissing: true,
	};
}

/** Batch Studio 런타임 상태 구조 */
export interface BatchStudioState {
	activeRecipeId: BatchRecipeId;
	activeMainTab: BatchMainTab;
	isConfigCollapsed: boolean;
	scopeConfig: BatchScopeConfig;
	recipeOptions: BatchRecipeOptions;
	queue: BatchQueueItem[];
	runState: BatchRunState;
	selectedPath: string | null;
	queueFilter: BatchQueueFilter;
	sampleFilePath: string;
	sampleRunning: boolean;
	sampleResult: BatchProposedChange | null;
	sampleNoChanges: boolean;
	sampleError: string | null;
	rateLimitCountdownSec: number | null;
	history: BatchHistoryEntry[];
	/** 현재 배치 실행 세션에 연결된 히스토리 ID (단건 수락 묶음용) */
	activeRunHistoryId: string | null;
	/** 작업 공간 설정에서 자동감시 탭 규칙 편집기로 넘기는 초안 데이터 */
	draftWatchRule: Partial<FolderWatchRule> | null;
}

function createInitialScopeConfig(): BatchScopeConfig {
	return {
		scopeMode: 'vault',
		folderPath: '',
		tagFilter: '',
		skipIfAlreadyHasTarget: true,
		minContentLength: 50,
		orphanFilter: 'all',
	};
}

function createInitialRecipeOptions(): BatchRecipeOptions {
	return {
		fmMergeMode: 'empty-only',
		generateTags: true,
		generateDescription: true,
		calloutTitle: 'Summary',
		customPrompt: '',
		customOutputMode: 'frontmatter-key',
		customFrontmatterKey: 'ai_summary',
		providerId: '',
		modelId: '',
		moveConfig: createDefaultFolderMoveConfig('fixed'),
	};
}

function createInitialState(): BatchStudioState {
	return {
		activeRecipeId: 'frontmatter',
		activeMainTab: 'workspace',
		isConfigCollapsed: false,
		scopeConfig: createInitialScopeConfig(),
		recipeOptions: createInitialRecipeOptions(),
		queue: [],
		runState: 'idle',
		selectedPath: null,
		queueFilter: 'all',
		sampleFilePath: '',
		sampleRunning: false,
		sampleResult: null,
		sampleNoChanges: false,
		sampleError: null,
		rateLimitCountdownSec: null,
		history: [],
		activeRunHistoryId: null,
		draftWatchRule: null,
	};
}

export const batchStore = writable<BatchStudioState>(createInitialState());

/** 큐 상태별 개수 요약 파생 스토어 */
export const batchQueueCounts: Readable<{
	total: number;
	locked: number;
	queued: number;
	running: number;
	staged: number;
	applied: number;
	rejected: number;
	skipped: number;
	failed: number;
	done: number;
	selectedStaged: number;
}> = derived(batchStore, ($s) => {
	let locked = 0;
	let queued = 0;
	let running = 0;
	let staged = 0;
	let applied = 0;
	let rejected = 0;
	let skipped = 0;
	let failed = 0;
	let selectedStaged = 0;

	for (const item of $s.queue) {
		switch (item.status) {
			case 'locked':
				locked++;
				break;
			case 'queued':
				queued++;
				break;
			case 'running':
				running++;
				break;
			case 'staged':
				staged++;
				if (item.selected) selectedStaged++;
				break;
			case 'applied':
				applied++;
				break;
			case 'rejected':
				rejected++;
				break;
			case 'skipped':
				skipped++;
				break;
			case 'failed':
				failed++;
				break;
		}
	}

	const total = $s.queue.length - locked;
	const done = staged + applied + rejected + skipped + failed;
	return {
		total,
		locked,
		queued,
		running,
		staged,
		applied,
		rejected,
		skipped,
		failed,
		done,
		selectedStaged,
	};
});

/** 현재 Batch Studio 상태 스냅샷 반환 */
export function getBatchState(): BatchStudioState {
	return get(batchStore);
}

/** Batch Studio 상태를 초기 상태로 완전히 재설정 */
export function resetBatchStore(): void {
	batchStore.set(createInitialState());
}

/** Batch Studio 최상위 상태 일부를 부분 패치 */
export function patchBatchState(patch: Partial<BatchStudioState>): void {
	batchStore.update((state) => ({
		...state,
		...patch,
	}));
}

/** 대상 범위 및 필터 설정 업데이트 */
export function setBatchScopeConfig(patch: Partial<BatchScopeConfig>): void {
	batchStore.update((state) => ({
		...state,
		sampleFilePath: '',
		sampleResult: null,
		sampleNoChanges: false,
		sampleError: null,
		scopeConfig: {
			...state.scopeConfig,
			...patch,
		},
	}));
}

/** 레시피 세부 옵션 업데이트 */
export function setBatchRecipeOptions(patch: Partial<BatchRecipeOptions>): void {
	batchStore.update((state) => ({
		...state,
		recipeOptions: {
			...state.recipeOptions,
			...patch,
		},
	}));
}

/** 배치 큐 전체 설정 */
export function setBatchQueue(queue: BatchQueueItem[]): void {
	batchStore.update((state) => ({
		...state,
		queue,
	}));
}

/** 배치 큐 내 특정 파일 항목 업데이트 */
export function updateBatchQueueItem(path: string, patch: Partial<BatchQueueItem>): void {
	batchStore.update((state) => ({
		...state,
		queue: state.queue.map((item) => (item.path === path ? { ...item, ...patch } : item)),
	}));
}

/** 좌측 큐에서 현재 검수 중인 파일 경로 선택 */
export function setBatchSelectedPath(path: string | null): void {
	batchStore.update((state) => ({
		...state,
		selectedPath: path,
	}));
}

/** 폴더 컨텍스트 메뉴 진입 시 대상 폴더 즉시 지정 및 설정 패널 펼치기 (실행/일시정지 중에는 덮어쓰지 않음) */
export function setBatchTargetFolder(folderPath: string): boolean {
	const cleaned = folderPath === '/' ? '' : normalizePath(folderPath);
	let updated = false;
	batchStore.update((state) => {
		if (state.runState === 'running' || state.runState === 'paused') {
			return state;
		}
		updated = true;
		return {
			...state,
			activeMainTab: 'workspace',
			isConfigCollapsed: false,
			scopeConfig: {
				...state.scopeConfig,
				scopeMode: cleaned ? 'folder' : 'vault',
				folderPath: cleaned,
			},
		};
	});
	return updated;
}

/** 새 배치 히스토리 항목을 목록 맨 앞에 추가 */
export function addBatchHistoryEntry(entry: BatchHistoryEntry): void {
	batchStore.update((state) => ({
		...state,
		history: [entry, ...state.history].slice(0, 30),
	}));
}

/** 기존 배치 히스토리 항목에 단건 반영 스냅샷 추가 (동일 경로 중복 시 최초 스냅샷 보존) */
export function appendSnapshotsToHistoryEntry(
	historyId: string,
	newSnapshots: readonly BatchSnapshotEntry[],
): void {
	if (newSnapshots.length === 0) return;
	batchStore.update((state) => ({
		...state,
		history: state.history.map((entry) => {
			if (entry.id !== historyId) return entry;
			const existingPaths = new Set(entry.snapshots.map((s) => s.path));
			const toAdd = newSnapshots.filter((s) => !existingPaths.has(s.path));
			if (toAdd.length === 0) return entry;
			const mergedSnapshots = [...entry.snapshots, ...toAdd];
			return {
				...entry,
				appliedCount: mergedSnapshots.length,
				snapshots: mergedSnapshots,
			};
		}),
	}));
}

/** 지정한 배치 히스토리를 롤백 완료 상태로 표시 */
export function markBatchHistoryRolledBack(historyId: string): void {
	batchStore.update((state) => ({
		...state,
		history: state.history.map((entry) =>
			entry.id === historyId ? { ...entry, rolledBack: true } : entry,
		),
	}));
}

/**
 * 고아노트 탭에서 '일괄 작업실로 보내기' 클릭 시 작업실 탭으로 전환하고 고아 필터를 지정합니다.
 * (실행 또는 일시정지 중에는 덮어쓰지 않음)
 */
export function sendOrphansToWorkspace(mode: 'isolated' | 'no-backlinks'): boolean {
	let updated = false;
	batchStore.update((state) => {
		if (state.runState === 'running' || state.runState === 'paused') {
			return state;
		}
		updated = true;
		return {
			...state,
			activeMainTab: 'workspace',
			isConfigCollapsed: false,
			sampleFilePath: '',
			sampleResult: null,
			sampleNoChanges: false,
			sampleError: null,
			scopeConfig: {
				...state.scopeConfig,
				orphanFilter: mode,
			},
		};
	});
	return updated;
}
