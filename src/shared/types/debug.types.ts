// ─── Log Entry Types ──────────────────────────────────────────────────────────

export type DebugLogType = 'llm-request' | 'llm-response' | 'rag' | 'system' | 'error' | 'mcp';

/** 모든 로그 엔트리의 공통 기반 */
export interface BaseLogEntry {
	id: string;
	type: DebugLogType;
	timestamp: number; // Date.now()
}

// ─── LLM Request ─────────────────────────────────────────────────────────────

export interface LLMRequestLog extends BaseLogEntry {
	type: 'llm-request';
	/** 프로바이더 타입 (anthropic, openai 등) */
	provider: string;
	/** 모델 식별자 */
	model: string;
	/** Temperature */
	temperature: number;
	/** 최대 출력 토큰 */
	maxTokens: number;
	/** Top-P (지원하는 경우) */
	topP?: number;
	/** 스트리밍 여부 */
	stream: boolean;
	/** 시스템 프롬프트 전문 */
	systemPrompt: string;
	/** messages 배열 (role + content) */
	messages: Array<{ role: string; content: string }>;
	/** RAG 모드일 때 주입된 청크 목록 */
	ragChunks?: RagChunkMeta[];
	/** 추정 입력 토큰 수 (사전 계산값, 없으면 undefined) */
	estimatedInputTokens?: number;
}

// ─── LLM Response ────────────────────────────────────────────────────────────

export interface LLMResponseLog extends BaseLogEntry {
	type: 'llm-response';
	/** 대응하는 요청의 ID */
	requestId: string;
	/** 모델 식별자 */
	model: string;
	/** 응답 전문 */
	content: string;
	/** 소요 시간 (ms) */
	durationMs: number;
	/** API 응답의 usage 필드 */
	usage?: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	/** stop_reason 등 API 원본 메타 */
	stopReason?: string;
}

// ─── RAG Search ──────────────────────────────────────────────────────────────

export interface RagChunkMeta {
	/** 소스 파일명 (볼트 상대경로) */
	filePath: string;
	/** 유사도 점수 (0~1) */
	score: number;
	/** 청크 내용 미리보기 (앞 200자) */
	preview: string;
	/** 청크 전문 */
	fullContent: string;
}

export interface RAGSearchLog extends BaseLogEntry {
	type: 'rag';
	/** 검색에 사용된 쿼리 */
	query: string;
	/** top-K 설정값 */
	topK: number;
	/** 검색 결과 청크 목록 */
	chunks: RagChunkMeta[];
	/** 검색 소요 시간 (ms) */
	durationMs: number;
}

// ─── System / Error ───────────────────────────────────────────────────────────

export interface SystemLog extends BaseLogEntry {
	type: 'system';
	/** 이벤트 종류 (예: 'indexing-start', 'indexing-done', 'worker-init') */
	event: string;
	/** 사람이 읽을 수 있는 메시지 */
	message: string;
	/** 추가 메타데이터 (옵션) */
	meta?: Record<string, unknown>;
}

export interface ErrorLog extends BaseLogEntry {
	type: 'error';
	/** 에러가 발생한 도메인 (llm, rag, system 등) */
	domain: string;
	/** 에러 메시지 */
	message: string;
	/** 스택 트레이스 */
	stack?: string;
}

// ─── MCP ──────────────────────────────────────────────────────────────────────

export interface MCPLog extends BaseLogEntry {
	type: 'mcp';
	/** 액션 혹은 분류 (예: '툴 수집', '툴 실행', '파싱' 등) */
	action: string;
	/** 메시지 내용 */
	message: string;
	/** 추가 데이터 (JSON 형태로 기록됨) */
	data?: any;
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type DebugLogEntry = LLMRequestLog | LLMResponseLog | RAGSearchLog | SystemLog | ErrorLog | MCPLog;
