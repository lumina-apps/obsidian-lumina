/**
 * batchWatchStore.ts
 *
 * 폴더 자동감시(Pro)의 런타임 상태, 검토 대기열(Auto-Stage), 일일 처리량, 활동 로그 및
 * 기기별 로컬 활성화 토글을 관리하는 전역 스토어.
 */

import { derived, get, writable, type Readable } from 'svelte/store';
import type {
	WatchActivityLogEntry,
	WatchStagedItem,
} from '../../shared/types/batchWatch.types';

/** 기기별 자동감시 활성화 상태를 저장하는 Obsidian 로컬 스토리지 키 */
export const DEVICE_WATCH_ENABLED_KEY = 'lumina-batch-watch-device-enabled';

/** Obsidian App의 기기별 로컬 스토리지 API 최소 인터페이스 */
export interface ObsidianLocalStorageHost {
	loadLocalStorage?: (key: string) => unknown;
	saveLocalStorage?: (key: string, data: unknown | null) => void;
}

/** 활동 로그 최대 보존 건수 */
const MAX_WATCH_ACTIVITY_LOG = 100;

/** 일일 처리 카운터용 YYYY-MM-DD 날짜 키 반환 */
export function getLocalDateKey(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * 현재 기기의 Obsidian 로컬 스토리지(app.loadLocalStorage)에서 백그라운드 자동감시 활성화 여부를 읽습니다.
 * 미설정 시 데스크톱은 true, 모바일은 false를 기본값으로 반환합니다.
 */
export function readDeviceWatchEnabled(isMobile: boolean, app?: ObsidianLocalStorageHost): boolean {
	try {
		if (typeof app?.loadLocalStorage === 'function') {
			const raw: unknown = app.loadLocalStorage(DEVICE_WATCH_ENABLED_KEY);
			if (raw === true || raw === 'true') return true;
			if (raw === false || raw === 'false') return false;
		}
	} catch {
		// 로컬 스토리지 접근 불가 환경 무시
	}
	return !isMobile;
}

/**
 * 현재 기기의 백그라운드 자동감시 활성화 여부를 Obsidian 로컬 스토리지(app.saveLocalStorage)에 저장합니다.
 */
export function writeDeviceWatchEnabled(enabled: boolean, app?: ObsidianLocalStorageHost): void {
	try {
		if (typeof app?.saveLocalStorage === 'function') {
			app.saveLocalStorage(DEVICE_WATCH_ENABLED_KEY, enabled);
		}
	} catch {
		// 로컬 스토리지 접근 불가 환경 무시
	}
}

/** 폴더 자동감시 런타임 스토어 상태 */
export interface BatchWatchRuntimeState {
	/** 현재 기기에서의 백그라운드 감시 활성화 여부 */
	deviceWatchEnabled: boolean;
	/** 현재 백그라운드 작업 처리 중 여부 */
	isProcessing: boolean;
	/** 현재 처리 중인 파일 경로 */
	activeJobPath: string | null;
	/** 일일 처리 카운터 기준 날짜 (YYYY-MM-DD) */
	dailyDateKey: string;
	/** 오늘 자동 처리한 파일 수 */
	dailyProcessedCount: number;
	/** Auto-Stage 검토 대기 항목 목록 */
	stagedItems: WatchStagedItem[];
	/** 최근 활동 로그 목록 (최신순) */
	activityLog: WatchActivityLogEntry[];
}

function createInitialWatchState(): BatchWatchRuntimeState {
	return {
		deviceWatchEnabled: false,
		isProcessing: false,
		activeJobPath: null,
		dailyDateKey: getLocalDateKey(),
		dailyProcessedCount: 0,
		stagedItems: [],
		activityLog: [],
	};
}

export const batchWatchStore = writable<BatchWatchRuntimeState>(createInitialWatchState());

/** 검토 대기 중인 Auto-Stage 항목 수 파생 스토어 */
export const watchStagedCount: Readable<number> = derived(
	batchWatchStore,
	($s) => $s.stagedItems.length,
);

/** 현재 자동감시 런타임 상태 스냅샷 반환 */
export function getBatchWatchState(): BatchWatchRuntimeState {
	return get(batchWatchStore);
}

/** 자동감시 런타임 상태 부분 업데이트 */
export function patchBatchWatchState(patch: Partial<BatchWatchRuntimeState>): void {
	batchWatchStore.update((state) => ({
		...state,
		...patch,
	}));
}

/** Auto-Stage 검토 대기 항목을 추가하거나 동일 파일+규칙 항목을 갱신합니다. */
export function upsertWatchStagedItem(item: WatchStagedItem): void {
	batchWatchStore.update((state) => {
		const idx = state.stagedItems.findIndex(
			(existing) => existing.ruleId === item.ruleId && existing.path === item.path,
		);
		if (idx !== -1) {
			const next = [...state.stagedItems];
			next[idx] = item;
			return { ...state, stagedItems: next };
		}
		return {
			...state,
			stagedItems: [item, ...state.stagedItems],
		};
	});
}

/** ID로 Auto-Stage 검토 대기 항목을 제거합니다. */
export function removeWatchStagedItem(stagedId: string): void {
	batchWatchStore.update((state) => ({
		...state,
		stagedItems: state.stagedItems.filter((item) => item.id !== stagedId),
	}));
}

/** 활동 로그 맨 앞에 새 항목을 추가합니다. (최대 100건 유지) */
export function addWatchActivityLog(entry: WatchActivityLogEntry): void {
	batchWatchStore.update((state) => ({
		...state,
		activityLog: [entry, ...state.activityLog].slice(0, MAX_WATCH_ACTIVITY_LOG),
	}));
}

/** 날짜 변경 여부를 확인하고 오늘 자동 처리 건수를 반환합니다. */
export function getTodayProcessedCount(now: Date = new Date()): number {
	const today = getLocalDateKey(now);
	const state = get(batchWatchStore);
	if (state.dailyDateKey !== today) {
		batchWatchStore.update((s) => ({
			...s,
			dailyDateKey: today,
			dailyProcessedCount: 0,
		}));
		return 0;
	}
	return state.dailyProcessedCount;
}

/** 오늘 자동 처리 건수를 1 증가시킵니다. */
export function incrementDailyProcessed(now: Date = new Date()): number {
	const today = getLocalDateKey(now);
	let nextCount = 1;
	batchWatchStore.update((state) => {
		const base = state.dailyDateKey === today ? state.dailyProcessedCount : 0;
		nextCount = base + 1;
		return {
			...state,
			dailyDateKey: today,
			dailyProcessedCount: nextCount,
		};
	});
	return nextCount;
}

/** 자동감시 런타임 상태를 초기값으로 되돌립니다. */
export function resetBatchWatchStore(): void {
	batchWatchStore.set(createInitialWatchState());
}
