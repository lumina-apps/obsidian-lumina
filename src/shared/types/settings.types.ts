// ─── LLM Provider ─────────────────────────────────

export type ProviderType =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'xai'
	| 'deepseek'
	| 'groq'
	| 'openrouter'
	| 'togetherai'
	| 'kimi'
	| 'mistral'
	| 'ollama'
	| 'lmstudio'
	| 'vllm'
	| 'llamacpp'
	| 'custom'
	| 'cli-claude-code'
	| 'cli-codex'
	| 'cli-opencode'
	| 'cli-antigravity';

export const PROVIDER_LABELS: Record<ProviderType, string> = {
	openai: 'OpenAI (GPT)',
	anthropic: 'Anthropic (Claude)',
	google: 'Google (Gemini)',
	xai: 'xAI (Grok)',
	deepseek: 'DeepSeek',
	groq: 'Groq',
	openrouter: 'OpenRouter',
	togetherai: 'Together AI',
	kimi: 'Kimi (Moonshot)',
	mistral: 'Mistral',
	ollama: 'Ollama',
	lmstudio: 'LM Studio',
	vllm: 'vLLM',
	llamacpp: 'llama.cpp',
	custom: 'Custom (OpenAI Compatible)',
	'cli-claude-code': 'Claude Code (CLI)',
	'cli-codex': 'Codex (CLI)',
	'cli-opencode': 'OpenCode (CLI)',
	'cli-antigravity': 'Antigravity (CLI)',
};

export type ProviderCategory = 'cloud' | 'aggregator' | 'local' | 'custom' | 'cli';

export const PROVIDER_CATEGORIES: Record<ProviderType, ProviderCategory> = {
	openai: 'cloud',
	anthropic: 'cloud',
	google: 'cloud',
	xai: 'cloud',
	deepseek: 'cloud',
	groq: 'cloud',
	openrouter: 'aggregator',
	togetherai: 'aggregator',
	kimi: 'cloud',
	mistral: 'cloud',
	ollama: 'local',
	lmstudio: 'local',
	vllm: 'local',
	llamacpp: 'local',
	custom: 'custom',
	'cli-claude-code': 'cli',
	'cli-codex': 'cli',
	'cli-opencode': 'cli',
	'cli-antigravity': 'cli',
};

/** vision/image_url 미지원 provider 목록 */
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
	kimi: 'https://api.moonshot.ai',
	mistral: 'https://api.mistral.ai',
	ollama: 'http://localhost:11434',
	lmstudio: 'http://localhost:1234',
	vllm: 'http://localhost:8000',
	llamacpp: 'http://localhost:8080',
};

export interface LLMProviderConfig {
	id: string;
	type: ProviderType;
	credential: string;
	baseUrl?: string;
	availableModels: string[];
	isVerified: boolean;
	/** CLI 에이전트 전용: 실행 파일 경로 */
	binaryPath?: string;
	/** CLI 에이전트 전용: 도구 자동 승인 */
	autoApprove?: boolean;
	/** CLI 에이전트 전용: 추가 CLI 인자 */
	extraArgs?: string[];
	/** CLI 에이전트 전용: 환경변수 */
	env?: Record<string, string>;
	/** CLI 에이전트 전용: 타임아웃 (초) */
	timeoutSeconds?: number;
}

export interface FavoriteModel {
	providerId: string;
	modelId: string;
}

// ─── Embedding ────────────────────────────────────

export type EmbeddingMode = 'auto' | 'custom';

export interface EmbeddingConfig {
	mode: EmbeddingMode;
	providerId: string;
	modelId: string;
}

// ─── Chat ─────────────────────────────────────────

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

// ─── RAG ──────────────────────────────────────────

export type RAGDataScope = 'vault' | 'active-note' | 'manual';
export type RAGSyncMode = 'watch' | 'on-start' | 'manual';

// ─── Plugin Language ──────────────────────────────

export type PluginLanguage = 'en' | 'ko' | 'ja' | 'zh' | 'zh-tw' | 'es' | 'pt' | 'de' | 'fr' | 'ru' | 'it' | 'system';

// ─── MCP ──────────────────────────────────────────

export type McpTransportType = 'sse' | 'streamable-http';

export interface McpSettings {
	servers: McpServerConfig[];
	serverEnabled: boolean;
	serverPort: number;
	serverAuthToken: string;
	serverMaxReadChars: number;
	serverSearchSnippetLength: number;
	serverSearchMaxResults: number;
	serverMaxAppendChars: number;
	clientToolsEnabled: boolean;
	serverEnableShellCommands: boolean;
	agentRespectRagExclusions: boolean;
	syncCliMcp?: boolean;
}

export interface McpServerConfig {
	id: string;
	name: string;
	transport: McpTransportType;
	url?: string;
	authToken?: string;
	enabled: boolean;
	status: 'disconnected' | 'connecting' | 'connected' | 'error';
}

// ─── Web Search ───────────────────────────────────

export type WebSearchProviderType = 'tavily' | 'brave' | 'searxng' | 'exa' | 'google' | 'serpapi';

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProviderType, string> = {
	tavily: 'Tavily Search',
	brave: 'Brave Search',
	searxng: 'SearXNG (Local/Self-hosted)',
	exa: 'Exa (Semantic Search)',
	google: 'Google Custom Search',
	serpapi: 'SerpApi',
};

export interface WebSearchProviderConfig {
	type: WebSearchProviderType;
	apiKey?: string;
	baseUrl?: string;
	googleSearchEngineId?: string; // Only for Google Custom Search (CX)
}

/** CLI 에이전트 프로바이더 여부를 판별합니다. */
export function isCliProvider(type: ProviderType): boolean {
	return PROVIDER_CATEGORIES[type] === 'cli';
}

export const DEFAULT_CLI_BINARIES: Partial<Record<ProviderType, string>> = {
	'cli-claude-code': 'claude',
	'cli-codex': 'codex',
	'cli-opencode': 'opencode',
	'cli-antigravity': 'agy',
};

