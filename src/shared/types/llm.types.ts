// ─── Chat Messages ──────────────────────────────

export type MultiModalContent = 
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | MultiModalContent[];
	tool_call_id?: string;
	name?: string;
	tool_calls?: ToolCall[];
	thoughtSignature?: string;
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

export interface ChatOptions {
	model: string;
	temperature?: number;
	maxOutputTokens?: number;
	signal?: AbortSignal;
	tools?: ToolDefinition[];
	stop?: string[];
}

// ─── Provider Interface ─────────────────────────

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface ChatResponse {
	content: string;
	usage?: TokenUsage;
	toolCalls?: ToolCall[];
	finishReason?: string;
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
}
