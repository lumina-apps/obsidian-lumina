/**
 * stream-accumulator.ts
 * OpenAI 호환 SSE 스트림 청크 처리와 상태 누적
 *
 * OpenAIProvider와 OpenAICompatProvider 양쪽에서 사용하며,
 * content 누적, tool call 누적, usage 추출, finishReason 추적,
 * 그리고 reasoning 모델(DeepSeek-R1 등)의 `<think>` 태그 래핑을 캡슐화합니다.
 */
import type { TokenUsage, ToolCall } from '../../shared/types/llm.types';
import type { OpenAIStreamChunk, OpenAIToolCallInfo } from './openai-types';
import { debugLogger } from '../../shared/debugLogger';

// ─── SSE Parsing ────────────────────────────────────────────────────────────

/**
 * 단일 SSE 라인을 파싱하여 `OpenAIStreamChunk`로 변환합니다.
 * 실패 시 null 반환 (debugLogger로 기록).
 */
export function parseSSEChunk(line: string): OpenAIStreamChunk | null {
	const cleanLine = line.trim();
	if (!cleanLine || !cleanLine.startsWith('data: ')) return null;
	const dataStr = cleanLine.slice(6);
	if (dataStr === '[DONE]') return null;

	try {
		return JSON.parse(dataStr) as OpenAIStreamChunk;
	} catch (e) {
		debugLogger.logError(
			'OpenAICompat Stream Parse',
			`Failed to parse line: "${cleanLine}". Error: ${e instanceof Error ? e.message : String(e)}`,
		);
		return null;
	}
}

// ─── Usage Mapping ──────────────────────────────────────────────────────────

/**
 * OpenAI API 응답의 usage 정보를 TokenUsage로 변환합니다.
 * 스트리밍 청크와 논스트리밍 응답 모두 동일 구조이므로 공통으로 사용합니다.
 */
export function mapOpenAIUsage(
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined,
): TokenUsage | undefined {
	if (!usage) return undefined;
	return {
		inputTokens: usage.prompt_tokens,
		outputTokens: usage.completion_tokens,
		totalTokens: usage.total_tokens,
	};
}

// ─── Tool Call Accumulation ─────────────────────────────────────────────────

/**
 * 스트리밍 델타에서 tool_calls를 누적 배열에 병합합니다.
 */
export function accumulateToolCalls(
	delta: NonNullable<OpenAIStreamChunk['choices']>[number]['delta'],
	accumulated: OpenAIToolCallInfo[],
): void {
	if (!delta?.tool_calls) return;

	for (const tc of delta.tool_calls) {
		const index = tc.index ?? 0;
		if (!accumulated[index]) {
			accumulated[index] = {
				id: tc.id || '',
				name: tc.function?.name || '',
				arguments: tc.function?.arguments || '',
			};
		} else {
			if (tc.id) accumulated[index].id = tc.id;
			if (tc.function?.name) accumulated[index].name = tc.function.name;
			if (tc.function?.arguments) accumulated[index].arguments += tc.function.arguments;
		}
	}
}

/**
 * 누적된 OpenAIToolCallInfo 배열을 ToolCall 배열로 변환합니다.
 * JSON.parse 실패 시 해당 tool call은 건너뜁니다.
 */
export function convertOpenAIToolCalls(accumulated: OpenAIToolCallInfo[]): ToolCall[] {
	const result: ToolCall[] = [];
	for (const tc of accumulated) {
		if (!tc) continue;
		try {
			result.push({
				id: tc.id || crypto.randomUUID(),
				name: tc.name || '',
				arguments: tc.arguments ? (JSON.parse(tc.arguments) as Record<string, unknown>) : {},
			});
		} catch {
			console.warn('Failed to parse tool call arguments:', tc.arguments);
		}
	}
	return result;
}

// ─── Reasoning Utilities ────────────────────────────────────────────────────

/**
 * Non-streaming 응답의 reasoning content를 `<think>...</think>` 태그로 래핑합니다.
 * reasoning이 없으면 content를 그대로 반환합니다.
 */
export function wrapReasoningContent(reasoning: string | undefined, content: string): string {
	if (!reasoning) return content;
	return `<think>\n${reasoning}\n</think>\n${content}`;
}

/**
 * reasoning content (예: DeepSeek-R1의 think 태그)를
 * `<think>...</think>` 태그로 래핑하기 위한 상태 머신입니다.
 */
export interface ReasoningState {
	/** 현재 think 블록 안에 있는지 여부 */
	isThinking: boolean;
}

export function createReasoningState(): ReasoningState {
	return { isThinking: false };
}

/**
 * reasoning delta가 들어왔을 때 `<think>` 태그를 열고,
 * reasoning이 끝나고 일반 content가 들어왔을 때 `</think>` 태그를 닫습니다.
 *
 * @returns onChunk에 전달할 추가 텍스트. 상태 변경 시 태그 문자열,
 *          reasoning 블록 내 content는 undefined를 반환하여 호출부에서
 *          displayText를 통해 직접 누적하도록 합니다.
 */
export function resolveReasoningTag(
	state: ReasoningState,
	displayText: string | undefined,
	isReasoning: boolean,
): string | undefined {
	// reasoning 블록 시작
	if (isReasoning && !state.isThinking) {
		state.isThinking = true;
		return '<think>\n';
	}
	// reasoning 블록 종료 (일반 content 시작)
	if (!isReasoning && state.isThinking) {
		state.isThinking = false;
		return '\n</think>\n';
	}
	// 블록 내에서 reasoning content 그대로 전달
	if (isReasoning && state.isThinking && displayText) {
		return undefined; // 호출부에서 displayText를 직접 누적 (중복 방지)
	}
	return undefined;
}

// ─── Stream Chunk Accumulator ───────────────────────────────────────────────

/** OpenAI Stream delta 타입 (openai-types에서 추출, non-nullable) */
type OpenAIDelta = NonNullable<NonNullable<OpenAIStreamChunk['choices']>[number]['delta']>;

export interface StreamChunkAccumulatorOptions {
	/** reasoning 모델 (DeepSeek-R1 등)의 `<think>` 태그 래핑 활성화 */
	enableReasoning?: boolean;
}

/**
 * OpenAI 호환 SSE 스트림 청크 처리와 상태 누적을 담당하는 클래스입니다.
 *
 * OpenAIProvider와 OpenAICompatProvider 양쪽에서 사용하며,
 * content 누적, tool call 누적, usage 추출, finishReason 추적,
 * 그리고 reasoning 모델의 `<think>` 태그 래핑을 캡슐화합니다.
 */
export class StreamChunkAccumulator {
	/** 누적된 텍스트 content */
	fullContent = '';
	/** 누적 중인 tool call 정보 */
	toolCalls: OpenAIToolCallInfo[] = [];
	/** 스트림에서 추출한 토큰 usage */
	usage: TokenUsage | undefined;
	/** 스트림 종료 사유 */
	finishReason: string | undefined;

	private reasoning: ReasoningState | undefined;
	private onChunk: ((text: string) => void) | undefined;

	constructor(onChunk?: (text: string) => void, options?: StreamChunkAccumulatorOptions) {
		this.onChunk = onChunk;
		if (options?.enableReasoning) {
			this.reasoning = createReasoningState();
		}
	}

	/**
	 * SSE 라인 한 줄을 파싱하여 누적 상태를 갱신합니다.
	 * @returns 청크가 정상 처리되었으면 true, 빈 라인/파싱 실패면 false
	 */
	processLine(line: string): boolean {
		const chunk = parseSSEChunk(line);
		if (!chunk) return false;

		const choice = chunk.choices?.[0];
		if (choice) {
			if (choice.finish_reason) {
				this.finishReason = choice.finish_reason;
			}
			if (choice.delta) {
				this.processDelta(choice.delta);
			}
		}

		const newUsage = mapOpenAIUsage(chunk.usage);
		if (newUsage) this.usage = newUsage;

		return true;
	}

	/**
	 * 스트림 종료 시 마무리 처리 (누락된 `</think>` 태그 닫기 등)
	 */
	finalize(): void {
		if (this.reasoning?.isThinking) {
			const closeTag = '\n</think>\n';
			this.fullContent += closeTag;
			this.onChunk?.(closeTag);
		}
	}

	/**
	 * 누적 결과를 반환합니다.
	 */
	getResult(): {
		content: string;
		toolCalls: ToolCall[];
		usage?: TokenUsage;
		finishReason?: string;
	} {
		const convertedToolCalls = convertOpenAIToolCalls(this.toolCalls);
		return {
			content: this.fullContent,
			toolCalls: convertedToolCalls,
			usage: this.usage,
			finishReason: this.finishReason,
		};
	}

	// ─── Private ──────────────────────────────────────────────────────────

	private processDelta(delta: OpenAIDelta): void {
		// reasoning 처리가 활성화되지 않은 경우 plain 로직으로 처리
		if (!this.reasoning) {
			this.processDeltaPlain(delta);
		} else {
			this.processDeltaWithReasoning(delta);
		}
		accumulateToolCalls(delta, this.toolCalls);
	}

	private processDeltaPlain(delta: OpenAIDelta): void {
		if (delta.content) {
			this.fullContent += delta.content;
			this.onChunk?.(delta.content);
		}
	}

	private processDeltaWithReasoning(delta: OpenAIDelta): void {
		const reasoningText = delta.reasoning_content ?? delta.reasoning ?? undefined;
		const isReasoning = reasoningText !== undefined && reasoningText.length > 0;

		const tagText = resolveReasoningTag(this.reasoning!, reasoningText, isReasoning);
		if (tagText !== undefined) {
			this.fullContent += tagText;
			this.onChunk?.(tagText);
		}

		// reasoning 컨텐츠는 resolveReasoningTag에서 undefined를 반환하므로,
		// displayText를 통해 직접 누적 (중복 방지)
		let displayText: string | undefined;
		if (isReasoning && this.reasoning!.isThinking) {
			displayText = reasoningText;
		} else if (!isReasoning && delta.content) {
			displayText = delta.content;
		}

		if (displayText) {
			this.fullContent += displayText;
			this.onChunk?.(displayText);
		}
	}
}