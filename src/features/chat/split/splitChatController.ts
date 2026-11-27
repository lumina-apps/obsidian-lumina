import { Notice, type App } from 'obsidian';
import type LuminaPlugin from '../../../main';
import {
	canUseFeature,
	canUseProFeature,
	FREE_MAX_SPLIT_SLOTS,
} from '../../../core/store/entitlementStore';
import { notifyProFeatureLocked } from '../../../shared/utils/proUpgradeModal';
import {
	addMessage,
	resetChat,
	sessionModelId,
	sessionProviderId,
} from '../../../core/store/chatStore';
import { getActiveProject } from '../../../core/store/projectStore';
import {
	addSplitTurn,
	appendSplitSlotChunk,
	getSplitChatState,
	resetSplitChat,
	setSplitSession,
	setSplitSessionMeta,
	setSplitTurnRagSources,
	setSplitTurnRagStep,
	truncateSplitTurnsFrom,
	updateSplitSlotResponse,
} from '../../../core/store/splitChatStore';
import { activateView } from '../../../core/views/viewHelper';
import { CHAT_VIEW_TYPE } from '../../../shared/constants/viewTypes';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import { findSupportedProvider } from '../../../shared/utils/modelUtils';
import type { ContextAttachment, UIChatMessage } from '../../../shared/types/chat.types';
import type {
	SplitChatSession,
	SplitContextMode,
	SplitSessionSummary,
	SplitSlotConfig,
	SplitSlotResponse,
	SplitTurn,
} from '../../../shared/types/splitChat.types';
import { normalizeError } from '../../../shared/utils/errorUtils';
import { formatLlmError } from '../../../shared/utils/llmErrorFormatter';
import { sanitizeDisplayContent } from '../../../shared/utils/llmTextSanitizer';
import { generateTitle, generateTitleWithLLM } from '../history';
import {
	prepareSharedTurnContext,
	resolveAttachmentsWithActiveNote,
	type SharedTurnContext,
} from '../utils/contextBuilder';
import { resolveHistoryLocation, type ResolvedHistoryLocation } from '../utils/historyLocation';
import { resolveModelId } from '../utils/llmExecutor';
import {
	deleteSplitSession,
	exportSplitSessionToMarkdown,
	loadSplitSession,
	loadSplitSessionsList,
	renameSplitSession,
	saveSplitSession,
} from './splitHistory';
import { executeSplitSlotCall } from './splitLlmExecutor';

/** 슬롯 ID 배열을 Fisher-Yates 알고리즘으로 무작위 셔플 */
export function shuffleSlotIds(slotIds: readonly string[]): string[] {
	const arr = [...slotIds];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

/**
 * 특정 슬롯의 멀티턴 대화 이력을 UIChatMessage 배열로 구성합니다.
 * - independent: 해당 슬롯의 이전 응답만 이어서 사용
 * - winner: 이전 라운드에서 채택된 우승 답변을 공통 맥락으로 사용 (미채택 시 해당 슬롯 응답 폴백)
 */
export function buildSlotHistory(
	turns: readonly SplitTurn[],
	slotId: string,
	contextMode: SplitContextMode,
	forceSlotIdOnLastTurn: boolean = false,
): UIChatMessage[] {
	const history: UIChatMessage[] = [];
	const lastIdx = turns.length - 1;

	turns.forEach((turn, idx) => {
		history.push(turn.userMessage);

		const useWinner =
			contextMode === 'winner' &&
			!(forceSlotIdOnLastTurn && idx === lastIdx) &&
			turn.winnerSlotId &&
			turn.winnerSlotId !== 'tie' &&
			turn.winnerSlotId !== 'both_bad';

		let chosenResp: SplitSlotResponse | undefined = useWinner
			? turn.responses[turn.winnerSlotId as string]
			: turn.responses[slotId];

		if (
			useWinner &&
			(!chosenResp || chosenResp.status === 'error' || !chosenResp.content.trim())
		) {
			chosenResp = turn.responses[slotId];
		}

		if (chosenResp && chosenResp.status !== 'error' && chosenResp.content.trim()) {
			history.push({
				id: `${turn.id}-${chosenResp.slotId}`,
				role: 'assistant',
				content: chosenResp.content,
				thinking: chosenResp.thinking,
				ragSources: turn.ragSources,
				isStreaming: false,
				timestamp: chosenResp.metrics.finishedAt ?? turn.userMessage.timestamp,
				model: chosenResp.modelId,
				tokenUsage: chosenResp.tokenUsage,
			});
		}
	});

	return history;
}

/**
 * Split / Arena 비교 채팅 오케스트레이터 컨트롤러.
 * 공유 컨텍스트(첨부·RAG) 1회 준비, 다중 모델 병렬 실행, 개별/전체 중단,
 * 재시도, 히스토리 저장/복원, 단일 채팅 승격을 담당합니다.
 */
export class SplitChatController {
	private app: App;
	private plugin: LuminaPlugin;
	private slotAbortControllers = new Map<string, AbortController>();
	private ragAbortController: AbortController | null = null;
	private turnSharedContextCache = new Map<string, SharedTurnContext>();
	private _isSaving = false;
	private _pendingSave = false;
	private autoSaveTimer: number | null = null;

	constructor(plugin: LuminaPlugin) {
		this.app = plugin.app;
		this.plugin = plugin;
	}

	private getAbortKey(turnId: string, slotId: string): string {
		return `${turnId}:${slotId}`;
	}

	private resolveLocation(): ResolvedHistoryLocation {
		const { chat, projects } = this.plugin.settings;
		return resolveHistoryLocation(chat, projects?.list ?? [], getActiveProject());
	}

	/** 현재 슬롯·모드·RAG 선호 설정을 settings.chat.splitChat에 저장 (권한 활성 시에만 기록) */
	async persistPreferences(overrides?: { useRagContext?: boolean }): Promise<void> {
		if (!canUseFeature('split-chat')) return;
		const state = getSplitChatState();
		const nextUseRagContext =
			overrides?.useRagContext ?? this.plugin.settings.chat.splitChat?.useRagContext;
		this.plugin.settings.chat.splitChat = {
			lastSlots: state.slots.map((s) => ({
				providerId: s.providerId,
				modelId: s.modelId,
				...(s.temperatureOverride !== undefined
					? { temperatureOverride: s.temperatureOverride }
					: {}),
			})),
			mode: state.mode,
			contextMode: state.contextMode,
			...(nextUseRagContext !== undefined ? { useRagContext: nextUseRagContext } : {}),
		};
		await this.plugin.saveSettings();
	}

	/** 자동 저장 디바운스 예약 (승자 투표·공개 등의 UI 변경 반영용) */
	scheduleAutoSave(): void {
		if (!canUseFeature('split-chat')) return;
		if (!this.plugin.settings.chat.autoSaveHistory) return;
		const state = getSplitChatState();
		if (state.turns.length === 0) return;

		if (this.autoSaveTimer !== null) {
			window.clearTimeout(this.autoSaveTimer);
		}
		this.autoSaveTimer = window.setTimeout(() => {
			this.autoSaveTimer = null;
			void this.saveCurrentHistory().catch((e: unknown) => {
				debugLogger.logError('split-history', normalizeError(e));
			});
		}, 800);
	}

	/**
	 * 모든 슬롯에 동일한 프롬프트를 전송해 병렬로 응답을 생성합니다.
	 */
	async sendPrompt(
		userText: string,
		attachments: ContextAttachment[],
		options?: { useRagContext?: boolean; includeActiveNote?: boolean },
	): Promise<void> {
		if (!canUseFeature('split-chat')) return;

		const state = getSplitChatState();
		if (state.slots.length === 0) return;

		const { rag, connections } = this.plugin.settings;
		const isProSplit = canUseProFeature('split-chat');
		const updatedAttachments = await resolveAttachmentsWithActiveNote(
			this.app,
			attachments,
			options?.includeActiveNote ?? rag.includeActiveNote,
			this.plugin.settings.chat.historyPath,
		);

		const turnId = crypto.randomUUID();
		const now = Date.now();
		const priorTurns = [...state.turns];

		const initialResponses: Record<string, SplitSlotResponse> = {};
		const activeSlots = isProSplit ? state.slots : state.slots.slice(0, FREE_MAX_SPLIT_SLOTS);
		const slotsSnapshot: SplitSlotConfig[] = activeSlots.map((s) => ({ ...s }));

		for (const slot of slotsSnapshot) {
			const providerCfg = connections.providers.find((p) => p.id === slot.providerId);
			const resolvedModelId = resolveModelId(providerCfg, slot.modelId) || slot.modelId;
			initialResponses[slot.slotId] = {
				slotId: slot.slotId,
				providerId: slot.providerId,
				modelId: resolvedModelId,
				status: 'waiting',
				content: '',
				metrics: { startedAt: now },
			};
		}

		const isBlind = isProSplit && state.mode === 'blind';
		const newTurn: SplitTurn = {
			id: turnId,
			userMessage: {
				id: crypto.randomUUID(),
				role: 'user',
				content: userText,
				attachments: updatedAttachments,
				isStreaming: false,
				timestamp: now,
			},
			ragStep: null,
			responses: initialResponses,
			isRevealed: !isBlind,
			...(isBlind ? { blindOrder: shuffleSlotIds(slotsSnapshot.map((s) => s.slotId)) } : {}),
		};

		addSplitTurn(newTurn);

		// 1. 공유 컨텍스트(첨부 + RAG) 턴당 1회 준비
		const ragAc = new AbortController();
		this.ragAbortController = ragAc;

		let sharedContext: SharedTurnContext;
		try {
			const attachmentHistory = priorTurns.map((tItem) => tItem.userMessage);
			sharedContext = await prepareSharedTurnContext({
				plugin: this.plugin,
				userText,
				updatedAttachments,
				history: attachmentHistory,
				ragSettings: rag,
				ragEnabled: connections.ragEnabled,
				useRagContext: options?.useRagContext,
				summaryUpToMessageId: undefined,
				onRagStepChange: (step) => setSplitTurnRagStep(turnId, step),
				onRagSourcesFound: (sources) => setSplitTurnRagSources(turnId, sources),
				signal: ragAc.signal,
			});
			this.turnSharedContextCache.set(turnId, sharedContext);
		} catch (err: unknown) {
			const isAborted =
				(err instanceof Error && err.name === 'AbortError') || ragAc.signal.aborted;
			setSplitTurnRagStep(turnId, null);
			for (const slot of slotsSnapshot) {
				updateSplitSlotResponse(turnId, slot.slotId, {
					status: isAborted ? 'aborted' : 'error',
					...(isAborted ? {} : { errorMessage: formatLlmError(err) }),
					metrics: { finishedAt: Date.now(), durationMs: Math.max(1, Date.now() - now) },
				});
			}
			if (!isAborted) {
				debugLogger.logError('split-chat', normalizeError(err));
			}
			return;
		} finally {
			if (this.ragAbortController === ragAc) {
				this.ragAbortController = null;
			}
			setSplitTurnRagStep(turnId, null);
		}

		// 2. 각 모델 슬롯 병렬 실행 (부분 실패 격리)
		await Promise.allSettled(
			slotsSnapshot.map((slot) =>
				this.runSingleSlot(turnId, slot, userText, priorTurns, sharedContext),
			),
		);

		// 3. 자동 저장
		await this.saveCurrentHistory().catch((e: unknown) => {
			debugLogger.logError('split-history', normalizeError(e));
		});
	}

	private async runSingleSlot(
		turnId: string,
		slot: SplitSlotConfig,
		userText: string,
		priorTurns: readonly SplitTurn[],
		sharedContext: SharedTurnContext,
	): Promise<void> {
		const key = this.getAbortKey(turnId, slot.slotId);
		const ac = new AbortController();
		this.slotAbortControllers.set(key, ac);

		const state = getSplitChatState();
		const { chat, connections } = this.plugin.settings;
		const providerConfig = connections.providers.find((p) => p.id === slot.providerId);
		const startedAt = Date.now();

		updateSplitSlotResponse(turnId, slot.slotId, {
			providerId: slot.providerId,
			modelId: resolveModelId(providerConfig, slot.modelId) || slot.modelId,
			status: 'waiting',
			content: '',
			thinking: undefined,
			errorMessage: undefined,
			tokenUsage: undefined,
			hasTokenLimitBeenHit: false,
			metrics: {
				startedAt,
				firstTokenAt: undefined,
				finishedAt: undefined,
				durationMs: undefined,
				ttftMs: undefined,
				tokensPerSecond: undefined,
			},
		});

		const effectiveContextMode: SplitContextMode = canUseProFeature('split-chat')
			? state.contextMode
			: 'independent';
		const slotHistory = buildSlotHistory(priorTurns, slot.slotId, effectiveContextMode);

		try {
			const result = await executeSplitSlotCall({
				slot,
				providerConfig,
				userText,
				history: slotHistory,
				sharedContext,
				chatSettings: chat,
				signal: ac.signal,
				onFirstToken: (firstTokenAt, ttftMs) => {
					updateSplitSlotResponse(turnId, slot.slotId, {
						status: 'streaming',
						metrics: { firstTokenAt, ttftMs },
					});
				},
				onChunkFlush: (delta) => {
					appendSplitSlotChunk(turnId, slot.slotId, delta);
				},
			});

			// readStreamLines가 signal.aborted 시 예외 없이 정상 종료될 수 있으므로 중단 상태를 명시적으로 반영
			updateSplitSlotResponse(turnId, slot.slotId, {
				status: ac.signal.aborted ? 'aborted' : 'done',
				content: result.content,
				thinking: result.thinking,
				tokenUsage: result.tokenUsage,
				hasTokenLimitBeenHit: result.hasTokenLimitBeenHit,
				metrics: result.metrics,
			});
		} catch (err: unknown) {
			const finishedAt = Date.now();
			const durationMs = Math.max(1, finishedAt - startedAt);
			const isAborted =
				(err instanceof Error && err.name === 'AbortError') || ac.signal.aborted;

			if (isAborted) {
				updateSplitSlotResponse(turnId, slot.slotId, {
					status: 'aborted',
					metrics: { finishedAt, durationMs },
				});
			} else {
				updateSplitSlotResponse(turnId, slot.slotId, {
					status: 'error',
					errorMessage: formatLlmError(err),
					metrics: { finishedAt, durationMs },
				});
				debugLogger.logError('split-llm', normalizeError(err));
			}
		} finally {
			this.slotAbortControllers.delete(key);
		}
	}

	/**
	 * 특정 라운드의 단일 슬롯만 재시도합니다.
	 */
	async retrySlot(
		turnId: string,
		slotId: string,
		options?: { useRagContext?: boolean },
	): Promise<void> {
		if (!canUseFeature('split-chat')) return;

		const key = this.getAbortKey(turnId, slotId);
		if (this.slotAbortControllers.has(key)) return;

		const state = getSplitChatState();
		const turnIndex = state.turns.findIndex((turn) => turn.id === turnId);
		if (turnIndex === -1) return;

		const turn = state.turns[turnIndex];
		const activeSlot = state.slots.find((s) => s.slotId === slotId);
		const existingResp = turn.responses[slotId];
		let targetSlot: SplitSlotConfig;
		if (activeSlot) {
			targetSlot = { ...activeSlot };
		} else if (existingResp) {
			targetSlot = {
				slotId,
				label: slotId,
				providerId: existingResp.providerId,
				modelId: existingResp.modelId,
			};
		} else {
			return;
		}

		const priorTurns = state.turns.slice(0, turnIndex);
		let sharedContext = this.turnSharedContextCache.get(turnId);

		if (!sharedContext) {
			const { rag, connections } = this.plugin.settings;
			const attachmentHistory = priorTurns.map((tItem) => tItem.userMessage);
			sharedContext = await prepareSharedTurnContext({
				plugin: this.plugin,
				userText: turn.userMessage.content,
				updatedAttachments: turn.userMessage.attachments ?? [],
				history: attachmentHistory,
				ragSettings: rag,
				ragEnabled: connections.ragEnabled,
				useRagContext: options?.useRagContext,
				summaryUpToMessageId: undefined,
				onRagStepChange: (step) => setSplitTurnRagStep(turnId, step),
				onRagSourcesFound: (sources) => setSplitTurnRagSources(turnId, sources),
			});
			setSplitTurnRagStep(turnId, null);
			this.turnSharedContextCache.set(turnId, sharedContext);
		}

		await this.runSingleSlot(
			turnId,
			targetSlot,
			turn.userMessage.content,
			priorTurns,
			sharedContext,
		);

		await this.saveCurrentHistory().catch((e: unknown) => {
			debugLogger.logError('split-history', normalizeError(e));
		});
	}

	/**
	 * 특정 라운드의 질문을 수정하고 그 이후 라운드를 제거한 뒤 재전송합니다.
	 */
	async editTurnAndResend(
		turnId: string,
		newContent: string,
		options?: { useRagContext?: boolean; includeActiveNote?: boolean },
	): Promise<void> {
		if (!canUseFeature('split-chat')) return;

		const state = getSplitChatState();
		const targetIndex = state.turns.findIndex((turn) => turn.id === turnId);
		if (targetIndex === -1) return;

		const targetTurn = state.turns[targetIndex];
		const skipped: string[] = [];
		const attachments = (targetTurn.userMessage.attachments || []).filter((a) => {
			if (a.type === 'active_note') return false;
			if ((a.type === 'external_file' || a.type === 'selection') && !a.content) {
				skipped.push(a.name);
				return false;
			}
			return true;
		});

		if (skipped.length > 0) {
			new Notice(t('uiMessages.attachmentsSkipped', { files: skipped.join(', ') }));
		}

		this.abortAll();
		for (let i = targetIndex; i < state.turns.length; i++) {
			this.turnSharedContextCache.delete(state.turns[i].id);
		}
		truncateSplitTurnsFrom(turnId);

		await this.sendPrompt(newContent, attachments, options);
	}

	/** 특정 라운드의 단일 슬롯 스트리밍만 중단 */
	abortSlot(turnId: string, slotId: string): void {
		const ac = this.slotAbortControllers.get(this.getAbortKey(turnId, slotId));
		ac?.abort();
	}

	/** 진행 중인 모든 RAG 검색 및 슬롯 스트리밍 중단 */
	abortAll(): void {
		this.ragAbortController?.abort();
		this.ragAbortController = null;
		for (const ac of this.slotAbortControllers.values()) {
			ac.abort();
		}
		this.slotAbortControllers.clear();
	}

	/**
	 * 특정 슬롯의 대화 맥락을 일반 사이드바 채팅(ChatView)으로 이어갑니다.
	 */
	async promoteToSingleChat(slotId: string): Promise<boolean> {
		if (!canUseFeature('split-chat')) return false;

		const state = getSplitChatState();
		if (state.turns.length === 0) return false;

		const targetSlot = state.slots.find((s) => s.slotId === slotId);
		const lastTurn = state.turns[state.turns.length - 1];
		const lastResp = lastTurn?.responses[slotId];

		const providerId = targetSlot?.providerId ?? lastResp?.providerId ?? '';
		const modelId = lastResp?.modelId ?? targetSlot?.modelId ?? '';
		if (!providerId || !modelId) return false;

		const projectedMessages = buildSlotHistory(
			state.turns,
			slotId,
			state.contextMode,
			true,
		).map((m) => ({
			...m,
			content: m.role === 'assistant' ? sanitizeDisplayContent(m.content) : m.content,
		}));

		resetChat();
		for (const msg of projectedMessages) {
			addMessage(msg);
		}
		sessionProviderId.set(providerId);
		sessionModelId.set(modelId);

		await activateView(this.app.workspace, CHAT_VIEW_TYPE, true);
		new Notice(t('splitChat.promotedToChat', { model: modelId }));
		return true;
	}

	// ─── 히스토리 영속화 & 내보내기 ──────────────────────────────────────────────

	private async resolveSessionTitle(turns: readonly SplitTurn[], slots: readonly SplitSlotConfig[]): Promise<string> {
		const firstMsg = turns[0]?.userMessage;
		if (!firstMsg) return t('splitChat.newComparison');

		const { taskProviderId, taskModelId, providers } = this.plugin.settings.connections;
		const msgsForTitle: UIChatMessage[] = [firstMsg];

		if (taskProviderId && taskModelId) {
			const candidateTask = findSupportedProvider(providers, taskProviderId);
			const taskProvider = candidateTask?.isVerified ? candidateTask : undefined;
			if (taskProvider) {
				try {
					return await generateTitleWithLLM(
						msgsForTitle,
						taskProvider,
						taskModelId,
						this.plugin.settings,
					);
				} catch {
					// 폴백
				}
			}
		}

		for (const slot of slots) {
			const candidateSlot = findSupportedProvider(providers, slot.providerId);
			const providerCfg = candidateSlot?.isVerified ? candidateSlot : undefined;
			if (providerCfg) {
				const model = resolveModelId(providerCfg, slot.modelId);
				if (model) {
					try {
						return await generateTitleWithLLM(
							msgsForTitle,
							providerCfg,
							model,
							this.plugin.settings,
						);
					} catch {
						// 다음 폴백
					}
				}
			}
		}

		return generateTitle(msgsForTitle);
	}

	/** 현재 Split 세션을 볼트에 저장 */
	async saveCurrentHistory(): Promise<void> {
		if (!canUseFeature('split-chat')) return;
		if (!this.plugin.settings.chat.autoSaveHistory) return;

		const state = getSplitChatState();
		if (state.turns.length === 0) return;

		if (this._isSaving) {
			this._pendingSave = true;
			return;
		}
		this._isSaving = true;

		try {
			const sessionId = state.sessionId || crypto.randomUUID();
			if (!state.sessionId) {
				setSplitSessionMeta(sessionId, state.sessionTitle);
			}

			let title = state.sessionTitle;
			if (!title) {
				title = await this.resolveSessionTitle(state.turns, state.slots);
				if (getSplitChatState().sessionId === sessionId) {
					setSplitSessionMeta(sessionId, title);
				}
			}

			const latest = getSplitChatState();
			if (latest.sessionId !== sessionId || latest.turns.length === 0) {
				return;
			}

			const session: SplitChatSession = {
				id: sessionId,
				sessionType: 'split',
				title: title || t('splitChat.newComparison'),
				slots: latest.slots.map((s) => ({ ...s })),
				turns: latest.turns,
				mode: latest.mode,
				contextMode: latest.contextMode,
				createdAt: latest.turns[0].userMessage.timestamp,
				updatedAt: Date.now(),
			};

			const { basePath, options } = this.resolveLocation();
			await saveSplitSession(this.app, session, basePath, options);
		} catch (e: unknown) {
			const err = normalizeError(e);
			debugLogger.logError('split-history', err);
			new Notice(t('splitChat.historySaveFail', { error: err.message }));
		} finally {
			this._isSaving = false;
			if (this._pendingSave) {
				this._pendingSave = false;
				void this.saveCurrentHistory();
			}
		}
	}

	async fetchHistorySessions(): Promise<SplitSessionSummary[]> {
		if (!canUseFeature('split-chat')) return [];
		const { basePath, options } = this.resolveLocation();
		return loadSplitSessionsList(this.app, basePath, options);
	}

	async restoreHistorySession(sessionId: string): Promise<boolean> {
		if (!canUseFeature('split-chat')) return false;
		const { basePath, options } = this.resolveLocation();
		const session = await loadSplitSession(this.app, sessionId, basePath, options);
		if (!session) {
			new Notice(t('splitChat.historyLoadFail'));
			return false;
		}
		this.abortAll();
		this.turnSharedContextCache.clear();
		setSplitSession(session);
		return true;
	}

	async renameHistorySession(sessionId: string, newTitle: string): Promise<boolean> {
		if (!canUseFeature('split-chat')) return false;
		const trimmed = newTitle.trim();
		if (!trimmed) return false;

		try {
			const { basePath, options } = this.resolveLocation();
			const updated = await renameSplitSession(this.app, sessionId, trimmed, basePath, options);
			if (updated) {
				if (getSplitChatState().sessionId === sessionId) {
					setSplitSessionMeta(sessionId, trimmed);
				}
				new Notice(t('splitChat.historyRenameSuccess'));
				return true;
			}
			new Notice(t('splitChat.historyRenameFail'));
			return false;
		} catch (e: unknown) {
			debugLogger.logError('split-history', normalizeError(e));
			new Notice(t('splitChat.historyRenameFail'));
			return false;
		}
	}

	async deleteHistorySession(sessionId: string): Promise<boolean> {
		if (!canUseFeature('split-chat')) return false;
		const { basePath, options } = this.resolveLocation();
		const success = await deleteSplitSession(this.app, sessionId, basePath, options);
		if (success) {
			if (getSplitChatState().sessionId === sessionId) {
				this.abortAll();
				this.turnSharedContextCache.clear();
				resetSplitChat(true);
			}
			new Notice(t('splitChat.historyDeleteSuccess'));
		} else {
			new Notice(t('splitChat.historyDeleteFail'));
		}
		return success;
	}

	async exportCurrentComparison(): Promise<boolean> {
		if (!canUseFeature('split-chat')) return false;
		if (!canUseProFeature('split-chat')) {
			notifyProFeatureLocked(this.app, 'split-chat', t('splitChat.proExportNotice'));
			return false;
		}
		const state = getSplitChatState();
		if (state.turns.length === 0) {
			new Notice(t('splitChat.noTurnsToExport'));
			return false;
		}

		const title =
			state.sessionTitle || generateTitle([state.turns[0].userMessage]);
		const session: SplitChatSession = {
			id: state.sessionId || crypto.randomUUID(),
			sessionType: 'split',
			title,
			slots: state.slots,
			turns: state.turns,
			mode: state.mode,
			contextMode: state.contextMode,
			createdAt: state.turns[0].userMessage.timestamp,
			updatedAt: Date.now(),
		};

		try {
			await exportSplitSessionToMarkdown(this.app, session);
			new Notice(t('splitChat.exportSuccess'));
			return true;
		} catch (e: unknown) {
			debugLogger.logError('split-export', normalizeError(e));
			new Notice(t('splitChat.exportFail'));
			return false;
		}
	}

	async exportHistorySession(sessionId: string): Promise<boolean> {
		if (!canUseFeature('split-chat')) return false;
		if (!canUseProFeature('split-chat')) {
			notifyProFeatureLocked(this.app, 'split-chat', t('splitChat.proExportNotice'));
			return false;
		}
		try {
			const { basePath, options } = this.resolveLocation();
			const session = await loadSplitSession(this.app, sessionId, basePath, options);
			if (!session) {
				new Notice(t('splitChat.historyLoadFail'));
				return false;
			}
			await exportSplitSessionToMarkdown(this.app, session);
			new Notice(t('splitChat.exportSuccess'));
			return true;
		} catch (e: unknown) {
			debugLogger.logError('split-export', normalizeError(e));
			new Notice(t('splitChat.exportFail'));
			return false;
		}
	}

	/** 컨트롤러 및 진행 중인 요청/타이머 정리 */
	destroy(): void {
		this.abortAll();
		this.turnSharedContextCache.clear();
		if (this.autoSaveTimer !== null) {
			window.clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
			if (canUseFeature('split-chat')) {
				void this.saveCurrentHistory().catch((e: unknown) => {
					debugLogger.logError('split-history', normalizeError(e));
				});
			}
		}
	}
}
