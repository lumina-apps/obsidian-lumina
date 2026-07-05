import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	indexingState,
	resumedFromCheckpoint,
	showIndexingIndicator,
	indexingProgress,
	indexingStatusText,
	isRagReady,
	estimatedTimeRemaining,
	setIndexingStatus,
	incrementProcessed,
	incrementProcessedBy,
	setTotalFiles,
	resetIndexing,
} from './ragStore';

describe('ragStore', () => {
	beforeEach(() => {
		resetIndexing();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should initialize with default state', () => {
		const state = get(indexingState);
		expect(state.status).toBe('idle');
		expect(state.totalFiles).toBe(0);
		expect(state.processedFiles).toBe(0);
		expect(get(resumedFromCheckpoint)).toBe(false);
	});

	it('should reset state correctly', () => {
		setIndexingStatus('loading-model', { totalFiles: 10, processedFiles: 5 });
		resumedFromCheckpoint.set(true);
		
		resetIndexing();
		
		const state = get(indexingState);
		expect(state.status).toBe('idle');
		expect(state.totalFiles).toBe(0);
		expect(state.processedFiles).toBe(0);
		expect(get(resumedFromCheckpoint)).toBe(false);
	});

	it('should update status and merge extra properties', () => {
		setIndexingStatus('loading-model', { progressPct: 50 });
		const state = get(indexingState);
		expect(state.status).toBe('loading-model');
		expect(state.progressPct).toBe(50);
	});

	it('should update progress correctly', () => {
		setTotalFiles(100);
		incrementProcessedBy(25);
		
		expect(get(indexingProgress)).toBe(25);
		
		incrementProcessedBy(25);
		expect(get(indexingProgress)).toBe(50);
		
		incrementProcessed();
		expect(get(indexingProgress)).toBe(51);
	});

	it('should handle zero total files in progress calculation', () => {
		resetIndexing();
		expect(get(indexingProgress)).toBe(0);
	});

	it('should update status text properly', () => {
		expect(get(indexingStatusText)).toBe('대기 중');
		
		setIndexingStatus('loading-model');
		expect(get(indexingStatusText)).toBe('임베딩 모델 로딩 중…');
		
		setIndexingStatus('loading-model', { progressPct: 40 });
		expect(get(indexingStatusText)).toBe('임베딩 모델 로딩 중… (40%)');

		setTotalFiles(10);
		expect(get(indexingStatusText)).toBe('인덱싱 중… (0 / 10개)');
		
		resumedFromCheckpoint.set(true);
		expect(get(indexingStatusText)).toBe('이어서 인덱싱 중… (0 / 10개)');

		setIndexingStatus('ready');
		expect(get(indexingStatusText)).toBe('준비 완료 — 10개 파일 인덱싱됨');

		setIndexingStatus('error', { errorMessage: 'Test error' });
		expect(get(indexingStatusText)).toBe('오류: Test error');
	});

	it('should check isRagReady', () => {
		expect(get(isRagReady)).toBe(false);
		setIndexingStatus('ready');
		expect(get(isRagReady)).toBe(true);
	});

	it('should calculate estimated time remaining based on EMA', () => {
		const now = Date.now();
		vi.setSystemTime(now);
		
		setTotalFiles(100, 0, now);
		
		vi.setSystemTime(now + 500);
		incrementProcessedBy(10); 
		expect(get(estimatedTimeRemaining)).toBe(5);
		
		vi.setSystemTime(now + 1000);
		incrementProcessedBy(5);
		expect(get(estimatedTimeRemaining)).toBe(5);
	});

	it('should show indexing indicator with a delay', () => {
		expect(get(showIndexingIndicator)).toBe(false);
		
		setIndexingStatus('loading-model');
		vi.advanceTimersByTime(500);
		expect(get(showIndexingIndicator)).toBe(false);
		
		vi.advanceTimersByTime(500);
		expect(get(showIndexingIndicator)).toBe(true);
		
		setIndexingStatus('idle');
		expect(get(showIndexingIndicator)).toBe(false);
	});
});
