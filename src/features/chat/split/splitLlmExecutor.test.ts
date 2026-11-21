import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
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
});
