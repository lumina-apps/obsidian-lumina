import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import type LuminaPlugin from '../../../main';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import {
	resetEntitlementState,
	setEntitlementState,
	setReleasedFeatures,
} from '../../../core/store/entitlementStore';
import {
	getSplitChatState,
	initSplitSlots,
	resetSplitChat,
	setSplitContextMode,
	setSplitMode,
	setSplitTurnWinner,
} from '../../../core/store/splitChatStore';
import { messages, sessionModelId, sessionProviderId, resetChat } from '../../../core/store/chatStore';
import * as contextBuilder from '../utils/contextBuilder';
import * as splitExecutor from './splitLlmExecutor';
import * as splitHistory from './splitHistory';
import * as viewHelper from '../../../core/views/viewHelper';
import { SplitChatController, buildSlotHistory } from './splitChatController';
import type { SplitTurn } from '../../../shared/types/splitChat.types';

function createMockPlugin() {
	const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
	settings.chat.autoSaveHistory = false;
	settings.connections.providers = [
		{
			id: 'p1',
			type: 'openai',
			credential: 'sk-1',
			availableModels: ['gpt-4o'],
			isVerified: true,
		},
		{
			id: 'p2',
			type: 'anthropic',
			credential: 'sk-2',
			availableModels: ['claude-sonnet'],
			isVerified: true,
		},
	];

	return {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn(),
			},
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(null),
			},
		},
		settings,
		saveSettings: vi.fn().mockResolvedValue(undefined),
	} as unknown as LuminaPlugin;
}

describe('splitChatController', () => {
	let plugin: LuminaPlugin;
	let ctrl: SplitChatController;

	beforeEach(() => {
		resetEntitlementState();
		resetSplitChat(false);
		resetChat();
		plugin = createMockPlugin();
		ctrl = new SplitChatController(plugin);
		initSplitSlots([
			{ slotId: 's1', label: 'A', providerId: 'p1', modelId: 'gpt-4o' },
			{ slotId: 's2', label: 'B', providerId: 'p2', modelId: 'claude-sonnet' },
		]);
	});

	afterEach(() => {
		ctrl.destroy();
		vi.restoreAllMocks();
	});

	it('Pro 권한이 비활성화된 경우 sendPrompt·retry·promote·history 호출이 모두 차단된다', async () => {
		const prepSpy = vi.spyOn(contextBuilder, 'prepareSharedTurnContext');
		await ctrl.sendPrompt('차단 테스트', []);
		expect(prepSpy).not.toHaveBeenCalled();
		expect(getSplitChatState().turns).toHaveLength(0);

		expect(await ctrl.fetchHistorySessions()).toEqual([]);
		expect(await ctrl.promoteToSingleChat('s1')).toBe(false);
		expect(await ctrl.exportCurrentComparison()).toBe(false);
	});

	it('Pro 활성 시 공유 컨텍스트를 1회만 준비하고 부분 실패를 격리하며 개별 재시도가 가능하다', async () => {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['split-chat']),
		});

		const prepSpy = vi.spyOn(contextBuilder, 'prepareSharedTurnContext').mockResolvedValue({
			attachmentContext: '',
			multimodalImages: [],
			failedAttachments: [],
			ragContext: '공유 RAG 컨텍스트',
			ragChunksForLog: undefined,
			activeFilePath: undefined,
			activeFileTitle: undefined,
			attachments: [],
			ragSkipReason: null,
			historyTurnsUsed: 0,
			summaryApplied: false,
			historyAttachmentsRestored: 0,
		});

		const execSpy = vi
			.spyOn(splitExecutor, 'executeSplitSlotCall')
			.mockImplementation(async (params) => {
				if (params.slot.slotId === 's1') {
					return {
						content: 'GPT 응답 성공',
						tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
						hasTokenLimitBeenHit: false,
						metrics: { startedAt: 1000, finishedAt: 1500, durationMs: 500, tokensPerSecond: 40 },
					};
				}
				throw new Error('HTTP 429 rate limit');
			});

		await ctrl.sendPrompt('병렬 질문', []);

		expect(prepSpy).toHaveBeenCalledTimes(1);
		expect(execSpy).toHaveBeenCalledTimes(2);

		const state = getSplitChatState();
		expect(state.turns).toHaveLength(1);
		const turn = state.turns[0];
		expect(turn.responses['s1'].status).toBe('done');
		expect(turn.responses['s1'].content).toBe('GPT 응답 성공');
		expect(turn.responses['s2'].status).toBe('error');
		expect(turn.responses['s2'].errorMessage).toBeTruthy();

		// 실패한 슬롯만 단독 재시도 시 prepareSharedTurnContext는 캐시 재사용으로 추가 호출되지 않아야 함
		execSpy.mockResolvedValueOnce({
			content: 'Claude 재시도 성공',
			tokenUsage: { inputTokens: 10, outputTokens: 25, totalTokens: 35 },
			hasTokenLimitBeenHit: false,
			metrics: { startedAt: 2000, finishedAt: 2600, durationMs: 600, tokensPerSecond: 41.7 },
		});

		await ctrl.retrySlot(turn.id, 's2');
		expect(prepSpy).toHaveBeenCalledTimes(1);
		const updatedTurn = getSplitChatState().turns[0];
		expect(updatedTurn.responses['s2'].status).toBe('done');
		expect(updatedTurn.responses['s2'].content).toBe('Claude 재시도 성공');
	});

	it('Blind 모드에서는 셔플된 blindOrder와 isRevealed=false로 턴을 생성한다', async () => {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['split-chat']),
		});
		setSplitMode('blind');

		vi.spyOn(contextBuilder, 'prepareSharedTurnContext').mockResolvedValue({
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
		});
		vi.spyOn(splitExecutor, 'executeSplitSlotCall').mockResolvedValue({
			content: '블라인드 답변',
			hasTokenLimitBeenHit: false,
			metrics: { startedAt: 1000, finishedAt: 1100, durationMs: 100 },
		});

		await ctrl.sendPrompt('블라인드 테스트', []);

		const turn = getSplitChatState().turns[0];
		expect(turn.isRevealed).toBe(false);
		expect(turn.blindOrder).toBeDefined();
		expect(new Set(turn.blindOrder)).toEqual(new Set(['s1', 's2']));
	});

	it('buildSlotHistory는 independent와 winner 컨텍스트 전략에 따라 이전 턴 응답을 올바르게 투영한다', () => {
		const turns: SplitTurn[] = [
			{
				id: 't1',
				userMessage: { id: 'u1', role: 'user', content: '1차 질문', isStreaming: false, timestamp: 100 },
				ragStep: null,
				isRevealed: true,
				winnerSlotId: 's2',
				responses: {
					s1: {
						slotId: 's1',
						providerId: 'p1',
						modelId: 'gpt-4o',
						status: 'done',
						content: 'A의 1차 답변',
						metrics: { startedAt: 100, finishedAt: 200 },
					},
					s2: {
						slotId: 's2',
						providerId: 'p2',
						modelId: 'claude-sonnet',
						status: 'done',
						content: 'B의 1차 우승 답변',
						metrics: { startedAt: 100, finishedAt: 250 },
					},
				},
			},
		];

		const indHistory = buildSlotHistory(turns, 's1', 'independent');
		expect(indHistory.map((m) => m.content)).toEqual(['1차 질문', 'A의 1차 답변']);

		const winnerHistory = buildSlotHistory(turns, 's1', 'winner');
		expect(winnerHistory.map((m) => m.content)).toEqual(['1차 질문', 'B의 1차 우승 답변']);
	});

	it('promoteToSingleChat은 선택 슬롯의 대화를 일반 chatStore로 승격하고 ChatView를 활성화한다', async () => {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['split-chat']),
		});
		setSplitContextMode('winner');

		vi.spyOn(contextBuilder, 'prepareSharedTurnContext').mockResolvedValue({
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
		});
		vi.spyOn(splitExecutor, 'executeSplitSlotCall').mockImplementation(async (params) => ({
			content: `${params.slot.modelId} 답변`,
			hasTokenLimitBeenHit: false,
			metrics: { startedAt: 1000, finishedAt: 1200, durationMs: 200 },
		}));
		const activateSpy = vi.spyOn(viewHelper, 'activateView').mockResolvedValue(undefined);

		await ctrl.sendPrompt('질문', []);
		setSplitTurnWinner(getSplitChatState().turns[0].id, 's1');

		const ok = await ctrl.promoteToSingleChat('s2');
		expect(ok).toBe(true);
		expect(get(sessionProviderId)).toBe('p2');
		expect(get(sessionModelId)).toBe('claude-sonnet');
		expect(get(messages).map((m) => m.content)).toEqual(['질문', 'claude-sonnet 답변']);
		expect(activateSpy).toHaveBeenCalled();
	});

	it('persistPreferences는 settings.chat.splitChat을 저장하고 autoSaveHistory=true 시 자동 저장을 호출한다', async () => {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['split-chat']),
		});
		plugin.settings.chat.autoSaveHistory = true;
		const saveHistorySpy = vi.spyOn(splitHistory, 'saveSplitSession').mockResolvedValue(undefined);

		vi.spyOn(contextBuilder, 'prepareSharedTurnContext').mockResolvedValue({
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
		});
		vi.spyOn(splitExecutor, 'executeSplitSlotCall').mockResolvedValue({
			content: '응답',
			hasTokenLimitBeenHit: false,
			metrics: { startedAt: 1000, finishedAt: 1100, durationMs: 100 },
		});

		await ctrl.persistPreferences();
		expect(plugin.settings.chat.splitChat?.lastSlots).toHaveLength(2);
		expect(plugin.saveSettings).toHaveBeenCalled();

		await ctrl.sendPrompt('자동 저장 질문', []);
		expect(saveHistorySpy).toHaveBeenCalledTimes(1);
	});

	it('Freemium(무료 노출) 상태에서는 2슬롯만 실행되고 Blind/Winner/내보내기는 제한된다', async () => {
		setReleasedFeatures(['split-chat']);
		initSplitSlots([
			{ slotId: 's1', label: 'A', providerId: 'p1', modelId: 'gpt-4o' },
			{ slotId: 's2', label: 'B', providerId: 'p2', modelId: 'claude-sonnet' },
			{ slotId: 's3', label: 'C', providerId: 'p1', modelId: 'gpt-4o' },
		]);
		setSplitMode('blind');
		setSplitContextMode('winner');

		vi.spyOn(contextBuilder, 'prepareSharedTurnContext').mockResolvedValue({
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
		});
		const execSpy = vi.spyOn(splitExecutor, 'executeSplitSlotCall').mockImplementation(async (params) => ({
			content: `${params.slot.slotId}-응답`,
			hasTokenLimitBeenHit: false,
			metrics: { startedAt: 1000, finishedAt: 1100, durationMs: 100 },
		}));

		await ctrl.sendPrompt('무료 모드 테스트', []);
		expect(execSpy).toHaveBeenCalledTimes(2);
		const turn1 = getSplitChatState().turns[0];
		expect(Object.keys(turn1.responses)).toEqual(['s1', 's2']);
		expect(turn1.isRevealed).toBe(true);
		expect(turn1.blindOrder).toBeUndefined();

		setSplitTurnWinner(turn1.id, 's2');
		await ctrl.sendPrompt('2번째 질문', []);
		const firstSlotSecondCallHistory = execSpy.mock.calls[2][0].history;
		expect(firstSlotSecondCallHistory.map((m) => m.content)).toEqual(['무료 모드 테스트', 's1-응답']);

		const exportCurrentOk = await ctrl.exportCurrentComparison();
		const exportHistoryOk = await ctrl.exportHistorySession('any-id');
		expect(exportCurrentOk).toBe(false);
		expect(exportHistoryOk).toBe(false);

		const activateSpy = vi.spyOn(viewHelper, 'activateView').mockResolvedValue(undefined);
		expect(await ctrl.promoteToSingleChat('s1')).toBe(true);
		expect(activateSpy).toHaveBeenCalled();
	});
});
