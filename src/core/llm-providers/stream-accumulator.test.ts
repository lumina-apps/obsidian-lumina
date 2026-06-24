/**
 * stream-accumulator.test.ts
 * Vitest 테스트: LLM 스트리밍 응답 누적 로직 검증
 */
import { describe, it, expect, vi } from 'vitest';

// ── Obsidian 의존성 모킹 ──
vi.mock('../../shared/debugLogger', () => ({
	debugLogger: {
		logError: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
	},
}));

import {
	parseSSEChunk,
	mapOpenAIUsage,
	accumulateToolCalls,
	convertOpenAIToolCalls,
	wrapReasoningContent,
	resolveReasoningTag,
	createReasoningState,
	StreamChunkAccumulator,
} from './stream-accumulator';
import type { OpenAIToolCallInfo } from './openai-types';

// ── parseSSEChunk ──

describe('parseSSEChunk', () => {
	it('정상적인 SSE 청크를 파싱한다', () => {
		const line = 'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}';
		const result = parseSSEChunk(line);
		expect(result).not.toBeNull();
		expect(result!.choices?.[0]?.delta?.content).toBe('Hello');
	});

	it('[DONE] 라인은 null을 반환한다', () => {
		const result = parseSSEChunk('data: [DONE]');
		expect(result).toBeNull();
	});

	it('data: 접두사가 없으면 null을 반환한다', () => {
		const result = parseSSEChunk('{"some":"json"}');
		expect(result).toBeNull();
	});

	it('빈 문자열은 null을 반환한다', () => {
		const result = parseSSEChunk('');
		expect(result).toBeNull();
	});

	it('공백만 있는 문자열은 null을 반환한다', () => {
		const result = parseSSEChunk('   ');
		expect(result).toBeNull();
	});

	it('잘못된 JSON은 null을 반환한다', () => {
		const result = parseSSEChunk('data: {invalid json');
		expect(result).toBeNull();
	});
});

// ── mapOpenAIUsage ──

describe('mapOpenAIUsage', () => {
	it('OpenAI usage 정보를 TokenUsage로 변환한다', () => {
		const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
		const result = mapOpenAIUsage(usage);
		expect(result).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
	});

	it('undefined 입력 시 undefined를 반환한다', () => {
		expect(mapOpenAIUsage(undefined)).toBeUndefined();
	});
});

// ── accumulateToolCalls ──

describe('accumulateToolCalls', () => {
	it('tool_calls가 없는 delta는 아무 작업도 하지 않는다', () => {
		const accumulated: OpenAIToolCallInfo[] = [];
		accumulateToolCalls({}, accumulated);
		expect(accumulated).toHaveLength(0);
	});

	it('단일 tool call을 누적한다', () => {
		const accumulated: OpenAIToolCallInfo[] = [];
		accumulateToolCalls(
			{ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"Seoul"}' } }] },
			accumulated,
		);
		expect(accumulated[0].id).toBe('call_1');
		expect(accumulated[0].name).toBe('get_weather');
		expect(accumulated[0].arguments).toBe('{"city":"Seoul"}');
	});

	it('스트리밍으로 arguments를 점진적으로 누적한다', () => {
		const accumulated: OpenAIToolCallInfo[] = [];
		accumulateToolCalls(
			{ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"ci' } }] },
			accumulated,
		);
		accumulateToolCalls(
			{ tool_calls: [{ index: 0, function: { arguments: 'ty":"Seoul"}' } }] },
			accumulated,
		);
		expect(accumulated[0].arguments).toBe('{"city":"Seoul"}');
	});
});

// ── convertOpenAIToolCalls ──

describe('convertOpenAIToolCalls', () => {
	it('ToolCall 배열로 변환한다 (JSON.parse)', () => {
		const result = convertOpenAIToolCalls([
			{ id: 'call_1', name: 'get_weather', arguments: '{"city":"Seoul"}' },
		]);
		expect(result).toHaveLength(1);
		expect(result[0].arguments).toEqual({ city: 'Seoul' });
	});

	it('빈 배열은 빈 배열을 반환한다', () => {
		expect(convertOpenAIToolCalls([])).toEqual([]);
	});

	it('잘못된 JSON은 건너뛴다', () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = convertOpenAIToolCalls([
			{ id: 'c1', name: 'bad', arguments: 'not json' },
			{ id: 'c2', name: 'good', arguments: '{"key":"value"}' },
		]);

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('good');

		consoleSpy.mockRestore();
	});
});

// ── wrapReasoningContent ──

describe('wrapReasoningContent', () => {
	it('reasoning이 없으면 content만 반환한다', () => {
		expect(wrapReasoningContent(undefined, 'Hello')).toBe('Hello');
	});

	it('reasoning이 있으면 <think> 태그로 래핑한다', () => {
		expect(wrapReasoningContent('thinking', '42')).toBe('<think>\nthinking\n</think>\n42');
	});
});

// ── resolveReasoningTag ──

describe('resolveReasoningTag', () => {
	it('reasoning 시작 → <think> 태그 열림', () => {
		const state = createReasoningState();
		expect(resolveReasoningTag(state, undefined, true)).toBe('<think>\n');
		expect(state.isThinking).toBe(true);
	});

	it('reasoning 종료 → </think> 태그 닫힘', () => {
		const state = createReasoningState();
		state.isThinking = true;
		expect(resolveReasoningTag(state, undefined, false)).toBe('\n</think>\n');
		expect(state.isThinking).toBe(false);
	});

	it('reasoning 중이면 undefined 반환 (displayText로 직접 누적)', () => {
		const state = createReasoningState();
		state.isThinking = true;
		expect(resolveReasoningTag(state, 'thinking...', true)).toBeUndefined();
	});

	it('일반 content 전송 중에는 undefined 반환', () => {
		const state = createReasoningState();
		expect(resolveReasoningTag(state, 'hello', false)).toBeUndefined();
	});
});

// ── StreamChunkAccumulator ──

describe('StreamChunkAccumulator', () => {
	it('빈 상태 초기화', () => {
		const acc = new StreamChunkAccumulator();
		const r = acc.getResult();
		expect(r.content).toBe('');
		expect(r.toolCalls).toEqual([]);
		expect(r.usage).toBeUndefined();
		expect(r.finishReason).toBeUndefined();
	});

	it('단일 content 청크 누적', () => {
		const acc = new StreamChunkAccumulator();
		acc.processLine('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}');
		expect(acc.fullContent).toBe('Hello');
	});

	it('여러 청크 순차 누적', () => {
		const acc = new StreamChunkAccumulator();
		acc.processLine('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}');
		acc.processLine('data: {"choices":[{"delta":{"content":" World"},"finish_reason":null}]}');
		acc.processLine('data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}');
		expect(acc.fullContent).toBe('Hello World!');
		expect(acc.finishReason).toBe('stop');
	});

	it('onChunk 콜백 호출', () => {
		const onChunk = vi.fn();
		const acc = new StreamChunkAccumulator(onChunk);
		acc.processLine('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}');
		expect(onChunk).toHaveBeenCalledWith('Hi');
	});

	it('usage 정보 누적', () => {
		const acc = new StreamChunkAccumulator();
		acc.processLine('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}');
		expect(acc.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
	});

	it('getResult 최종 결과 반환', () => {
		const acc = new StreamChunkAccumulator();
		acc.processLine('data: {"choices":[{"delta":{"content":"Final"},"finish_reason":"stop"}]}');
		expect(acc.getResult().content).toBe('Final');
	});

	it('reasoning 모드: <think> 태그 자동 래핑', () => {
		const acc = new StreamChunkAccumulator(undefined, { enableReasoning: true });
		acc.processLine('data: {"choices":[{"delta":{"reasoning_content":"Let me think..."},"finish_reason":null}]}');
		acc.processLine('data: {"choices":[{"delta":{"content":"42"},"finish_reason":"stop"}]}');
		expect(acc.fullContent).toBe('<think>\nLet me think...\n</think>\n42');
	});

	it('finalize: 미완료된 reasoning 태그 닫기', () => {
		const acc = new StreamChunkAccumulator(undefined, { enableReasoning: true });
		acc.processLine('data: {"choices":[{"delta":{"reasoning_content":"Still..."},"finish_reason":null}]}');
		acc.finalize();
		expect(acc.fullContent).toBe('<think>\nStill...\n</think>\n');
	});
});