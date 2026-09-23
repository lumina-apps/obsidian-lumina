import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop, isTokenLimitReached } from './agentLoop';
import type { ILLMProvider, ChatMessage, ChatOptions, ToolCall } from '../../shared/types/llm.types';
import type { ChatSettings } from '../../core/settings/settings.types';

vi.mock('../../core/store/chatStore', () => ({
	appendChunk: vi.fn(),
	syncMessageContent: vi.fn(),
	addExecutingTool: vi.fn(),
	removeExecutingTool: vi.fn(),
}));

vi.mock('./utils/toolExecutor', () => ({
	executeToolCall: vi.fn().mockImplementation(async (tc: ToolCall) => ({
		role: 'tool',
		content: `Result for ${tc.name}`,
		tool_call_id: tc.id,
	})),
}));

describe('agentLoop', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('isTokenLimitReached', () => {
		it('토큰 한도 관련 finishReason을 올바르게 감지한다', () => {
			expect(isTokenLimitReached('length')).toBe(true);
			expect(isTokenLimitReached('max_tokens')).toBe(true);
			expect(isTokenLimitReached('MAX_TOKENS')).toBe(true);
			expect(isTokenLimitReached('stop')).toBe(false);
			expect(isTokenLimitReached('tool_calls')).toBe(false);
			expect(isTokenLimitReached(undefined)).toBe(false);
		});
	});

	describe('runAgentLoop', () => {
		const baseSettings: ChatSettings = {
			agentMaxSteps: 5,
			streaming: false,
		} as any;

		it('tool call이 없으면 단일 턴에서 루프를 정상 완료한다', async () => {
			const mockProvider: ILLMProvider = {
				chat: vi.fn().mockResolvedValue({
					content: 'Simple direct answer',
					toolCalls: [],
					usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
					finishReason: 'stop',
				}),
			} as any;

			const result = await runAgentLoop({
				assistantId: 'msg-1',
				messagesForLLM: [{ role: 'user', content: 'Hello' }],
				chatOptions: {} as ChatOptions,
				provider: mockProvider,
				chatSettings: baseSettings,
				mcpManager: null,
				toolServerMap: {},
				useTextTools: false,
			});

			expect(result.fullResponse).toBe('Simple direct answer');
			expect(result.hasTokenLimitBeenHit).toBe(false);
			expect(result.tokenUsage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
			expect(mockProvider.chat).toHaveBeenCalledTimes(1);
		});

		it('동일한 도구 호출이 3회 연속 발생하면 무한 루프로 간주하여 강제 탈출한다', async () => {
			const toolCall: ToolCall = {
				id: 'call-1',
				name: 'read_note',
				arguments: { path: 'loop.md' },
			};

			const mockProvider: ILLMProvider = {
				chat: vi.fn().mockResolvedValue({
					content: 'Let me read the note',
					toolCalls: [toolCall],
					usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
					finishReason: 'tool_calls',
				}),
			} as any;

			const result = await runAgentLoop({
				assistantId: 'msg-loop',
				messagesForLLM: [{ role: 'user', content: 'Loop test' }],
				chatOptions: {} as ChatOptions,
				provider: mockProvider,
				chatSettings: baseSettings,
				mcpManager: null,
				toolServerMap: {},
				useTextTools: false,
			});

			// 3회 반복 후 중복 감지되어 탈출해야 함
			expect(mockProvider.chat).toHaveBeenCalledTimes(3);
			expect(result.fullResponse).toBeDefined();
		});

		it('A-B-A-B 교차 패턴 도구 호출 감지 시 루프를 조기 탈출한다', async () => {
			let callCount = 0;
			const toolA: ToolCall = { id: 'a', name: 'toolA', arguments: {} };
			const toolB: ToolCall = { id: 'b', name: 'toolB', arguments: {} };

			const mockProvider: ILLMProvider = {
				chat: vi.fn().mockImplementation(async () => {
					callCount++;
					const tool = callCount % 2 === 1 ? toolA : toolB;
					return {
						content: `Calling ${tool.name}`,
						toolCalls: [tool],
						usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
						finishReason: 'tool_calls',
					};
				}),
			} as any;

			const result = await runAgentLoop({
				assistantId: 'msg-pattern',
				messagesForLLM: [{ role: 'user', content: 'Pattern test' }],
				chatOptions: {} as ChatOptions,
				provider: mockProvider,
				chatSettings: baseSettings,
				mcpManager: null,
				toolServerMap: {},
				useTextTools: false,
			});

			// 4회째(A-B-A-B) 패턴 감지되어 탈출해야 함
			expect(callCount).toBe(4);
			expect(result.fullResponse).toBeDefined();
		});

		it('AbortSignal이 트리거되면 즉시 루프를 중단한다', async () => {
			const controller = new AbortController();
			const toolCall: ToolCall = { id: '1', name: 'slow_tool', arguments: {} };

			const mockProvider: ILLMProvider = {
				chat: vi.fn().mockImplementation(async () => {
					// 1회 호출 후 사용자 취소 발생
					controller.abort();
					return {
						content: 'First turn',
						toolCalls: [toolCall],
						finishReason: 'tool_calls',
					};
				}),
			} as any;

			const result = await runAgentLoop({
				assistantId: 'msg-abort',
				messagesForLLM: [{ role: 'user', content: 'Stop test' }],
				chatOptions: {} as ChatOptions,
				provider: mockProvider,
				chatSettings: baseSettings,
				mcpManager: null,
				toolServerMap: {},
				useTextTools: false,
				signal: controller.signal,
			});

			// 추가 라운드 진행 없이 1턴 후 즉시 종료되어야 함
			expect(mockProvider.chat).toHaveBeenCalledTimes(1);
			expect(result.fullResponse).toBeDefined();
		});

		it('토큰 한도 도달 시 hasTokenLimitBeenHit 플래그를 true로 반환한다', async () => {
			const mockProvider: ILLMProvider = {
				chat: vi.fn().mockResolvedValue({
					content: 'Cut off answer...',
					toolCalls: [],
					finishReason: 'max_tokens',
				}),
			} as any;

			const result = await runAgentLoop({
				assistantId: 'msg-limit',
				messagesForLLM: [{ role: 'user', content: 'Long request' }],
				chatOptions: {} as ChatOptions,
				provider: mockProvider,
				chatSettings: baseSettings,
				mcpManager: null,
				toolServerMap: {},
				useTextTools: false,
			});

			expect(result.hasTokenLimitBeenHit).toBe(true);
			expect(result.fullResponse).toContain('Cut off answer...');
		});
	});
});
