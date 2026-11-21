import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	splitChatStore,
	isAnySlotStreaming,
	splitSessionTokenStats,
	initSplitSlots,
	addSplitSlot,
	removeSplitSlot,
	updateSplitSlotModel,
	updateSplitSlotTemperature,
	setSplitMode,
	setSplitContextMode,
	addSplitTurn,
	setSplitTurnRagStep,
	setSplitTurnRagSources,
	updateSplitSlotResponse,
	appendSplitSlotChunk,
	setSplitTurnWinner,
	revealSplitTurn,
	revealAllSplitTurns,
	truncateSplitTurnsFrom,
	setFocusedResponse,
	setActiveMobileSlotId,
	setSplitSession,
	setSplitSessionMeta,
	resetSplitChat,
	getSplitChatState,
} from './splitChatStore';
import type { SplitChatSession, SplitSlotConfig, SplitTurn } from '../../shared/types/splitChat.types';

function makeSlot(id: string, modelId = `model-${id}`): SplitSlotConfig {
	return {
		slotId: id,
		label: 'X',
		providerId: 'openai',
		modelId,
	};
}

function makeTurn(id: string, slotIds: string[], status: 'waiting' | 'done' = 'waiting'): SplitTurn {
	const responses: SplitTurn['responses'] = {};
	for (const sid of slotIds) {
		responses[sid] = {
			slotId: sid,
			providerId: 'openai',
			modelId: `model-${sid}`,
			status,
			content: status === 'done' ? `answer-${sid}` : '',
			metrics: { startedAt: 1000 },
		};
	}
	return {
		id,
		userMessage: {
			id: `user-${id}`,
			role: 'user',
			content: `prompt-${id}`,
			isStreaming: false,
			timestamp: 1000,
		},
		ragStep: null,
		responses,
		isRevealed: true,
	};
}

describe('splitChatStore', () => {
	beforeEach(() => {
		resetSplitChat(false);
	});

	it('슬롯 초기화 시 레이블(A, B, C, D)이 부여되고 최대 4개로 제한된다', () => {
		initSplitSlots([
			makeSlot('s1'),
			makeSlot('s2'),
			makeSlot('s3'),
			makeSlot('s4'),
			makeSlot('s5'),
		]);
		const state = getSplitChatState();
		expect(state.slots).toHaveLength(4);
		expect(state.slots.map((s) => s.label)).toEqual(['A', 'B', 'C', 'D']);
		expect(state.activeMobileSlotId).toBe('s1');
	});

	it('addSplitSlot과 removeSplitSlot은 최소 2개·최대 4개 제약을 지키고 레이블을 재정렬한다', () => {
		initSplitSlots([makeSlot('s1'), makeSlot('s2')]);
		expect(removeSplitSlot('s1')).toBe(false);
		expect(addSplitSlot(makeSlot('s3'))).toBe(true);
		expect(addSplitSlot(makeSlot('s4'))).toBe(true);
		expect(addSplitSlot(makeSlot('s5'))).toBe(false);

		setActiveMobileSlotId('s2');
		expect(removeSplitSlot('s2')).toBe(true);

		const state = getSplitChatState();
		expect(state.slots.map((s) => `${s.slotId}:${s.label}`)).toEqual([
			's1:A',
			's3:B',
			's4:C',
		]);
		expect(state.activeMobileSlotId).toBe('s1');
	});

	it('모델 및 슬롯별 Temperature 오버라이드를 변경할 수 있다', () => {
		initSplitSlots([makeSlot('s1'), makeSlot('s2')]);
		updateSplitSlotModel('s2', 'anthropic', 'claude-sonnet');
		updateSplitSlotTemperature('s2', 0.2);

		const s2 = getSplitChatState().slots[1];
		expect(s2.providerId).toBe('anthropic');
		expect(s2.modelId).toBe('claude-sonnet');
		expect(s2.temperatureOverride).toBe(0.2);

		updateSplitSlotTemperature('s2', undefined);
		expect(getSplitChatState().slots[1].temperatureOverride).toBeUndefined();
	});

	it('appendSplitSlotChunk는 waiting을 streaming으로 전환하고 TTFT와 누적 텍스트를 기록한다', () => {
		initSplitSlots([makeSlot('s1'), makeSlot('s2')]);
		const turn = makeTurn('t1', ['s1', 's2'], 'waiting');
		addSplitTurn(turn);

		expect(get(isAnySlotStreaming)).toBe(true);

		appendSplitSlotChunk('t1', 's1', 'Hello ');
		appendSplitSlotChunk('t1', 's1', 'World');

		const resp1 = getSplitChatState().turns[0].responses['s1'];
		expect(resp1.status).toBe('streaming');
		expect(resp1.content).toBe('Hello World');
		expect(resp1.metrics.firstTokenAt).toBeTypeOf('number');
		expect(resp1.metrics.ttftMs).toBeGreaterThanOrEqual(0);

		updateSplitSlotResponse('t1', 's1', {
			status: 'done',
			tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
			metrics: { durationMs: 500 },
		});
		updateSplitSlotResponse('t1', 's2', {
			status: 'done',
			tokenUsage: { inputTokens: 10, outputTokens: 25, totalTokens: 35 },
		});

		expect(get(isAnySlotStreaming)).toBe(false);
		expect(get(splitSessionTokenStats).totalTokens).toBe(65);
		expect(getSplitChatState().turns[0].responses['s1'].metrics.durationMs).toBe(500);
	});

	it('RAG 진행 중일 때도 isAnySlotStreaming이 true를 반환한다', () => {
		initSplitSlots([makeSlot('s1'), makeSlot('s2')]);
		const turn = makeTurn('t1', ['s1', 's2'], 'done');
		addSplitTurn(turn);
		expect(get(isAnySlotStreaming)).toBe(false);

		setSplitTurnRagStep('t1', 'searching');
		expect(get(isAnySlotStreaming)).toBe(true);

		setSplitTurnRagSources('t1', [{ filePath: 'note.md' }]);
		setSplitTurnRagStep('t1', null);
		expect(get(isAnySlotStreaming)).toBe(false);
		expect(getSplitChatState().turns[0].ragSources).toEqual([{ filePath: 'note.md' }]);
	});

	it('Blind 모드 승자 선택, 공개 및 턴 자르기가 동작한다', () => {
		setSplitMode('blind');
		setSplitContextMode('winner');
		initSplitSlots([makeSlot('s1'), makeSlot('s2')]);

		const t1 = { ...makeTurn('t1', ['s1', 's2'], 'done'), isRevealed: false };
		const t2 = { ...makeTurn('t2', ['s1', 's2'], 'done'), isRevealed: false };
		addSplitTurn(t1);
		addSplitTurn(t2);

		setSplitTurnWinner('t1', 's2', true);
		expect(getSplitChatState().turns[0].winnerSlotId).toBe('s2');
		expect(getSplitChatState().turns[0].isRevealed).toBe(true);
		expect(getSplitChatState().turns[1].isRevealed).toBe(false);

		revealSplitTurn('t2');
		expect(getSplitChatState().turns[1].isRevealed).toBe(true);

		addSplitTurn({ ...makeTurn('t3', ['s1', 's2'], 'done'), isRevealed: false });
		revealAllSplitTurns();
		expect(getSplitChatState().turns[2].isRevealed).toBe(true);

		truncateSplitTurnsFrom('t2');
		expect(getSplitChatState().turns.map((t) => t.id)).toEqual(['t1']);
	});

	it('setSplitSession은 중단 없이 저장된 streaming 상태를 aborted로 정리해 복원한다', () => {
		const session: SplitChatSession = {
			id: 'sess-1',
			sessionType: 'split',
			title: '비교 세션',
			slots: [makeSlot('s1'), makeSlot('s2')],
			turns: [{ ...makeTurn('t1', ['s1', 's2'], 'waiting'), ragStep: 'searching' }],
			mode: 'blind',
			contextMode: 'winner',
			createdAt: 100,
			updatedAt: 200,
		};

		setSplitSession(session);
		const state = get(splitChatStore);
		expect(state.sessionId).toBe('sess-1');
		expect(state.sessionTitle).toBe('비교 세션');
		expect(state.turns[0].ragStep).toBeNull();
		expect(state.turns[0].responses['s1'].status).toBe('aborted');

		setFocusedResponse({ turnId: 't1', slotId: 's1' });
		setSplitSessionMeta('sess-2', '수정된 제목');
		expect(getSplitChatState().focusedResponse).toEqual({ turnId: 't1', slotId: 's1' });
		expect(getSplitChatState().sessionTitle).toBe('수정된 제목');

		resetSplitChat(true);
		expect(getSplitChatState().turns).toHaveLength(0);
		expect(getSplitChatState().slots).toHaveLength(2);
	});
});
