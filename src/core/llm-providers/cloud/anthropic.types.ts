/**
 * anthropic.types.ts
 * Anthropic API 전용 타입 정의 및 상수
 */

// ─── Block ──────────────────────────────────────────────────────────────────

export interface AnthropicBlock {
	type?: string;
	id?: string;
	name?: string;
	input?: string;
	text?: string;
	/** thinking 블록 본문 */
	thinking?: string;
	/** thinking 블록 검증 서명 */
	signature?: string;
	/** redacted_thinking 블록 암호화 데이터 */
	data?: string;
}

// ─── Streaming Chunk ────────────────────────────────────────────────────────

export interface AnthropicUsagePayload {
	input_tokens?: number;
	output_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}

export interface AnthropicStreamChunk {
	type: string;
	message?: {
		usage?: AnthropicUsagePayload;
	};
	index?: number;
	content_block?: {
		type?: string;
		id?: string;
		name?: string;
		thinking?: string;
		signature?: string;
		data?: string;
	};
	delta?: {
		type?: string;
		text?: string;
		/** extended thinking 블록 전용 (thinking_delta 이벤트) */
		thinking?: string;
		/** extended thinking 블록 서명 (signature_delta 이벤트) */
		signature?: string;
		partial_json?: string;
		stop_reason?: string | null;
	};
	usage?: AnthropicUsagePayload;
	error?: {
		type?: string;
		message?: string;
	};
}

// ─── Non-Streaming Response ─────────────────────────────────────────────────

export interface AnthropicResponse {
	content?: Array<{
		type: string;
		text?: string;
		thinking?: string;
		signature?: string;
		data?: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	}>;
	usage?: AnthropicUsagePayload;
	stop_reason?: string | null;
}

// ─── Models ─────────────────────────────────────────────────────────────────

/** Anthropic 공식 지원 모델 목록 (최신순) */
export const ANTHROPIC_MODELS: readonly string[] = [
	'claude-opus-4-5',
	'claude-sonnet-4-5',
	'claude-haiku-3-5',
	'claude-3-opus-latest',
	'claude-3-5-sonnet-latest',
	'claude-3-5-haiku-latest',
	'claude-3-haiku-20240307',
];