/**
 * 폴더 이동(Folder Move) 및 Pro 백그라운드 폴더 자동감시 도메인 타입 정의.
 */

import type {
	BatchProposedChange,
	BatchRecipeId,
	BatchRecipeOptions,
} from './batch.types';

/** 폴더 이동 라우팅 방식 */
export type FolderMoveMode = 'none' | 'fixed' | 'by-tag' | 'ai-route';

/** 대상 폴더에 동일 파일명이 존재할 때의 충돌 처리 정책 */
export type MoveConflictPolicy = 'rename-suffix' | 'skip';

/** 태그 조건 기반 폴더 매핑 항목 */
export interface TagFolderMapping {
	/** 매칭할 태그 (선행 # 제외, 하위 태그 접두사 일치 지원) */
	tag: string;
	/** 이동할 대상 폴더 경로 */
	targetFolder: string;
}

/** 폴더 이동 설정 */
export interface FolderMoveConfig {
	/** 이동 라우팅 방식 */
	mode: FolderMoveMode;
	/** 고정 폴더 이동 대상 경로 (mode === 'fixed') */
	fixedTargetFolder: string;
	/** 태그별 폴더 매핑 목록 (mode === 'by-tag') */
	tagMappings: TagFolderMapping[];
	/** AI 자동 분류가 선택할 수 있는 허용 후보 폴더 목록 (mode === 'ai-route') */
	aiCandidateFolders: string[];
	/** 조건 미일치 또는 분류 불가 시 이동할 폴백 폴더 (비어 있으면 이동 안 함) */
	fallbackFolder: string;
	/** 동일 파일명 충돌 시 처리 정책 */
	conflictPolicy: MoveConflictPolicy;
	/** 대상 폴더가 존재하지 않을 경우 자동 생성 여부 */
	createFolderIfMissing: boolean;
}

/** 자동감시 트리거 방식 */
export type WatchTriggerMode = 'on-create' | 'on-create-or-modify' | 'interval';

/** 자동감시 결과 적용 방식 */
export type WatchExecutionMode = 'auto-stage' | 'auto-apply';

/** 폴더 자동감시에서 레시피로 실행 가능한 콘텐츠/메타데이터 작업 ID */
export type WatchContentRecipeId = Exclude<BatchRecipeId, 'folder-move'>;

/** 폴더 자동감시 규칙 정의 */
export interface FolderWatchRule {
	/** 규칙 고유 식별자 */
	id: string;
	/** 사용자 표시용 규칙 이름 */
	name: string;
	/** 규칙 활성화 여부 */
	enabled: boolean;
	/** 감시할 볼트 상대 폴더 경로 (루트 '/' 금지) */
	sourceFolder: string;
	/** 하위 폴더 포함 감시 여부 */
	includeSubfolders: boolean;
	/** 선택적 태그 필터 */
	tagFilter: string;
	/** 최소 본문 글자 수 */
	minContentLength: number;
	/** 이미 대상 속성/콜아웃이 있는 노트 건너뛰기 여부 */
	skipIfAlreadyHasTarget: boolean;
	/** 트리거 방식 */
	triggerMode: WatchTriggerMode;
	/** 변경 감지 후 대기 시간(초, 최소 3초) */
	debounceSec: number;
	/** 주기적 스캔 간격(분, triggerMode === 'interval'일 때 사용) */
	intervalMin: number;
	/** 순차 실행할 레시피 목록 (0개 이상, 빈 배열이면 폴더 이동만 수행) */
	recipes: WatchContentRecipeId[];
	/** 레시피 실행 옵션 */
	recipeOptions: BatchRecipeOptions;
	/** 레시피 완료 후 수행할 폴더 이동 설정 */
	moveAction: FolderMoveConfig;
	/** 결과 적용 모드 ('auto-stage' 권장 | 'auto-apply') */
	executionMode: WatchExecutionMode;
}

/** 설정(data.json)에 저장되는 폴더 자동감시 환경설정 */
export interface BatchWatchPreferences {
	/** 등록된 폴더 감시 규칙 목록 */
	rules: FolderWatchRule[];
	/** 일일 최대 자동 처리 건수 (비용 폭증 방지) */
	dailyMaxItems?: number;
	/** 버스트 차단 임계치 (단시간 내 동시 유입 파일 수 제한) */
	burstLimit?: number;
	/** 데스크톱 상태바 배지 표시 여부 */
	showStatusBar?: boolean;
}

/** Auto-Stage 검토 대기 항목 내 개별 레시피 제안 */
export interface WatchStagedStep {
	/** 실행된 레시피 ID */
	recipeId: WatchContentRecipeId;
	/** 제안된 변경 내용 */
	proposed: BatchProposedChange;
}

/** Auto-Stage 모드로 생성된 검토 대기 항목 */
export interface WatchStagedItem {
	/** 대기 항목 고유 ID */
	id: string;
	/** 생성한 감시 규칙 ID */
	ruleId: string;
	/** 생성한 감시 규칙 이름 */
	ruleName: string;
	/** 대상 파일 볼트 상대 경로 */
	path: string;
	/** 확장자 제외 파일명 */
	basename: string;
	/** 생성 시각 (Unix ms) */
	createdAt: number;
	/** 레시피별 변경 제안 목록 */
	steps: WatchStagedStep[];
	/** 폴더 이동 제안 (있는 경우) */
	moveProposal?: {
		fromPath: string;
		toPath: string;
		reason?: string;
	};
	/** 소모된 총 토큰 수 */
	tokensUsed: number;
}

/** 자동감시 활동 로그 상태 */
export type WatchActivityStatus =
	| 'staged'
	| 'applied'
	| 'moved'
	| 'skipped'
	| 'failed'
	| 'burst-paused'
	| 'daily-cap';

/** 자동감시 활동 로그 항목 */
export interface WatchActivityLogEntry {
	/** 로그 고유 ID */
	id: string;
	/** 발생 시각 (Unix ms) */
	timestamp: number;
	/** 관련 규칙 ID */
	ruleId: string;
	/** 관련 규칙 이름 */
	ruleName: string;
	/** 대상 파일 경로 */
	path: string;
	/** 이동 후 경로 (이동된 경우) */
	targetPath?: string;
	/** 처리 상태 */
	status: WatchActivityStatus;
	/** 상세 설명 또는 오류 메시지 */
	detail?: string;
}
