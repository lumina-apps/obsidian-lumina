import type { ChatRagSource, RagPipelineStep, UIChatMessage } from './chat.types';
import type { TokenUsage } from './llm.types';

/** 비교 레이아웃 모드 (일반 나란히 비교 / 블라인드 아레나) */
export type SplitLayoutMode = 'side-by-side' | 'blind';

/** 멀티턴 컨텍스트 유지 전략 (슬롯별 독립 맥락 / 채택 답변 기준 공유 맥락) */
export type SplitContextMode = 'independent' | 'winner';

/** 개별 모델 슬롯의 응답 실행 상태 */
export type SplitSlotStatus = 'idle' | 'waiting' | 'streaming' | 'done' | 'aborted' | 'error';

/** 비교 대상 모델 슬롯 설정 */
export interface SplitSlotConfig {
	/** 슬롯 고유 ID */
	slotId: string;
	/** 슬롯 알파벳 레이블 (A, B, C, D) */
	label: string;
	/** 프로바이더 ID */
	providerId: string;
	/** 모델 ID */
	modelId: string;
	/** 슬롯별 개별 Temperature 오버라이드 (미지정 시 전역 설정 사용) */
	temperatureOverride?: number;
}

/** 슬롯 응답 성능 메트릭 */
export interface SplitResponseMetrics {
	/** 요청 시작 시각 (Unix ms) */
	startedAt: number;
	/** 첫 토큰 수신 시각 (Unix ms) */
	firstTokenAt?: number;
	/** 응답 종료 시각 (Unix ms) */
	finishedAt?: number;
	/** 전체 소요 시간 (ms) */
	durationMs?: number;
	/** 첫 토큰 응답 지연 시간 TTFT (ms) */
	ttftMs?: number;
	/** 초당 생성 토큰 수 (tokens/sec) */
	tokensPerSecond?: number;
}

/** 단일 라운드 내 특정 슬롯의 응답 상태 및 결과 */
export interface SplitSlotResponse {
	/** 슬롯 고유 ID */
	slotId: string;
	/** 실행 시점 프로바이더 ID 스냅샷 */
	providerId: string;
	/** 실행 시점 모델 ID 스냅샷 */
	modelId: string;
	/** 응답 진행 상태 */
	status: SplitSlotStatus;
	/** 누적된 응답 본문 */
	content: string;
	/** 추출된 사고 과정 (<think> 등) */
	thinking?: string;
	/** 오류 발생 시 사용자 표시용 에러 메시지 */
	errorMessage?: string;
	/** 토큰 사용량 */
	tokenUsage?: TokenUsage;
	/** 실행 성능 메트릭 */
	metrics: SplitResponseMetrics;
	/** 출력 토큰 한도 도달 여부 */
	hasTokenLimitBeenHit?: boolean;
}

/** 라운드별 우승 선택 결과 (특정 슬롯 ID, 무승부, 둘 다 별로, 미선택) */
export type SplitWinnerChoice = string | 'tie' | 'both_bad' | null;

/** 비교 대화의 1개 라운드(Turn) */
export interface SplitTurn {
	/** 라운드 고유 ID */
	id: string;
	/** 사용자가 전송한 공통 질문 메시지 */
	userMessage: UIChatMessage;
	/** 공유 RAG 파이프라인 진행 단계 */
	ragStep: RagPipelineStep;
	/** 공유 RAG 참조 문서 출처 */
	ragSources?: ChatRagSource[];
	/** 슬롯 ID별 응답 맵 */
	responses: Record<string, SplitSlotResponse>;
	/** 사용자가 채택/투표한 승자 선택 */
	winnerSlotId?: SplitWinnerChoice;
	/** Blind 모드에서 실제 모델명 공개 여부 */
	isRevealed: boolean;
	/** Blind 모드에서 해당 턴 생성 시점의 랜덤 슬롯 표시 순서 */
	blindOrder?: string[];
}

/** 영속화되는 Split 비교 세션 */
export interface SplitChatSession {
	/** 세션 고유 ID */
	id: string;
	/** 일반 채팅 세션과 구분하기 위한 세션 타입 식별자 */
	sessionType: 'split';
	/** 세션 제목 */
	title: string;
	/** 참여 모델 슬롯 목록 */
	slots: SplitSlotConfig[];
	/** 대화 라운드 목록 */
	turns: SplitTurn[];
	/** 레이아웃 모드 */
	mode: SplitLayoutMode;
	/** 멀티턴 컨텍스트 전략 */
	contextMode: SplitContextMode;
	/** 생성 시각 (Unix ms) */
	createdAt: number;
	/** 수정 시각 (Unix ms) */
	updatedAt: number;
}

/** 히스토리 목록 표시용 요약 메타데이터 */
export interface SplitSessionSummary {
	/** 세션 고유 ID */
	id: string;
	/** 세션 제목 */
	title: string;
	/** 생성 시각 (Unix ms) */
	createdAt: number;
	/** 수정 시각 (Unix ms) */
	updatedAt: number;
	/** 레이아웃 모드 */
	mode: SplitLayoutMode;
	/** 총 질문 라운드 수 */
	turnCount: number;
	/** 참여 모델 레이블 목록 */
	modelLabels: string[];
	/** 채택된 우승 답변 존재 여부 */
	hasWinner: boolean;
}

/** 사용자 설정에 선택적으로 저장되는 Split 선호 상태 */
export interface SplitChatPreferences {
	/** 마지막으로 사용한 모델 슬롯 조합 */
	lastSlots?: Array<{ providerId: string; modelId: string; temperatureOverride?: number }>;
	/** 마지막 레이아웃 모드 */
	mode?: SplitLayoutMode;
	/** 마지막 멀티턴 컨텍스트 전략 */
	contextMode?: SplitContextMode;
}
