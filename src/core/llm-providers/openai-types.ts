/**
 * openai-types.ts
 * OpenAI 호환 API의 공통 타입 정의
 *
 * OpenAI, Ollama, LM Studio, vLLM, DeepSeek, Groq 등
 * /v1/chat/completions 엔드포인트를 사용하는 모든 프로바이더에서 공유합니다.
 */

// ─── Tool Call (스트리밍 누적용) ─────────────────────────────────────────────

export interface OpenAIToolCallInfo {
	id?: string;
	name?: string;
	arguments: string;
}

// ─── Streaming Chunk ─────────────────────────────────────────────────────────

export interface OpenAIStreamChunk {
	choices?: Array<{
		delta?: {
			content?: string | null;
			/** DeepSeek-R1 등 reasoning model 전용 */
			reasoning_content?: string | null;
			/** 일부 모델의 reasoning 필드 (호환성) */
			reasoning?: string | null;
			tool_calls?: Array<{
				index: number;
				id?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

// ─── Non-Streaming Response ──────────────────────────────────────────────────

export interface OpenAIResponse {
	choices?: Array<{
		message?: {
			role?: string;
			content?: string | null;
			/** DeepSeek-R1 등 reasoning model 전용 */
			reasoning_content?: string | null;
			/** 일부 모델의 reasoning 필드 (호환성) */
			reasoning?: string | null;
			tool_calls?: Array<{
				id: string;
				type: 'function';
				function: {
					name: string;
					arguments: string;
				};
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}