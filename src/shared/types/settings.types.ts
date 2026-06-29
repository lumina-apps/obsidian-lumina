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

export type McpTransportType = 'sse';

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

