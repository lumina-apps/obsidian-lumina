import type {
	EmbeddingConfig,
	LLMProviderConfig,
	PluginLanguage,
	RAGDataScope,
	RAGSyncMode,
	ResponseLanguage,
	SendKeyMode,
	SystemPromptPreset,
	McpServerConfig,
	QuickAction,
} from '../../shared/types/settings.types';

// ─── Section 1: Connections & Models ────────────────────────────────────────

export interface ConnectionsSettings {
	/** 플러그인 UI 언어 */
	language: PluginLanguage;
	/** 등록된 LLM 프로바이더 목록 */
	providers: LLMProviderConfig[];
	/** RAG 엔진 활성화 여부 (원클릭) */
	ragEnabled: boolean;
	/** 임베딩 모델 설정 */
	embedding: EmbeddingConfig;
	/** 사이드바 채팅에서 디폴트로 사용할 프로바이더 ID */
	defaultProviderId: string;
	/** 사이드바 채팅에서 디폴트로 사용할 모델 ID */
	defaultModelId: string;
	/** 퀵 액션 전용 프로바이더 ID */
	quickActionProviderId: string;
	/** 퀵 액션 전용 모델 ID */
	quickActionModelId: string;
}

// ─── Section 2: Chat & Prompt ────────────────────────────────────────────────

export interface ChatSettings {
	/** 시스템 프롬프트 프리셋 목록 */
	systemPrompts: SystemPromptPreset[];
	/** 현재 활성 시스템 프롬프트 ID */
	activeSystemPromptId: string;
	/** 채팅 기록 자동저장 여부 */
	autoSaveHistory: boolean;
	/** 채팅 기록 저장 경로 (autoSaveHistory=true 일 때) */
	historyPath: string;
	/** 메시지 전송 단축키 */
	sendKey: SendKeyMode;
	/** 커스텀 퀵 액션 프롬프트 목록 */
	quickActions: QuickAction[];
	inlineTrigger: string;

	// ── Advanced ──
	/** 대화 기억 제한 (턴 수, 0=토큰 기반 모드) */
	contextWindowTurns: number;
	/** 토큰 기반 제한 사용 여부 */
	useTokenLimit: boolean;
	/** 최대 컨텍스트 토큰 수 (useTokenLimit=true 일 때) */
	maxContextTokens: number;
	/** Temperature (0.0 ~ 2.0) */
	temperature: number;
	/** 최대 출력 토큰 */
	maxOutputTokens: number;
	/** 스트리밍 응답 여부 */
	streaming: boolean;
	/** 응답 언어 강제 지정 */
	responseLanguage: ResponseLanguage;
	/** 에이전트 활성화 여부 */
	agentEnabled: boolean;
	/** 에이전트 최대 실행 스텝 수 (무한 루프 방지) */
	agentMaxSteps: number;
}

// ─── Section 3: RAG & Context ────────────────────────────────────────────────

export interface RagSettings {
	/** 기본 RAG 데이터 범위 */
	dataScope: RAGDataScope;
	/** 채팅 시 현재 활성 노트 자동 포함 여부 */
	includeActiveNote: boolean;
	/** 인덱싱 포함 경로 목록 (비어있으면 전체) */
	includedPaths: string[];
	/** 인덱싱 제외 경로 목록 */
	excludedPaths: string[];

	// ── Advanced ──
	/** 청크 크기 (tokens) */
	chunkSize: number;
	/** 청크 겹침 크기 (tokens) */
	chunkOverlap: number;
	/** Top-K 검색 수 */
	topK: number;
	/** 최소 코사인 유사도 (0~1) — 이 값 미만의 청크는 검색 결과에서 제외 */
	minSimilarity: number;
	/** 인덱싱 동기화 방식 */
	syncMode: RAGSyncMode;
}

// ─── Section 4: Misc & Extensions ────────────────────────────────────────────

export interface MiscSettings {
	/** 우클릭 컨텍스트 메뉴에 "채팅으로 보내기" 항목 표시 여부 */
	contextMenuEnabled: boolean;
	/** 좌측 리본 아이콘 표시 여부 */
	showRibbonIcon: boolean;

	// ── Advanced ──
	/** 프론트매터 자동생성 여부 */
	autoFrontmatter: boolean;
	/** 프론트매터 저장 경로 (autoFrontmatter=true 일 때) */

	/** 디버그 모드 */
	debugMode: boolean;
	/** chatHistory 제외 경로 자동 마이그레이션 여부 */
	hasMigratedChatHistory: boolean;
}

// ─── Section 5: MCP (Model Context Protocol) ──────────────────────────────────

export interface McpSettings {
	/** 등록된 외부 MCP 서버 목록 */
	servers: McpServerConfig[];
	
	// ─── 내장 MCP 서버 설정 ───
	/** 내장 MCP 서버 활성화 여부 */
	serverEnabled: boolean;
	/** 내장 MCP 서버 포트 (기본: 3000) */
	serverPort: number;
	/** 외부 클라이언트 인증용 토큰 */
	serverAuthToken: string;

	// ─── 내장 MCP 서버 고급 제한 ───
	/** 읽기(Read) 도구 최대 반환 글자 수 (기본: 20000) */
	serverMaxReadChars: number;
	/** 검색(Search) 결과 스니펫 앞뒤 글자 수 (기본: 300) */
	serverSearchSnippetLength: number;
	/** 검색(Search) 최대 반환 결과 개수 (기본: 10) */
	serverSearchMaxResults: number;
	/** 추가(Append) 도구 한 번에 허용하는 최대 글자 수 (기본: 10000) */
	serverMaxAppendChars: number;

	/** MCP 클라이언트 도구를 LLM function calling에 주입할지 여부 */
	clientToolsEnabled: boolean;
}

// ─── Root Settings ────────────────────────────────────────────────────────────

export interface LuminaSettings {
	connections: ConnectionsSettings;
	chat: ChatSettings;
	rag: RagSettings;
	misc: MiscSettings;
	mcp: McpSettings;
}
