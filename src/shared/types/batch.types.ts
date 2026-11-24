/**
 * Lumina Batch Studio(Pro 볼트 전체 일괄 작업 자동화) 도메인 타입 정의.
 */

/** 지원되는 배치 레시피 식별자 */
export type BatchRecipeId = 'frontmatter' | 'autolink' | 'summary-callout' | 'custom-prompt';

/** 프론트매터 레시피 병합 방식 */
export type FrontmatterMergeMode = 'empty-only' | 'merge' | 'overwrite';

/** 커스텀 프롬프트 결과 반영 방식 */
export type CustomOutputMode = 'frontmatter-key' | 'prepend' | 'append' | 'replace';

/** 배치 실행 상태 */
export type BatchRunState = 'idle' | 'running' | 'paused' | 'completed';

/** 좌측 큐 필터 탭 */
export type BatchQueueFilter = 'all' | 'staged' | 'applied' | 'skipped' | 'failed';

/** 메인 화면 탭 */
export type BatchMainTab = 'workspace' | 'history';

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
	/** 변경 유형 ('frontmatter' | 'content') */
	kind: 'frontmatter' | 'content';
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
	/** 볼트 상대 파일 경로 */
	path: string;
	/** 반영 직전 원본 마크다운 전체 텍스트 */
	originalRawContent: string;
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
}

/** 줄 단위 Diff 렌더링 항목 */
export interface BatchDiffLine {
	type: 'same' | 'added' | 'removed';
	text: string;
}
