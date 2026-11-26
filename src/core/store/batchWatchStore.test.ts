/**
 * batchWatchStore.test.ts
 *
 * 폴더 자동감시 런타임 스토어의 기기별 localStorage 토글,
 * 검토 대기열 upsert/remove, 활동 로그 100건 상한, 일일 처리 카운터 날짜 롤오버를 검증합니다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
	DEVICE_WATCH_ENABLED_KEY,
	addWatchActivityLog,
	getBatchWatchState,
	getLocalDateKey,
	getTodayProcessedCount,
	incrementDailyProcessed,
	patchBatchWatchState,
	readDeviceWatchEnabled,
	removeWatchStagedItem,
	resetBatchWatchStore,
	upsertWatchStagedItem,
	watchStagedCount,
	writeDeviceWatchEnabled,
} from './batchWatchStore';
import type { WatchActivityLogEntry, WatchStagedItem } from '../../shared/types/batchWatch.types';

function makeStagedItem(id: string, ruleId: string, path: string, tokensUsed = 10): WatchStagedItem {
	return {
		id,
		ruleId,
		ruleName: 'Inbox Rule',
		path,
		basename: path.split('/').pop() ?? path,
		createdAt: 1000,
		steps: [],
		tokensUsed,
	};
}

function makeLogEntry(id: string): WatchActivityLogEntry {
	return {
		id,
		timestamp: 1000,
		ruleId: 'r1',
		ruleName: 'Inbox Rule',
		path: `Inbox/${id}.md`,
		status: 'applied',
	};
}

describe('batchWatchStore', () => {
	const origLocalStorage = window.localStorage;
	let memStorage: Map<string, string>;

	beforeEach(() => {
		resetBatchWatchStore();
		memStorage = new Map<string, string>();
		Object.defineProperty(window, 'localStorage', {
			value: {
				getItem: (key: string) => memStorage.get(key) ?? null,
				setItem: (key: string, val: string) => {
					memStorage.set(key, val);
				},
				removeItem: (key: string) => {
					memStorage.delete(key);
				},
			},
			configurable: true,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		Object.defineProperty(window, 'localStorage', {
			value: origLocalStorage,
			configurable: true,
		});
		vi.restoreAllMocks();
	});

	it('readDeviceWatchEnabled/writeDeviceWatchEnabled는 데스크톱 기본 true, 모바일 기본 false 및 저장값 우선 규칙을 따른다', () => {
		expect(readDeviceWatchEnabled(false)).toBe(true);
		expect(readDeviceWatchEnabled(true)).toBe(false);

		writeDeviceWatchEnabled(false);
		expect(readDeviceWatchEnabled(false)).toBe(false);

		writeDeviceWatchEnabled(true);
		expect(readDeviceWatchEnabled(true)).toBe(true);
	});

	it('localStorage 접근이 예외를 던져도 안전하게 기본값을 반환하고 저장 시 크래시하지 않는다', () => {
		Object.defineProperty(window, 'localStorage', {
			value: {
				getItem: () => {
					throw new Error('SecurityError');
				},
				setItem: () => {
					throw new Error('QuotaExceededError');
				},
			},
			configurable: true,
		});

		expect(() => writeDeviceWatchEnabled(true)).not.toThrow();
		expect(readDeviceWatchEnabled(false)).toBe(true);
		expect(readDeviceWatchEnabled(true)).toBe(false);
	});

	it('upsertWatchStagedItem은 신규 추가 및 동일 ruleId+path 항목의 제자리 갱신을 수행한다', () => {
		upsertWatchStagedItem(makeStagedItem('s1', 'r1', 'Inbox/a.md', 10));
		upsertWatchStagedItem(makeStagedItem('s2', 'r1', 'Inbox/b.md', 20));
		expect(get(watchStagedCount)).toBe(2);

		// 동일 ruleId + path 갱신
		upsertWatchStagedItem(makeStagedItem('s1-updated', 'r1', 'Inbox/a.md', 99));
		expect(get(watchStagedCount)).toBe(2);
		const updated = getBatchWatchState().stagedItems.find((i) => i.path === 'Inbox/a.md');
		expect(updated?.id).toBe('s1-updated');
		expect(updated?.tokensUsed).toBe(99);

		removeWatchStagedItem('s1-updated');
		expect(get(watchStagedCount)).toBe(1);
	});

	it('addWatchActivityLog는 최신 100건까지만 유지한다', () => {
		for (let i = 1; i <= 110; i++) {
			addWatchActivityLog(makeLogEntry(`log-${i}`));
		}

		const logs = getBatchWatchState().activityLog;
		expect(logs).toHaveLength(100);
		expect(logs[0].id).toBe('log-110');
		expect(logs[99].id).toBe('log-11');
	});

	it('일일 처리 카운터는 같은 날 누적되고 날짜가 바뀌면 0으로 롤오버된다', () => {
		const day1 = new Date(2026, 10, 27, 10, 0, 0);
		const day2 = new Date(2026, 10, 28, 9, 0, 0);

		patchBatchWatchState({ dailyDateKey: getLocalDateKey(day1), dailyProcessedCount: 0 });
		expect(incrementDailyProcessed(day1)).toBe(1);
		expect(incrementDailyProcessed(day1)).toBe(2);
		expect(getTodayProcessedCount(day1)).toBe(2);

		// 자정 이후 날짜 변경 -> getTodayProcessedCount가 0으로 리셋
		expect(getTodayProcessedCount(day2)).toBe(0);
		expect(getBatchWatchState().dailyDateKey).toBe('2026-11-28');
		expect(incrementDailyProcessed(day2)).toBe(1);
	});
});
