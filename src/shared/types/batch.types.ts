/**
 * Lumina Batch Studio(Pro 볼트 전체 일괄 작업 자동화) 도메인 타입 정의.
 */

import type { FolderMoveConfig, FolderWatchRule } from './batchWatch.types';

/** 지원되는 배치 레시피 식별자 */
export type BatchRecipeId =
	| 'frontmatter'
	| 'autolink'
	| 'summary-callout'
	| 'custom-prompt'
	| 'folder-move';

/** 프론트매터 레시피 병합 방식 */
export type FrontmatterMergeMode = 'empty-only' | 'merge' | 'overwrite';

/** 커스텀 프롬프트 결과 반영 방식 */
export type CustomOutputMode = 'frontmatter-key' | 'prepend' | 'append' | 'replace';

/** 배치 실행 상태 */
export type BatchRunState = 'idle' | 'running' | 'paused' | 'completed';

/** 좌측 큐 필터 탭 */
export type BatchQueueFilter = 'all' | 'staged' | 'applied' | 'skipped' | 'failed';

/** 메인 화면 탭 */
export type BatchMainTab = 'workspace' | 'orphans' | 'watch' | 'history';

/** 대상 노트 선택 및 스마트 필터 설정 */
export interface BatchScopeConfig {
	/** 대상 범위 (전체 볼트 vs 특정 폴더) */
	scopeMode: 'vault' | 'folder';
	/** 특정 폴더 경로 (예: 'Projects/Notes') */
	folderPath: string;
	/** 선택적 태그 필터 (예: '#meeting' 또는 'meeting') */
	tagFilter: string;
	/** 이미 대상 속성 또는 콜아웃이 존재하는 노트 자동 건너뛰기 여부 */
	skipIfAlreadyHasTarget: boolean;
	/** 최소 본문 글자 수 (프론트매터 제외 길이) */
	minContentLength: number;
	/** 고아노트 필터 (전체 / 완전 고립 / 백링크 없음) */
	orphanFilter?: 'all' | 'isolated' | 'no-backlinks';
}

/** 레시피별 세부 실행 옵션 */
export interface BatchRecipeOptions {
	/** 프론트매터 병합 모드 */
	fmMergeMode: FrontmatterMergeMode;
	/** 태그 자동 생성 활성화 */
	generateTags: boolean;
	/** 한 줄 요약(description) 자동 생성 활성화 */
	generateDescription: boolean;
	/** 요약 콜아웃 제목 */
	calloutTitle: string;
	/** 커스텀 프롬프트 템플릿 */
	customPrompt: string;
	/** 커스텀 프롬프트 결과 반영 방식 */
	customOutputMode: CustomOutputMode;
	/** 커스텀 프롬프트 결과를 저장할 프론트매터 키 */
	customFrontmatterKey: string;
	/** 선택된 프로바이더 ID (빈 문자열이면 Task/기본 모델 자동 선택) */
	providerId: string;
	/** 선택된 모델 ID */
	modelId: string;
	/** 폴더 이동 레시피 옵션 (선택) */
	moveConfig?: FolderMoveConfig;
}

/** 큐 항목 처리 상태 */
export type BatchItemStatus =
	| 'queued'
	| 'running'
	| 'staged'
	| 'applied'
	| 'rejected'
	| 'skipped'
	| 'failed'
	| 'locked';

/** LLM/로컬 처리로 제안된 변경 내용 */
export interface BatchProposedChange {
	/** 변경 유형 ('frontmatter' | 'content' | 'move') */
	kind: 'frontmatter' | 'content' | 'move';
	/** 변경 전 태그 목록 */
	beforeTags?: string[];
	/** 제안된 태그 목록 */
	afterTags?: string[];
	/** 변경 전 description */
	beforeDescription?: string;
	/** 제안된 description */
	afterDescription?: string;
	/** 커스텀 프론트매터 키 이름 */
	customFmKey?: string;
	/** 변경 전 커스텀 프론트매터 값 */
	beforeCustomFmVal?: string;
	/** 제안된 커스텀 프론트매터 값 */
	afterCustomFmVal?: string;
	/** 변경 전 전체 본문 텍스트 */
	beforeContent?: string;
	/** 변경 후 전체 본문 텍스트 */
	afterContent?: string;
	/** 폴더 이동 전 경로 */
	moveFromPath?: string;
	/** 폴더 이동 후 목표 경로 */
	moveToPath?: string;
	/** AI 분류 또는 매핑 사유 */
	moveReason?: string;
	/** 큐 리스트 배지에 표시할 짧은 변경 요약 (예: '+3 tags', '+2 links') */
	summaryText?: string;
}

/** 배치 큐 개별 노트 항목 */
export interface BatchQueueItem {
	/** 볼트 상대 파일 경로 */
	path: string;
	/** 확장자를 제외한 노트 제목 */
	basename: string;
	/** 현재 항목 상태 */
	status: BatchItemStatus;
	/** 일괄 수락 대상 체크 여부 */
	selected: boolean;
	/** 생성된 변경 제안 데이터 */
	proposed?: BatchProposedChange;
	/** 실패 시 오류 메시지 */
	errorMessage?: string;
	/** 해당 항목 처리에 소모된 토큰 수 */
	tokensUsed?: number;
}

/** 롤백용 단일 파일 원본 스냅샷 */
export interface BatchSnapshotEntry {
	/** 볼트 상대 파일 경로 (변경 전 원본 경로) */
	path: string;
	/** 반영 직전 원본 마크다운 전체 텍스트 */
	originalRawContent: string;
	/** 폴더 이동이 발생한 경우 이동 전 경로 */
	movedFromPath?: string;
	/** 폴더 이동이 발생한 경우 이동 후 경로 */
	movedToPath?: string;
	/** 휴지통으로 이동된 경우 롤백 시 파일 재생성 여부 */
	trashed?: boolean;
}

/** 배치 반영 히스토리 항목 */
export interface BatchHistoryEntry {
	/** 고유 히스토리 ID */
	id: string;
	/** 반영 시각 (Unix ms) */
	timestamp: number;
	/** 실행한 레시피 종류 */
	recipeId: BatchRecipeId;
	/** 수정된 파일 개수 */
	appliedCount: number;
	/** 롤백 완료 여부 */
	rolledBack: boolean;
	/** 복원에 사용할 원본 스냅샷 목록 */
	snapshots: BatchSnapshotEntry[];
	/** 실행 출처 (수동 배치 vs 폴더 자동감시 vs 고아노트 정리) */
	source?: 'manual' | 'watch' | 'orphan';
	/** 자동감시 규칙 이름 (source === 'watch'일 때 표시용) */
	ruleName?: string;
	/** 고아노트 작업 요약 라벨 (source === 'orphan'일 때 표시용) */
	actionLabel?: string;
}

/** Watch 탭 규칙 편집기에 전달할 초안 데이터 타입 재노출 */
export type BatchWatchRuleDraft = Partial<FolderWatchRule>;

/** 줄 단위 Diff 렌더링 항목 */
export interface BatchDiffLine {
	type: 'same' | 'added' | 'removed';
	text: string;
}
