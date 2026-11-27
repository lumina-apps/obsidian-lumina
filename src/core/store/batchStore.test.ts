/**
 * batchStore.test.ts
 *
 * Batch Studio 전역 스토어의 큐 카운트 집계, 스코프·폴더 전환 보호,
 * 히스토리 상한/중복 스냅샷 병합, 고아노트 작업실 연동 상태를 검증합니다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	addBatchHistoryEntry,
	appendSnapshotsToHistoryEntry,
	batchQueueCounts,
	getBatchState,
	markBatchHistoryRolledBack,
	patchBatchState,
	resetBatchStore,
	sendOrphansToWorkspace,
	setBatchQueue,
	setBatchRecipeOptions,
	setBatchScopeConfig,
	setBatchSelectedPath,
	setBatchTargetFolder,
	updateBatchQueueItem,
} from './batchStore';
import type { BatchHistoryEntry, BatchItemStatus, BatchQueueItem } from '../../shared/types/batch.types';

function makeQueueItem(path: string, status: BatchItemStatus, selected = false): BatchQueueItem {
	return {
		path,
		basename: path.replace(/\.md$/, ''),
		status,
		selected,
	};
}

function makeHistory(id: string): BatchHistoryEntry {
	return {
		id,
		timestamp: 1000,
		recipeId: 'frontmatter',
		appliedCount: 1,
		rolledBack: false,
		snapshots: [{ path: `${id}.md`, originalRawContent: 'orig' }],
	};
}

describe('batchStore', () => {
	beforeEach(() => {
		resetBatchStore();
	});

	it('batchQueueCounts는 locked 제외 total 및 모든 상태별 개수를 정확히 집계한다', () => {
		setBatchQueue([
			makeQueueItem('0-locked.md', 'locked'),
			makeQueueItem('1-queued.md', 'queued'),
			makeQueueItem('2-running.md', 'running'),
			makeQueueItem('3-staged-sel.md', 'staged', true),
			makeQueueItem('4-staged-unsel.md', 'staged', false),
			makeQueueItem('5-applied.md', 'applied'),
			makeQueueItem('6-rejected.md', 'rejected'),
			makeQueueItem('7-skipped.md', 'skipped'),
			makeQueueItem('8-failed.md', 'failed'),
		]);

		expect(get(batchQueueCounts)).toEqual({
			total: 8,
			locked: 1,
			queued: 1,
			running: 1,
			staged: 2,
			applied: 1,
			rejected: 1,
			skipped: 1,
			cancelled: 0,
			failed: 1,
			done: 6,
			selectedStaged: 1,
		});
	});

	it('setBatchScopeConfig는 스코프 변경 시 샘플 프리뷰 상태를 초기화한다', () => {
		patchBatchState({
			sampleFilePath: 'Notes/a.md',
			sampleResult: { kind: 'frontmatter', afterTags: ['x'] },
			sampleNoChanges: true,
			sampleError: '이전 오류',
		});

		setBatchScopeConfig({ scopeMode: 'folder', folderPath: 'Projects' });
		const state = getBatchState();
		expect(state.scopeConfig.scopeMode).toBe('folder');
		expect(state.scopeConfig.folderPath).toBe('Projects');
		expect(state.sampleFilePath).toBe('');
		expect(state.sampleResult).toBeNull();
		expect(state.sampleNoChanges).toBe(false);
		expect(state.sampleError).toBeNull();
	});

	it('setBatchTargetFolder는 루트("/")는 vault 모드로 전환하고 실행/일시정지 중에는 변경을 차단한다', () => {
		expect(setBatchTargetFolder('Projects/Work/')).toBe(true);
		expect(getBatchState().scopeConfig.scopeMode).toBe('folder');
		expect(getBatchState().scopeConfig.folderPath).toBe('Projects/Work');

		expect(setBatchTargetFolder('/')).toBe(true);
		expect(getBatchState().scopeConfig.scopeMode).toBe('vault');
		expect(getBatchState().scopeConfig.folderPath).toBe('');

		// 실행 중 차단
		patchBatchState({ runState: 'running' });
		expect(setBatchTargetFolder('Blocked')).toBe(false);
		expect(getBatchState().scopeConfig.folderPath).toBe('');

		// 일시정지 중 차단
		patchBatchState({ runState: 'paused' });
		expect(setBatchTargetFolder('Blocked')).toBe(false);
	});

	it('addBatchHistoryEntry는 최대 30개까지만 최신순으로 보관한다', () => {
		for (let i = 1; i <= 35; i++) {
			addBatchHistoryEntry(makeHistory(`h-${i}`));
		}

		const history = getBatchState().history;
		expect(history).toHaveLength(30);
		expect(history[0].id).toBe('h-35');
		expect(history[29].id).toBe('h-6');
	});

	it('appendSnapshotsToHistoryEntry는 동일 경로 중복 추가 시 최초 스냅샷을 보존하고 markBatchHistoryRolledBack으로 롤백 표기한다', () => {
		addBatchHistoryEntry(makeHistory('h-1'));
		appendSnapshotsToHistoryEntry('h-1', [
			{ path: 'h-1.md', originalRawContent: 'should-not-overwrite' },
			{ path: 'extra.md', originalRawContent: 'extra-orig' },
		]);

		const entry = getBatchState().history[0];
		expect(entry.appliedCount).toBe(2);
		expect(entry.snapshots).toEqual([
			{ path: 'h-1.md', originalRawContent: 'orig' },
			{ path: 'extra.md', originalRawContent: 'extra-orig' },
		]);

		markBatchHistoryRolledBack('h-1');
		expect(getBatchState().history[0].rolledBack).toBe(true);
	});

	it('sendOrphansToWorkspace는 대기 상태에서 탭·필터를 전환하고 실행/일시정지 중엔 거부한다', () => {
		patchBatchState({ activeMainTab: 'orphans', isConfigCollapsed: true });
		expect(sendOrphansToWorkspace('no-backlinks')).toBe(true);
		expect(getBatchState().activeMainTab).toBe('workspace');
		expect(getBatchState().isConfigCollapsed).toBe(false);
		expect(getBatchState().scopeConfig.orphanFilter).toBe('no-backlinks');

		patchBatchState({ runState: 'running' });
		expect(sendOrphansToWorkspace('isolated')).toBe(false);
		expect(getBatchState().scopeConfig.orphanFilter).toBe('no-backlinks');
	});

	it('updateBatchQueueItem, setBatchRecipeOptions, setBatchSelectedPath가 정상 동작한다', () => {
		setBatchQueue([makeQueueItem('a.md', 'queued'), makeQueueItem('b.md', 'queued')]);
		updateBatchQueueItem('a.md', { status: 'staged', selected: true });
		setBatchSelectedPath('a.md');
		setBatchRecipeOptions({ calloutTitle: '핵심 요약' });

		const state = getBatchState();
		expect(state.queue[0].status).toBe('staged');
		expect(state.queue[1].status).toBe('queued');
		expect(state.selectedPath).toBe('a.md');
		expect(state.recipeOptions.calloutTitle).toBe('핵심 요약');
	});
});
