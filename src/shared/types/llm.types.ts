// ─── Chat Messages ────────────────────────────────────────────────────────────

export type MultiModalContent = 
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | MultiModalContent[];
	/** tool role 전용: tool call id */
	tool_call_id?: string;
	/** tool role 전용: 호출된 툴 이름 (Gemini 등 일부 API 필수) */
	name?: string;
	/** assistant role 전용: assistant가 요청한 tool call 목록 (Gemini/Anthropic에서 중요) */
	tool_calls?: ToolCall[];
	/** Gemini 전용: 추론 상태 서명 */
	thoughtSignature?: string;
}

// ─── Tool Calling ─────────────────────────────────────────────────────────────

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, { type: string; description: string }>;
		required?: string[];
	};
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	/** Gemini 전용: 추론 상태 서명 */
	thoughtSignature?: string;
}

// ─── Chat Options ─────────────────────────────────────────────────────────────

export interface ChatOptions {
	model: string;
	temperature?: number;
	maxOutputTokens?: number;
	/** 스트리밍 중단 시그널 */
	signal?: AbortSignal;
	/** MCP / function calling 도구 목록 */
	tools?: ToolDefinition[];
	/** 로컬 모델 stop 시퀀스 (텍스트 tool prompt 사용 시 비활성화 권장) */
	stop?: string[];
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface ChatResponse {
	content: string;
	usage?: TokenUsage;
	/** LLM이 tool call을 요청한 경우 */
	toolCalls?: ToolCall[];
	/** 모델이 생성을 완료한 원인 (예: 'length', 'max_tokens', 'MAX_TOKENS') */
	finishReason?: string;
}

export interface ILLMProvider {
	/** 설정에 등록된 프로바이더 ID */
	readonly providerId: string;

	/**
	 * 연결 테스트 및 사용 가능한 모델 목록 반환.
	 * 실패 시 Error throw.
	 */
	listModels(): Promise<string[]>;

	/**
	 * 단일 응답 (non-streaming) 또는 툴 루프 중 스트리밍.
	 */
	chat(messages: ChatMessage[], options: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResponse>;

	/**
	 * 스트리밍 응답.
	 * @param onChunk 청크가 도착할 때마다 호출 (delta text만 전달)
	 */
	stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }>;

	/**
	 * 임베딩 (벡터화)
	 * @param texts 임베딩할 텍스트 배열
	 * @param options 모델명 등 옵션
	 */
	embed(texts: string[], options: { model: string }): Promise<number[][]>;
}
