// ─── Chat Messages ──────────────────────────────

export type MultiModalContent = 
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

export type AnthropicThinkingBlock =
	| { type: 'thinking'; thinking: string; signature: string }
	| { type: 'redacted_thinking'; data: string };

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | MultiModalContent[];
	tool_call_id?: string;
	name?: string;
	tool_calls?: ToolCall[];
	thoughtSignature?: string;
	/** Anthropic extended/adaptive thinking 다중 턴 도구 루프용 원형 블록 (signature 포함) */
	thinkingBlocks?: AnthropicThinkingBlock[];
}

// ─── Tool Calling ───────────────────────────────

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	thoughtSignature?: string;
}

// ─── Chat Options ───────────────────────────────

export interface PromptCachingOptions {
	/** 프롬프트 캐싱 활성화 여부 */
	enabled: boolean;
	/** 세션/대화 단위 캐시 라우팅 키 (OpenAI prompt_cache_key 및 Gemini Explicit 세션 식별용) */
	cacheKey?: string;
	/** Gemini Explicit Context Caching 활성화 여부 (기본 false, Opt-in) */
	geminiExplicit?: boolean;
	/** Gemini Explicit 캐시 TTL(초, 기본 300초) */
	geminiTtlSeconds?: number;
}

export type ReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high';

export interface ReasoningOptions {
	/** 추론 강도 ('auto' = 미전송, 모델 기본 동작 유지) */
	effort: ReasoningEffort;
	/** 선택적 수동 사고 토큰 예산 (0 또는 미지정 시 프리셋 사용 — Anthropic 3.7~4.6, Gemini 2.5 적용) */
	budgetTokens?: number;
}

export interface ChatOptions {
	model: string;
	temperature?: number;
	maxOutputTokens?: number;
	signal?: AbortSignal;
	tools?: ToolDefinition[];
	stop?: string[];
	ttftTimeoutMs?: number;
	interTokenTimeoutMs?: number;
	cwd?: string;
	/** 요청별 프롬프트 캐싱 제어 옵션 (단발성 호출에는 미전달) */
	promptCaching?: PromptCachingOptions;
	/** 요청별 추론/사고 강도 및 예산 제어 옵션 (Cloud 직접 API 채팅 전용) */
	reasoning?: ReasoningOptions;
}

// ─── Provider Interface ─────────────────────────

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	/** 캐시에서 재사용(읽기)된 입력 토큰 수 (0일 때는 생략) */
	cacheReadTokens?: number;
	/** 캐시에 새로 생성(쓰기)된 입력 토큰 수 (0일 때는 생략) */
	cacheCreationTokens?: number;
}

export interface ChatResponse {
	content: string;
	usage?: TokenUsage;
	toolCalls?: ToolCall[];
	finishReason?: string;
	/** Anthropic extended/adaptive thinking 응답 블록 (후속 도구 라운드 패스스루용) */
	thinkingBlocks?: AnthropicThinkingBlock[];
}

export interface ILLMProvider {
	readonly providerId: string;

	/** 연결 테스트 및 사용 가능한 모델 목록 반환 */
	listModels(): Promise<string[]>;

	/** 단일 응답 (non-streaming) */
	chat(messages: ChatMessage[], options: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResponse>;

	/** 스트리밍 응답 */
	stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }>;

	/** 임베딩 (벡터화) */
	embed(texts: string[], options: { model: string }): Promise<number[][]>;

	/** 리랭크 (문서 재정렬) - 전용 모델(API) 지원 시 선택적 구현 */
	rerank?(
		query: string,
		documents: string[],
		options: { model: string; topN?: number }
	): Promise<{ index: number; score: number }[]>;
}
