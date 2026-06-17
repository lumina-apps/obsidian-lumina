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
}

// ─── Streaming Chunk ────────────────────────────────────────────────────────

export interface AnthropicStreamChunk {
	type: string;
	message?: {
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
		};
	};
	index?: number;
	content_block?: {
		type?: string;
		id?: string;
		name?: string;
	};
	delta?: {
		type?: string;
		text?: string;
		partial_json?: string;
		stop_reason?: string | null;
	};
	usage?: {
		output_tokens?: number;
	};
}

// ─── Non-Streaming Response ─────────────────────────────────────────────────

export interface AnthropicResponse {
	content?: Array<{
		type: string;
		text?: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	}>;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
	};
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