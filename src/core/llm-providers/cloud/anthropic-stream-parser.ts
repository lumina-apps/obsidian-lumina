/**
 * anthropic-stream-parser.ts
 * Anthropic API 스트림 응답 파싱 및 non-streaming 응답 변환
 */
import type { TokenUsage, ToolCall } from '../../../shared/types/llm.types';
import type { AnthropicBlock, AnthropicStreamChunk, AnthropicResponse } from './anthropic.types';

// ─── Stream Accumulator ─────────────────────────────────────────────────────

/**
 * SSE 라인을 한 줄씩 받아 Anthropic 스트리밍 응답을 누적하는 상태 머신입니다.
 * `readStreamLines` 콜백 내에서 `processLine()`을 호출하여 사용합니다.
 */
export class AnthropicStreamAccumulator {
	private fullContent = '';
	private readonly accumulatedBlocks: AnthropicBlock[] = [];
	private usage: TokenUsage | undefined;
	private finishReason: string | undefined;
	private onChunk: ((text: string) => void) | undefined;

	constructor(onChunk?: (text: string) => void) {
		this.onChunk = onChunk;
	}

	/** SSE 라인 한 줄을 처리합니다 */
	processLine(line: string): void {
		const cleanLine = line.trim();
		if (!cleanLine) return;

		if (!cleanLine.startsWith('data: ')) return;
		const dataStr = cleanLine.slice(6);

		try {
			const chunk = JSON.parse(dataStr) as AnthropicStreamChunk;
			this.processChunk(chunk);
		} catch {
			// ignore parse errors
		}
	}

	/** 누적된 결과를 반환합니다 */
	getResult(): {
		fullContent: string;
		toolCalls: ToolCall[];
		usage?: TokenUsage;
		finishReason?: string;
	} {
		const toolCalls = this.extractToolCalls();
		return {
			fullContent: this.fullContent,
			toolCalls,
			usage: this.usage,
			finishReason: this.finishReason,
		};
	}

	// ─── Private ──────────────────────────────────────────────────────────

	private processChunk(chunk: AnthropicStreamChunk): void {
		if (chunk.type === 'message_start' && chunk.message?.usage) {
			this.usage = {
				inputTokens: chunk.message.usage.input_tokens || 0,
				outputTokens: chunk.message.usage.output_tokens || 0,
				totalTokens: (chunk.message.usage.input_tokens || 0) + (chunk.message.usage.output_tokens || 0),
			};
		}
		else if (chunk.type === 'content_block_start') {
			const index = chunk.index ?? 0;
			this.accumulatedBlocks[index] = {
				type: chunk.content_block?.type,
				id: chunk.content_block?.id || '',
				name: chunk.content_block?.name || '',
				input: '',
				text: '',
			};
		}
		else if (chunk.type === 'content_block_delta') {
			const index = chunk.index ?? 0;
			const block = this.accumulatedBlocks[index];
			if (block) {
				if (chunk.delta?.type === 'text_delta' && chunk.delta.text) {
					block.text = (block.text || '') + chunk.delta.text;
					this.fullContent += chunk.delta.text;
					this.onChunk?.(chunk.delta.text);
				}
				else if (chunk.delta?.type === 'input_json_delta' && chunk.delta.partial_json) {
					block.input = (block.input || '') + chunk.delta.partial_json;
				}
			}
		}
		else if (chunk.type === 'message_delta') {
			if (chunk.delta?.stop_reason) {
				this.finishReason = chunk.delta.stop_reason;
			}
			if (chunk.usage && this.usage) {
				this.usage.outputTokens = chunk.usage.output_tokens || this.usage.outputTokens;
				this.usage.totalTokens = this.usage.inputTokens + this.usage.outputTokens;
			}
		}
	}

	private extractToolCalls(): ToolCall[] {
		const toolCalls: ToolCall[] = [];
		for (const block of this.accumulatedBlocks) {
			if (block && block.type === 'tool_use') {
				try {
					toolCalls.push({
						id: block.id || crypto.randomUUID(),
						name: block.name || '',
						arguments: block.input ? JSON.parse(block.input) as Record<string, unknown> : {},
					});
				} catch {
					console.warn('Failed to parse Anthropic tool arguments:', block.input);
				}
			}
		}
		return toolCalls;
	}
}

// ─── Non-Streaming Response Parser ──────────────────────────────────────────

/**
 * Anthropic non-streaming 응답을 파싱하여 content, toolCalls, usage, finishReason을 반환합니다.
 * 응답이 비어 있으면 Error를 throw합니다.
 */
export function parseAnthropicNonStreamResponse(rawBody: string, data: AnthropicResponse): {
	fullContent: string;
	toolCalls: ToolCall[];
	usage?: TokenUsage;
	finishReason?: string;
} {
	if (!data.content) {
		throw new Error(`Anthropic API returned an empty response. Response: ${rawBody}`);
	}

	let fullContent = '';
	const toolCalls: ToolCall[] = [];

	for (const block of data.content) {
		if (block.type === 'text') {
			fullContent += block.text || '';
		} else if (block.type === 'tool_use') {
			toolCalls.push({
				id: block.id || crypto.randomUUID(),
				name: block.name || '',
				arguments: block.input || {},
			});
		}
	}

	let usage: TokenUsage | undefined;
	if (data.usage) {
		usage = {
			inputTokens: data.usage.input_tokens || 0,
			outputTokens: data.usage.output_tokens || 0,
			totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
		};
	}

	return {
		fullContent,
		toolCalls,
		usage,
		finishReason: data.stop_reason || undefined,
	};
}