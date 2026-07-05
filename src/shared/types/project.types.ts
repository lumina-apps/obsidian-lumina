/**
 * project.types.ts
 *
 * 프로젝트 구분 기능에 사용되는 타입 정의.
 * 각 프로젝트는 RAG 인덱스 범위와 채팅 히스토리 저장 경로를 독립적으로 가진다.
 */

export interface ProjectConfig {
	/** 고유 식별자 (Default 프로젝트는 'default' 고정) */
	id: string;
	/** 사용자 지정 이름 (최대 30자) */
	name: string;
	/**
	 * RAG 인덱스 포함 경로 목록.
	 * 비어있으면 전체 vault = Default 동작 (rag.includedPaths 전역 설정 사용).
	 */
	ragIncludedPaths: string[];
	/**
	 * RAG 제외 경로 목록.
	 * 비어있으면 전역 rag.excludedPaths 사용.
	 */
	ragExcludedPaths: string[];
	/**
	 * 채팅 히스토리 저장 하위 폴더 이름.
	 * chat.historyPath 기준 상대 경로.
	 * 비어있으면 historyPath 루트 = Default 동작.
	 */
	historySubfolder: string;
	/**
	 * 이 프로젝트에서 새 채팅을 시작할 때 사용할 기본 공급자 ID.
	 * 빈 문자열일 경우 사용 가능한 첫 번째 모델로 폴백.
	 */
	defaultProviderId: string;
	/**
	 * 이 프로젝트에서 새 채팅을 시작할 때 사용할 기본 모델 ID.
	 */
	defaultModelId: string;
	/**
	 * 이 프로젝트에서 새 채팅을 시작할 때 사용할 시스템 프롬프트 ID.
	 * 빈 문자열일 경우 기본 시스템 프롬프트로 폴백.
	 */
	systemPromptId: string;
	/** 생성 타임스탬프 (ms) */
	createdAt: number;
}

export interface ProjectSettings {
	/** 프로젝트 목록 */
	list: ProjectConfig[];
	/** 현재 활성 프로젝트 ID (초기값: 'default') */
	activeProjectId: string;
}

/** Default 프로젝트의 고정 ID */
export const DEFAULT_PROJECT_ID = 'default';

/** Default 프로젝트 기본값 생성 헬퍼 */
export function createDefaultProject(): ProjectConfig {
	return {
		id: DEFAULT_PROJECT_ID,
		name: 'Default',
		ragIncludedPaths: [],
		ragExcludedPaths: ['chatHistory', 'backups', 'Templates', 'templates', '_templates', 'Attachments', 'attachments'],
		historySubfolder: '',
		defaultProviderId: '',
		defaultModelId: '',
		systemPromptId: '',
		createdAt: 0,
	};
}
