/**
 * ragStore.ts
 *
 * RAG 인덱싱 및 검색 런타임 상태.
 * - indexingState: 워커 진행률 + 파일 카운트
 * - indexingProgress: 0~100 퍼센트 (derived)
 * - indexingStatusText: 사람이 읽기 좋은 상태 문자열 (derived)
 * - estimatedTimeRemaining: 예상 잔여 초 (derived)
 *
 * main.ts → initEmbeddingWorker 콜백에서 업데이트.
 * settingTab / RAG UI에서 반응형 구독.
 */

import { writable, derived } from 'svelte/store';
import type { IndexingState, IndexingStatus } from '../../shared/types/rag.types';

// ─── State ────────────────────────────────────────────────────────────────────

const INITIAL_STATE: IndexingState = {
	status: 'idle',
	totalFiles: 0,
	processedFiles: 0,
};

export const indexingState = writable<IndexingState>({ ...INITIAL_STATE });

export const showIndexingIndicator = writable(false);
let indicatorTimer: ReturnType<typeof setTimeout> | null = null;

indexingState.subscribe(state => {
	if (state.status === 'loading-model' || state.status === 'indexing') {
		if (!indicatorTimer) {
			indicatorTimer = setTimeout(() => {
				showIndexingIndicator.set(true);
			}, 1000);
		}
	} else {
		if (indicatorTimer) {
			clearTimeout(indicatorTimer);
			indicatorTimer = null;
		}
		showIndexingIndicator.set(false);
	}
});

/** 인덱싱 진행률 (0 ~ 100). totalFiles가 0이면 0 반환 */
export const indexingProgress = derived(indexingState, ($s) =>
	$s.totalFiles > 0 ? Math.round(($s.processedFiles / $s.totalFiles) * 100) : 0,
);

/** 사람이 읽기 좋은 상태 문자열 */
export const indexingStatusText = derived(indexingState, ($s): string => {
	switch ($s.status) {
		case 'idle':
			return '대기 중';
		case 'loading-model':
			return '임베딩 모델 로딩 중…';
		case 'indexing':
			return `인덱싱 중… (${$s.processedFiles} / ${$s.totalFiles}개)`;
		case 'ready':
			return `준비 완료 — ${$s.totalFiles}개 파일 인덱싱됨`;
		case 'error':
			return `오류: ${$s.errorMessage ?? '알 수 없는 오류'}`;
	}
});

/** 워커가 완전히 준비된 상태인지 여부 */
export const isRagReady = derived(indexingState, ($s) => $s.status === 'ready');

/**
 * 예상 잔여 시간 (초 단위).
 * 처리된 파일이 없거나 시작 시각이 없으면 null 반환.
 */
export const estimatedTimeRemaining = derived(indexingState, ($s): number | null => {
	if ($s.status !== 'indexing') return null;
	if (!$s.startTime || $s.processedFiles === 0) return null;
	const elapsed = (Date.now() - $s.startTime) / 1000; // 초
	const rate = $s.processedFiles / elapsed; // 파일/초
	if (rate <= 0) return null;
	const remaining = ($s.totalFiles - $s.processedFiles) / rate;
	return Math.ceil(remaining);
});

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * 인덱싱 상태 업데이트.
 * 나머지 필드는 기존 값을 유지 (partial merge).
 */
export function setIndexingStatus(
	status: IndexingStatus,
	extra?: Partial<Omit<IndexingState, 'status'>>,
): void {
	indexingState.update(s => ({ ...s, status, ...extra }));
}

/** 처리된 파일 수 증가 (1씩) */
export function incrementProcessed(): void {
	indexingState.update(s => ({ ...s, processedFiles: s.processedFiles + 1 }));
}

/** 전체 파일 수 설정 (인덱싱 시작 시) — startTime도 함께 기록 */
export function setTotalFiles(total: number): void {
	indexingState.update(s => ({
		...s,
		totalFiles: total,
		processedFiles: 0,
		status: 'indexing',
		startTime: Date.now(),
	}));
}

/** 초기 상태로 리셋 */
export function resetIndexing(): void {
	indexingState.set({ ...INITIAL_STATE });
}
