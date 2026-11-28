import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { SharedTurnContext } from '../utils/contextBuilder';
import { executeSplitSlotCall, SPLIT_CHUNK_BATCH_INTERVAL_MS } from './splitLlmExecutor';
import * as providerFactory from '../../../core/llm-providers/index';

function makeSharedContext(overrides?: Partial<SharedTurnContext>): SharedTurnContext {
	return {
		attachmentContext: '',
		multimodalImages: [],
		failedAttachments: [],
		ragContext: undefined,
		ragChunksForLog: undefined,
		activeFilePath: undefined,
		activeFileTitle: undefined,
		attachments: [],
		ragSkipReason: 'disabled',
		historyTurnsUsed: 0,
		summaryApplied: false,
		historyAttachmentsRestored: 0,
		...overrides,
	};
}

describe('splitLlmExecutor', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('스트리밍 청크를 50ms 단위로 배칭해 플러시하고 메트릭·think 블록을 반환한다', async () => {
		const streamMock = vi.fn().mockImplementation(async (_msgs, options, onChunk) => {
			expect(options.temperature).toBe(0.2);
			onChunk('<think>추론</think>');
			onChunk('안녕');
			onChunk('하세요!');
			await vi.advanceTimersByTimeAsync(SPLIT_CHUNK_BATCH_INTERVAL_MS + 10);
			onChunk(' 반갑습니다.');
			return {
				usage: { inputTokens: 15, outputTokens: 25, totalTokens: 40 },
				finishReason: 'stop',
			};
		});

		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: vi.fn(),
			stream: streamMock,
			embed: vi.fn(),
		});

		const providerConfig: LLMProviderConfig = {
			id: 'p1',
			type: 'openai',
			credential: 'sk-test',
			availableModels: ['gpt-4o'],
			isVerified: true,
		};

		const flushed: string[] = [];
		const onFirstToken = vi.fn();

		const result = await executeSplitSlotCall({
			slot: {
				slotId: 's1',
				label: 'A',
				providerId: 'p1',
				modelId: 'gpt-4o',
				temperatureOverride: 0.2,
			},
			providerConfig,
			userText: '인사해줘',
			history: [],
			sharedContext: makeSharedContext(),
			chatSettings: { ...DEFAULT_SETTINGS.chat, streaming: true },
			onChunkFlush: (delta) => flushed.push(delta),
			onFirstToken,
		});

		expect(flushed).toEqual(['<think>추론</think>안녕하세요!', ' 반갑습니다.']);
		expect(onFirstToken).toHaveBeenCalledTimes(1);
		expect(result.content).toBe('안녕하세요! 반갑습니다.');
		expect(result.thinking).toBe('추론');
		expect(result.tokenUsage?.totalTokens).toBe(40);
		expect(result.hasTokenLimitBeenHit).toBe(false);
		expect(result.metrics.durationMs).toBeGreaterThanOrEqual(1);
		expect(result.metrics.tokensPerSecond).toBeGreaterThan(0);
	});

	it('CLI 프로바이더와 Vision 미지원 프로바이더(이미지 첨부 시)를 차단한다', async () => {
		await expect(
			executeSplitSlotCall({
				slot: { slotId: 's1', label: 'A', providerId: 'cli', modelId: 'claude' },
				providerConfig: {
					id: 'cli',
					type: 'cli-claude-code',
					credential: '',
					availableModels: ['claude'],
					isVerified: true,
				},
				userText: 'hello',
				history: [],
				sharedContext: makeSharedContext(),
				chatSettings: DEFAULT_SETTINGS.chat,
				onChunkFlush: vi.fn(),
			}),
		).rejects.toThrow(/CLI/);

		await expect(
			executeSplitSlotCall({
				slot: { slotId: 's2', label: 'B', providerId: 'ds', modelId: 'deepseek-chat' },
				providerConfig: {
					id: 'ds',
					type: 'deepseek',
					credential: 'sk-ds',
					availableModels: ['deepseek-chat'],
					isVerified: true,
				},
				userText: '이미지 설명해줘',
				history: [],
				sharedContext: makeSharedContext({ multimodalImages: ['data:image/png;base64,abc'] }),
				chatSettings: DEFAULT_SETTINGS.chat,
				onChunkFlush: vi.fn(),
			}),
		).rejects.toThrow();
	});

	it('non-streaming 모드에서도 정상 실행되고 완료 메트릭을 계산한다', async () => {
		const chatMock = vi.fn().mockResolvedValue({
			content: '단일 응답 결과',
			usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
			finishReason: 'stop',
		});

		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: chatMock,
			stream: vi.fn(),
			embed: vi.fn(),
		});

		const flushed: string[] = [];
		const result = await executeSplitSlotCall({
			slot: { slotId: 's1', label: 'A', providerId: 'p1', modelId: 'gpt-4o' },
			providerConfig: {
				id: 'p1',
				type: 'openai',
				credential: 'sk-test',
				availableModels: ['gpt-4o'],
				isVerified: true,
			},
			userText: '테스트',
			history: [],
			sharedContext: makeSharedContext(),
			chatSettings: { ...DEFAULT_SETTINGS.chat, streaming: false },
			onChunkFlush: (delta) => flushed.push(delta),
		});

		expect(flushed).toEqual(['단일 응답 결과']);
		expect(result.content).toBe('단일 응답 결과');
		expect(result.tokenUsage?.totalTokens).toBe(15);
	});

	it('스트리밍 중 오류와 AbortError 발생 시 stopReason을 error/aborted로 로깅하고 예외를 전파한다', async () => {
		const logRespSpy = vi.spyOn(debugLogger, 'logResponse');

		// 1) 일반 스트리밍 오류
		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: vi.fn(),
			stream: vi.fn().mockRejectedValue(new Error('Upstream 500')),
			embed: vi.fn(),
		});

		const baseParams = {
			slot: { slotId: 's1', label: 'A', providerId: 'p1', modelId: 'gpt-4o' },
			providerConfig: {
				id: 'p1',
				type: 'openai' as const,
				credential: 'sk-test',
				availableModels: ['gpt-4o'],
				isVerified: true,
			},
			userText: '에러 테스트',
			history: [],
			sharedContext: makeSharedContext(),
			chatSettings: { ...DEFAULT_SETTINGS.chat, streaming: true },
			onChunkFlush: vi.fn(),
		};

		await expect(executeSplitSlotCall(baseParams)).rejects.toThrow('Upstream 500');
		expect(logRespSpy).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ stopReason: 'error' }),
		);

		// 2) AbortError 중단
		logRespSpy.mockClear();
		const ac = new AbortController();
		ac.abort();
		const abortErr = new Error('Aborted');
		abortErr.name = 'AbortError';
		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: vi.fn(),
			stream: vi.fn().mockRejectedValue(abortErr),
			embed: vi.fn(),
		});

		await expect(executeSplitSlotCall({ ...baseParams, signal: ac.signal })).rejects.toThrow('Aborted');
		expect(logRespSpy).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ stopReason: 'aborted' }),
		);
	});

	it('finishReason이 length이면 토큰 한도 도달 경고를 추가하고, 빈 응답 폴백을 정확히 구분한다', async () => {
		const providerConfig: LLMProviderConfig = {
			id: 'p1',
			type: 'openai',
			credential: 'sk-test',
			availableModels: ['gpt-4o'],
			isVerified: true,
		};

		// 1) 본문이 있는 상태에서 finishReason='length'
		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: vi.fn().mockResolvedValue({
				content: '부분 답변입니다.',
				finishReason: 'length',
				usage: { inputTokens: 10, outputTokens: 100, totalTokens: 110 },
			}),
			stream: vi.fn(),
			embed: vi.fn(),
		});

		const truncated = await executeSplitSlotCall({
			slot: { slotId: 's1', label: 'A', providerId: 'p1', modelId: 'gpt-4o' },
			providerConfig,
			userText: '길게 설명해줘',
			history: [],
			sharedContext: makeSharedContext(),
			chatSettings: { ...DEFAULT_SETTINGS.chat, streaming: false },
			onChunkFlush: vi.fn(),
		});
		expect(truncated.hasTokenLimitBeenHit).toBe(true);
		expect(truncated.content).toContain('부분 답변입니다.');
		expect(truncated.content).toContain(t('uiMessages.tokenLimitHitWarning'));

		// 2) 빈 응답 + 일반 종료
		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: vi.fn().mockResolvedValue({ content: '<think>생각만 함</think>', finishReason: 'stop' }),
			stream: vi.fn(),
			embed: vi.fn(),
		});
		const emptyNormal = await executeSplitSlotCall({
			slot: { slotId: 's1', label: 'A', providerId: 'p1', modelId: 'gpt-4o' },
			providerConfig,
			userText: '질문',
			history: [],
			sharedContext: makeSharedContext(),
			chatSettings: { ...DEFAULT_SETTINGS.chat, streaming: false },
			onChunkFlush: vi.fn(),
		});
		expect(emptyNormal.hasTokenLimitBeenHit).toBe(false);
		expect(emptyNormal.content).toBe(t('settings.chat.emptyResponseFallback'));

		// 3) 빈 응답 + 토큰 한도 초과
		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: vi.fn().mockResolvedValue({ content: '', finishReason: 'length' }),
			stream: vi.fn(),
			embed: vi.fn(),
		});
		const emptyTokenLimit = await executeSplitSlotCall({
			slot: { slotId: 's1', label: 'A', providerId: 'p1', modelId: 'gpt-4o' },
			providerConfig,
			userText: '질문',
			history: [],
			sharedContext: makeSharedContext(),
			chatSettings: { ...DEFAULT_SETTINGS.chat, streaming: false },
			onChunkFlush: vi.fn(),
		});
		expect(emptyTokenLimit.hasTokenLimitBeenHit).toBe(true);
		expect(emptyTokenLimit.content).toBe(t('uiMessages.emptyResponseTokenLimit'));
	});

	it('멀티모달 이미지 첨부 시 Vision 지원 프로바이더에 이미지 파트를 주입해 호출한다', async () => {
		const chatMock = vi.fn().mockResolvedValue({
			content: '이미지 설명입니다.',
			finishReason: 'stop',
		});
		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: chatMock,
			stream: vi.fn(),
			embed: vi.fn(),
		});

		await executeSplitSlotCall({
			slot: { slotId: 's1', label: 'A', providerId: 'p1', modelId: 'gpt-4o' },
			providerConfig: {
				id: 'p1',
				type: 'openai',
				credential: 'sk-test',
				availableModels: ['gpt-4o'],
				isVerified: true,
			},
			userText: '이 사진이 뭐야?',
			history: [],
			sharedContext: makeSharedContext({
				multimodalImages: ['data:image/png;base64,iVBORw0KGgo='],
			}),
			chatSettings: { ...DEFAULT_SETTINGS.chat, streaming: false },
			onChunkFlush: vi.fn(),
		});

		expect(chatMock).toHaveBeenCalledTimes(1);
		const sentMsgs = chatMock.mock.calls[0][0] as Array<{ role: string; content: unknown }>;
		const lastUserMsg = sentMsgs.filter((m) => m.role === 'user').pop();
		expect(lastUserMsg).toBeDefined();
		expect(Array.isArray(lastUserMsg?.content)).toBe(true);
		const parts = lastUserMsg?.content as Array<{ type: string; image_url?: { url: string } }>;
		expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url === 'data:image/png;base64,iVBORw0KGgo=')).toBe(
			true,
		);
	});

	it('reasoningEffort가 auto이면 reasoning 옵션을 생략하고, 설정 시 chatOptions.reasoning을 전달한다', async () => {
		const chatMock = vi.fn().mockResolvedValue({ content: 'OK', finishReason: 'stop' });
		vi.spyOn(providerFactory, 'createProvider').mockReturnValue({
			providerId: 'openai',
			listModels: vi.fn(),
			chat: chatMock,
			stream: vi.fn(),
			embed: vi.fn(),
		});

		const providerConfig: LLMProviderConfig = {
			id: 'p1',
			type: 'openai',
			credential: 'sk-test',
			availableModels: ['o3'],
			isVerified: true,
		};

		await executeSplitSlotCall({
			slot: { slotId: 's1', label: 'A', providerId: 'p1', modelId: 'o3' },
			providerConfig,
			userText: 'hi',
			history: [],
			sharedContext: makeSharedContext(),
			chatSettings: { ...DEFAULT_SETTINGS.chat, streaming: false, reasoningEffort: 'auto' },
			onChunkFlush: vi.fn(),
		});
		expect(chatMock.mock.calls[0][1].reasoning).toBeUndefined();

		chatMock.mockClear();
		await executeSplitSlotCall({
			slot: { slotId: 's1', label: 'A', providerId: 'p1', modelId: 'o3' },
			providerConfig,
			userText: 'hi',
			history: [],
			sharedContext: makeSharedContext(),
			chatSettings: {
				...DEFAULT_SETTINGS.chat,
				streaming: false,
				reasoningEffort: 'high',
				reasoningBudgetTokens: 12000,
			},
			onChunkFlush: vi.fn(),
		});
		expect(chatMock.mock.calls[0][1].reasoning).toEqual({
			effort: 'high',
			budgetTokens: 12000,
		});
	});
});
