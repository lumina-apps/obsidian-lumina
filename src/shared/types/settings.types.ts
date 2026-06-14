// ─── LLM Provider Types ────────────────────────────────────────────────────

export type ProviderType =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'xai'
	| 'deepseek'
	| 'groq'
	| 'openrouter'
	| 'togetherai'
	| 'ollama'
	| 'lmstudio'
	| 'vllm'
	| 'llamacpp'
	| 'custom';

export const PROVIDER_LABELS: Record<ProviderType, string> = {
	openai: 'OpenAI (GPT)',
	anthropic: 'Anthropic (Claude)',
	google: 'Google (Gemini)',
	xai: 'xAI (Grok)',
	deepseek: 'DeepSeek',
	groq: 'Groq',
	openrouter: 'OpenRouter',
	togetherai: 'Together AI',
	ollama: 'Ollama',
	lmstudio: 'LM Studio',
	vllm: 'vLLM',
	llamacpp: 'llama.cpp',
	custom: 'Custom (OpenAI Compatible)',
};

export type ProviderCategory = 'cloud' | 'aggregator' | 'local' | 'custom';

export const PROVIDER_CATEGORIES: Record<ProviderType, ProviderCategory> = {
	openai: 'cloud',
	anthropic: 'cloud',
	google: 'cloud',
	xai: 'cloud',
	deepseek: 'cloud',
	groq: 'cloud',
	openrouter: 'aggregator',
	togetherai: 'aggregator',
	ollama: 'local',
	lmstudio: 'local',
	vllm: 'local',
	llamacpp: 'local',
	custom: 'custom',
};

/**
 * image_url 멀티모달 콘텐츠를 지원하지 않는 프로바이더 타입 목록.
 * 이 목록에 포함된 프로바이더는 이미지 첨부 시 오류가 발생합니다.
 */
export const VISION_UNSUPPORTED_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
	'deepseek',
	'groq',
]);

export const PROVIDER_BASE_URLS: Partial<Record<ProviderType, string>> = {
	xai: 'https://api.x.ai',
	deepseek: 'https://api.deepseek.com',
	groq: 'https://api.groq.com/openai',
	openrouter: 'https://openrouter.ai/api',
	togetherai: 'https://api.together.xyz',
	ollama: 'http://localhost:11434',
	lmstudio: 'http://localhost:1234',
	vllm: 'http://localhost:8000',
	llamacpp: 'http://localhost:8080',
};

export interface LLMProviderConfig {
	/** 고유 ID (uuid) */
	id: string;
	/** 드롭다운에서 선택한 프로바이더 타입 */
	type: ProviderType;
	/** 클라우드: API Key / 커스텀: (선택적) API Key */
	credential: string;
	/** 로컬/커스텀/API Key가 아닌 고정된 클라우드 모델의 endpoint URL */
	baseUrl?: string;
	/** 사용 가능한 모델 목록 (테스트 성공 후 채워짐) */
	availableModels: string[];
	/** 연결 테스트 통과 여부 */
	isVerified: boolean;
}

// ─── Embedding Types ────────────────────────────────────────────────────────

export type EmbeddingMode = 'auto' | 'custom';

export interface EmbeddingConfig {
	/** 'auto': 로컬 transformers.js 내장 모델 / 'custom': 프로바이더 모델 직접 지정 */
	mode: EmbeddingMode;
	/** custom 모드일 때 사용할 프로바이더 ID */
	providerId: string;
	/** custom 모드일 때 사용할 모델 ID */
	modelId: string;
}

// ─── Chat Types ─────────────────────────────────────────────────────────────

export type SendKeyMode = 'enter' | 'ctrl_enter';
export type ResponseLanguage = 'auto' | 'ko' | 'en' | 'ja' | 'zh' | 'fr' | 'de' | 'es';

export interface SystemPromptPreset {
	id: string;
	name: string;
	content: string;
}

export type QuickActionType = 'replace' | 'append' | 'chat';

export interface QuickAction {
	id: string;
	name: string;
	prompt: string;
	actionType: QuickActionType;
}

// ─── RAG Types ──────────────────────────────────────────────────────────────

export type RAGDataScope = 'vault' | 'active-note' | 'manual';
export type RAGSyncMode = 'watch' | 'on-start' | 'manual';

// ─── Plugin Language ─────────────────────────────────────────────────────────

export type PluginLanguage = 'en' | 'ko' | 'ja' | 'zh' | 'zh-tw' | 'es' | 'pt' | 'de' | 'fr' | 'ru' | 'it' | 'system';

// ─── MCP Types ──────────────────────────────────────────────────────────────

export type McpTransportType = 'sse';

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

export interface McpServerConfig {
	/** 고유 ID (uuid) */
	id: string;
	/** 서버 이름 */
	name: string;
	/** 전송 방식 */
	transport: McpTransportType;

	/** sse 모드: 원격 서버 URL */
	url?: string;
	/** sse 모드: 인증 토큰 (내장 MCP 서버 연결 시 필요) */
	authToken?: string;
	/** 활성화 여부 (true면 채팅에 도구 주입됨) */
	enabled: boolean;
	/** 서버 상태 표시용 */
	status: 'disconnected' | 'connecting' | 'connected' | 'error';
}
