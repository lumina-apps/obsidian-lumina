/**
 * 마크다운 고아노트(Orphan Note) 감지·추천·구출·정리 도메인 타입 정의.
 */

/** 고아노트 판별 기준 모드 */
export type OrphanDetectionMode = 'isolated' | 'no-backlinks';

/** 링크 삽입 방향 ('from-orphan': 고아→추천, 'to-orphan': 추천→고아) */
export type OrphanLinkDirection = 'from-orphan' | 'to-orphan';

/** 고아노트 목록 정렬 기준 */
export type OrphanSortKey = 'mtime-desc' | 'mtime-asc' | 'name-asc' | 'size-asc';

/** 볼트 설정에 저장되는 고아노트 관리 기본 환경설정 */
export interface OrphanNotesPreferences {
	/** 고아 판별 기준 */
	mode: OrphanDetectionMode;
	/** 최근 수정 보호 기간(일). 0이면 보호 비활성화 */
	gracePeriodDays: number;
	/** .canvas 파일에서 참조되는 노트를 연결된 것으로 간주할지 여부 */
	includeCanvasRefs: boolean;
	/** 아카이브 이동 시 기본 대상 폴더 경로 */
	archiveFolder: string;
	/** 고아노트 목록에서 영구 제외(무시)한 파일 경로 목록 */
	ignoredPaths: string[];
	/** 스캔에서 제외할 폴더 경로 목록 */
	ignoredFolders: string[];
	/** 스캔에서 제외할 태그 목록 */
	ignoredTags: string[];
}

/** 고아노트 스캐너 실행 필터 설정 */
export interface OrphanFilterConfig {
	mode: OrphanDetectionMode;
	gracePeriodDays: number;
	includeCanvasRefs: boolean;
	emptyOnly: boolean;
	folderFilter: string;
	searchQuery: string;
	showIgnored: boolean;
	sortBy: OrphanSortKey;
	ignoredPaths: string[];
	ignoredFolders: string[];
	ignoredTags: string[];
	excludedPaths: string[];
}

/** 스캔으로 탐지된 단일 고아노트 항목 */
export interface OrphanNoteItem {
	/** 볼트 상대 파일 경로 */
	path: string;
	/** 확장자 제외 노트 제목 */
	basename: string;
	/** 상위 폴더 경로 (루트면 빈 문자열) */
	folder: string;
	/** 최종 수정 시각 (Unix ms) */
	mtime: number;
	/** 파일 크기 (bytes) */
	size: number;
	/** 들어오는 링크 수 (Canvas 참조 포함) */
	inlinkCount: number;
	/** 나가는 링크 수 */
	outlinkCount: number;
	/** 본문이 비어있는지 여부 */
	isEmpty: boolean;
	/** 사용자가 무시 목록에 추가했는지 여부 */
	isIgnored: boolean;
	/** 노트에 포함된 정규화된 태그 목록 */
	tags: string[];
}

/** 고아노트 연결 추천 후보 노트 */
export interface OrphanLinkSuggestion {
	/** 추천 노트 볼트 상대 경로 */
	path: string;
	/** 추천 노트 제목 */
	basename: string;
	/** 상위 폴더 경로 */
	folder: string;
	/** 0~1 정규화 유사도/연관도 점수 */
	score: number;
	/** 추천 근거 ('rag': 임베딩 벡터 기반, 'metadata': 키워드/태그/폴더 폴백) */
	reason: 'rag' | 'metadata';
	/** 추천 노트가 보유한 백링크 수 (허브/MOC 지표) */
	backlinkCount: number;
	/** 선택적 본문 미리보기 스니펫 */
	snippet?: string;
}

/** Pro AI 문맥 링크 삽입 제안(Diff 검토용) */
export interface OrphanAiLinkProposal {
	/** 원본 고아노트 경로 */
	orphanPath: string;
	/** 추천 대상 노트 경로 */
	targetPath: string;
	/** 삽입 방향 */
	direction: OrphanLinkDirection;
	/** 실제 수정될 파일 경로 */
	modifiedFilePath: string;
	/** 수정 전 원본 전체 텍스트 */
	beforeContent: string;
	/** 수정 후 제안 전체 텍스트 */
	afterContent: string;
	/** LLM 또는 폴백 삽입 사유 */
	reason: string;
	/** 소모된 LLM 토큰 수 */
	tokensUsed: number;
}
