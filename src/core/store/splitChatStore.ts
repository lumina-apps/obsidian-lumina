import { derived, get, writable, type Readable } from 'svelte/store';
import type { ChatRagSource, RagPipelineStep } from '../../shared/types/chat.types';
import type {
	SplitChatSession,
	SplitContextMode,
	SplitLayoutMode,
	SplitResponseMetrics,
	SplitSlotConfig,
	SplitSlotResponse,
	SplitTurn,
	SplitWinnerChoice,
} from '../../shared/types/splitChat.types';

/** Split 비교 모드 최소/최대 모델 슬롯 수 */
export const MIN_SPLIT_SLOTS = 2;
export const MAX_SPLIT_SLOTS = 4;

const SLOT_LABELS = ['A', 'B', 'C', 'D'] as const;

/** Split 응답 업데이트용 부분 패치 타입 */
export type SplitSlotResponsePatch = Omit<Partial<SplitSlotResponse>, 'metrics'> & {
	metrics?: Partial<SplitResponseMetrics>;
};

/** Split Chat 런타임 전역 상태 */
export interface SplitChatState {
	/** 현재 세션 ID (저장 전이면 null) */
	sessionId: string | null;
	/** 현재 세션 제목 (저장 전이면 null) */
	sessionTitle: string | null;
	/** 현재 비교 슬롯 목록 (2~4개) */
	slots: SplitSlotConfig[];
	/** 진행된 대화 라운드 목록 */
	turns: SplitTurn[];
	/** 현재 레이아웃 모드 */
	mode: SplitLayoutMode;
	/** 현재 멀티턴 컨텍스트 전략 */
	contextMode: SplitContextMode;
	/** 확대 보기 모달에 열린 응답 대상 */
	focusedResponse: { turnId: string; slotId: string } | null;
	/** 좁은 화면(모바일/컴팩트)에서 선택된 슬롯 ID */
	activeMobileSlotId: string | null;
}

function createInitialState(): SplitChatState {
	return {
		sessionId: null,
		sessionTitle: null,
		slots: [],
		turns: [],
		mode: 'side-by-side',
		contextMode: 'independent',
		focusedResponse: null,
		activeMobileSlotId: null,
	};
}

/** 슬롯 목록에 A~D 알파벳 레이블을 순서대로 재부여 */
function relabelSlots(slots: SplitSlotConfig[]): SplitSlotConfig[] {
	return slots.slice(0, MAX_SPLIT_SLOTS).map((slot, idx) => ({
		...slot,
		label: SLOT_LABELS[idx] ?? String(idx + 1),
	}));
}

export const splitChatStore = writable<SplitChatState>(createInitialState());

/** 하나 이상의 슬롯이나 RAG 검색이 현재 진행 중인지 여부 */
export const isAnySlotStreaming: Readable<boolean> = derived(splitChatStore, ($s) =>
	$s.turns.some(
		(turn) =>
			turn.ragStep !== null ||
			Object.values(turn.responses).some(
				(resp) => resp.status === 'waiting' || resp.status === 'streaming',
			),
	),
);

/** 현재 Split 세션 전체의 누적 토큰 및 캐시 재사용 합계 */
export const splitSessionTokenStats: Readable<{
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
}> = derived(
	splitChatStore,
	($s) => {
		let totalTokens = 0;
		let inputTokens = 0;
		let outputTokens = 0;
		let cacheReadTokens = 0;
		let cacheCreationTokens = 0;
		for (const turn of $s.turns) {
			for (const resp of Object.values(turn.responses)) {
				if (resp.tokenUsage) {
					totalTokens += resp.tokenUsage.totalTokens;
					inputTokens += resp.tokenUsage.inputTokens;
					outputTokens += resp.tokenUsage.outputTokens;
					cacheReadTokens += resp.tokenUsage.cacheReadTokens ?? 0;
					cacheCreationTokens += resp.tokenUsage.cacheCreationTokens ?? 0;
				}
			}
		}
		return {
			totalTokens,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheCreationTokens,
		};
	},
);

/** 현재 Split 스토어 스냅샷 반환 */
export function getSplitChatState(): SplitChatState {
	return get(splitChatStore);
}

/** 초기 슬롯 목록 설정 (최대 4개 제한 및 레이블 재정렬) */
export function initSplitSlots(slots: SplitSlotConfig[]): void {
	const normalized = relabelSlots(slots);
	splitChatStore.update((state) => ({
		...state,
		slots: normalized,
		activeMobileSlotId:
			normalized.some((s) => s.slotId === state.activeMobileSlotId)
				? state.activeMobileSlotId
				: (normalized[0]?.slotId ?? null),
	}));
}

/** 모델 슬롯 추가 (최대 4개까지 허용) */
export function addSplitSlot(slot: SplitSlotConfig): boolean {
	let added = false;
	splitChatStore.update((state) => {
		if (state.slots.length >= MAX_SPLIT_SLOTS) {
			return state;
		}
		added = true;
		const nextSlots = relabelSlots([...state.slots, slot]);
		return {
			...state,
			slots: nextSlots,
			activeMobileSlotId: state.activeMobileSlotId ?? nextSlots[0]?.slotId ?? null,
		};
	});
	return added;
}

/** 모델 슬롯 제거 (최소 2개 유지) */
export function removeSplitSlot(slotId: string): boolean {
	let removed = false;
	splitChatStore.update((state) => {
		if (state.slots.length <= MIN_SPLIT_SLOTS) {
			return state;
		}
		const filtered = state.slots.filter((s) => s.slotId !== slotId);
		if (filtered.length === state.slots.length) {
			return state;
		}
		removed = true;
		const nextSlots = relabelSlots(filtered);
		const nextActiveMobile =
			state.activeMobileSlotId === slotId ||
			!nextSlots.some((s) => s.slotId === state.activeMobileSlotId)
				? (nextSlots[0]?.slotId ?? null)
				: state.activeMobileSlotId;

		return {
			...state,
			slots: nextSlots,
			activeMobileSlotId: nextActiveMobile,
		};
	});
	return removed;
}

/** 특정 슬롯의 프로바이더/모델 변경 */
export function updateSplitSlotModel(
	slotId: string,
	providerId: string,
	modelId: string,
): void {
	splitChatStore.update((state) => ({
		...state,
		slots: state.slots.map((s) =>
			s.slotId === slotId ? { ...s, providerId, modelId } : s,
		),
	}));
}

/** 특정 슬롯의 Temperature 오버라이드 변경 (undefined면 전역 설정 사용) */
export function updateSplitSlotTemperature(
	slotId: string,
	temperatureOverride: number | undefined,
): void {
	splitChatStore.update((state) => ({
		...state,
		slots: state.slots.map((s) =>
			s.slotId === slotId ? { ...s, temperatureOverride } : s,
		),
	}));
}

/** 레이아웃 모드(Side-by-Side / Blind) 변경 */
export function setSplitMode(mode: SplitLayoutMode): void {
	splitChatStore.update((state) => ({
		...state,
		mode,
	}));
}

/** 멀티턴 컨텍스트 전략 변경 */
export function setSplitContextMode(contextMode: SplitContextMode): void {
	splitChatStore.update((state) => ({
		...state,
		contextMode,
	}));
}

/** 새 질문 라운드 추가 */
export function addSplitTurn(turn: SplitTurn): void {
	splitChatStore.update((state) => ({
		...state,
		turns: [...state.turns, turn],
	}));
}

/** 라운드의 공유 RAG 진행 상태 갱신 */
export function setSplitTurnRagStep(turnId: string, step: RagPipelineStep): void {
	splitChatStore.update((state) => ({
		...state,
		turns: state.turns.map((turn) =>
			turn.id === turnId ? { ...turn, ragStep: step } : turn,
		),
	}));
}

/** 라운드의 공유 RAG 출처 갱신 */
export function setSplitTurnRagSources(
	turnId: string,
	sources: ChatRagSource[],
): void {
	splitChatStore.update((state) => ({
		...state,
		turns: state.turns.map((turn) =>
			turn.id === turnId ? { ...turn, ragSources: sources } : turn,
		),
	}));
}

/** 특정 라운드·슬롯의 응답 상태 패치 (metrics는 기존 객체와 병합) */
export function updateSplitSlotResponse(
	turnId: string,
	slotId: string,
	patch: SplitSlotResponsePatch,
): void {
	splitChatStore.update((state) => ({
		...state,
		turns: state.turns.map((turn) => {
			if (turn.id !== turnId) return turn;
			const existing = turn.responses[slotId];
			if (!existing) return turn;
			const mergedMetrics: SplitResponseMetrics = patch.metrics
				? { ...existing.metrics, ...patch.metrics }
				: existing.metrics;
			return {
				...turn,
				responses: {
					...turn.responses,
					[slotId]: {
						...existing,
						...patch,
						metrics: mergedMetrics,
					},
				},
			};
		}),
	}));
}

/** 특정 라운드·슬롯의 스트리밍 청크 누적 및 TTFT 최초 기록 */
export function appendSplitSlotChunk(
	turnId: string,
	slotId: string,
	delta: string,
): void {
	if (!delta) return;
	const now = Date.now();
	splitChatStore.update((state) => ({
		...state,
		turns: state.turns.map((turn) => {
			if (turn.id !== turnId) return turn;
			const existing = turn.responses[slotId];
			if (!existing) return turn;
			const hasFirstToken = existing.metrics.firstTokenAt !== undefined;
			const nextMetrics: SplitResponseMetrics = hasFirstToken
				? existing.metrics
				: {
						...existing.metrics,
						firstTokenAt: now,
						ttftMs: Math.max(0, now - existing.metrics.startedAt),
					};
			return {
				...turn,
				responses: {
					...turn.responses,
					[slotId]: {
						...existing,
						status: existing.status === 'waiting' ? 'streaming' : existing.status,
						content: existing.content + delta,
						metrics: nextMetrics,
					},
				},
			};
		}),
	}));
}

/** 라운드 우승 답변/투표 선택 (autoReveal이 true면 Blind 모델명도 함께 공개) */
export function setSplitTurnWinner(
	turnId: string,
	winner: SplitWinnerChoice,
	autoReveal: boolean = true,
): void {
	splitChatStore.update((state) => ({
		...state,
		turns: state.turns.map((turn) =>
			turn.id === turnId
				? {
						...turn,
						winnerSlotId: winner,
						isRevealed: autoReveal ? true : turn.isRevealed,
					}
				: turn,
		),
	}));
}

/** 특정 라운드의 Blind 모델명을 공개 */
export function revealSplitTurn(turnId: string): void {
	splitChatStore.update((state) => ({
		...state,
		turns: state.turns.map((turn) =>
			turn.id === turnId ? { ...turn, isRevealed: true } : turn,
		),
	}));
}

/** 모든 라운드의 Blind 모델명을 일괄 공개 */
export function revealAllSplitTurns(): void {
	splitChatStore.update((state) => ({
		...state,
		turns: state.turns.map((turn) =>
			turn.isRevealed ? turn : { ...turn, isRevealed: true },
		),
	}));
}

/** 지정된 라운드 및 그 이후 라운드를 모두 제거 (질문 수정 후 재전송 시 사용) */
export function truncateSplitTurnsFrom(turnId: string): void {
	splitChatStore.update((state) => {
		const idx = state.turns.findIndex((t) => t.id === turnId);
		if (idx === -1) return state;
		return {
			...state,
			turns: state.turns.slice(0, idx),
		};
	});
}

/** 확대 보기 모달 대상 응답 설정 */
export function setFocusedResponse(
	target: { turnId: string; slotId: string } | null,
): void {
	splitChatStore.update((state) => ({
		...state,
		focusedResponse: target,
	}));
}

/** 좁은 화면(모바일/컴팩트)에서 활성화된 슬롯 탭 ID 설정 */
export function setActiveMobileSlotId(slotId: string | null): void {
	splitChatStore.update((state) => ({
		...state,
		activeMobileSlotId: slotId,
	}));
}

/** 저장된 Split 세션을 런타임 스토어로 복원 */
export function setSplitSession(session: SplitChatSession): void {
	const normalizedSlots = relabelSlots(session.slots);
	const normalizedTurns: SplitTurn[] = session.turns.map((turn) => {
		const fixedResponses: Record<string, SplitSlotResponse> = {};
		for (const [sid, resp] of Object.entries(turn.responses)) {
			const isInterrupted = resp.status === 'waiting' || resp.status === 'streaming';
			fixedResponses[sid] = {
				...resp,
				status: isInterrupted ? 'aborted' : resp.status,
			};
		}
		return {
			...turn,
			ragStep: null,
			responses: fixedResponses,
		};
	});

	splitChatStore.set({
		sessionId: session.id,
		sessionTitle: session.title,
		slots: normalizedSlots,
		turns: normalizedTurns,
		mode: session.mode,
		contextMode: session.contextMode,
		focusedResponse: null,
		activeMobileSlotId: normalizedSlots[0]?.slotId ?? null,
	});
}

/** 현재 세션의 ID와 제목 메타데이터 갱신 */
export function setSplitSessionMeta(
	sessionId: string | null,
	sessionTitle: string | null,
): void {
	splitChatStore.update((state) => ({
		...state,
		sessionId,
		sessionTitle,
	}));
}

/** Split 채팅 상태를 새 대화로 초기화 (기본적으로 현재 모델 슬롯 조합 및 모드 유지) */
export function resetSplitChat(keepSlots: boolean = true): void {
	splitChatStore.update((state) => ({
		sessionId: null,
		sessionTitle: null,
		slots: keepSlots ? state.slots : [],
		turns: [],
		mode: keepSlots ? state.mode : 'side-by-side',
		contextMode: keepSlots ? state.contextMode : 'independent',
		focusedResponse: null,
		activeMobileSlotId: keepSlots ? (state.slots[0]?.slotId ?? null) : null,
	}));
}
