/**
 * Chat 도메인 메인 컨트롤러.
 * UI → controller → chatStore 액션으로 상태를 직접 관리하며,
 * ChatPanel은 $messages/$isLoading 구독으로 반응형 렌더링한다.
 */

import type { App } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import type LuminaPlugin from '../../main';
import { formatLlmError } from '../../shared/utils/llmErrorFormatter';
import {
	addMessage,
	setMessageStreaming,
	setMessageError,
	isLoading,
	getMessages,
	messages,
} from '../../core/store/chatStore';
import { get } from 'svelte/store';
import type { UIChatMessage, ChatSession, ContextAttachment } from '../../shared/types/chat.types';
import { debugLogger } from '../../shared/debugLogger';
import { triggerAutoSummarization } from './utils/summarizationHelper';
import { ChatHistoryController } from './chatHistoryController';
import { resolveAttachmentsWithActiveNote, buildLlmContext } from './utils/contextBuilder';
import { resolveModelId, executeLlmCall } from './utils/llmExecutor';
import { handleLlmResponse } from './utils/responseFormatter';

export class ChatController {
	private app: App;
	private plugin: LuminaPlugin;
	public history: ChatHistoryController;
	private autoSaveTimeout: number | null = null;
	private lastProviderId: string = '';
	private lastModelId: string = '';
	private _unsubMessages: (() => void) | null = null;
	private _isSaving = false;

	constructor(plugin: LuminaPlugin) {
		this.app = plugin.app;
		this.plugin = plugin;
		this.history = new ChatHistoryController(plugin);

		this._unsubMessages = messages.subscribe(() => {
			if (this.lastProviderId && this.lastModelId) {
				// 스트리밍 중일 때는 저장을 지연시킴
				const msgs = get(messages);
				if (msgs.some(m => m.isStreaming)) return;
				// user + assistant 메시지가 모두 있어야 저장 (최소 2개)
				if (msgs.length < 2) return;

				if (this.autoSaveTimeout) {
					window.clearTimeout(this.autoSaveTimeout);
				}
				this.autoSaveTimeout = window.setTimeout(() => {
					this.saveHistory(this.lastProviderId, this.lastModelId).catch((e: unknown) => {
						debugLogger.logError('history', e instanceof Error ? e : new Error(String(e)));
					});
				}, 3000);
			}
		});
	}

	/**
	 * 사용자 메시지를 전송하고 스트리밍으로 응답을 받습니다.
	 * 메시지 추가 / 스트리밍 업데이트 / 완료 처리를 모두 chatStore에 직접 반영.
	 */
	async sendMessage(
		userText: string,
		attachments: ContextAttachment[],
		providerId: string,
		modelId: string,
		options?: { useRagContext?: boolean; includeActiveNote?: boolean },
		signal?: AbortSignal,
	): Promise<void> {
		this.lastProviderId = providerId;
		this.lastModelId = modelId;
		const { rag, connections } = this.plugin.settings;
		const providerConfig = connections.providers.find(p => p.id === providerId);

		// ── 1. 사용자 메시지를 store에 추가 ──────────────────────────────────
		const updatedAttachments = await resolveAttachmentsWithActiveNote(
			this.app,
			attachments,
			connections.ragEnabled && (options?.includeActiveNote ?? rag.includeActiveNote),
		);

		const userMsg: UIChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: userText,
			attachments: updatedAttachments,
			isStreaming: false,
			timestamp: Date.now(),
		};
		addMessage(userMsg);

		// ── 2. 모델 검증 & 어시스턴트 placeholder 추가 ─────────────────────
		const resolvedModelId = resolveModelId(providerConfig, modelId);
		const assistantId = crypto.randomUUID();
		addMessage({
			id: assistantId,
			role: 'assistant',
			content: '',
			isStreaming: true,
			timestamp: Date.now(),
			model: resolvedModelId,
		});

		// ── 3. isLoading 시작 ──────────────────────────────────────────────
		isLoading.set(true);

		try {
			await this.processLlmRequest(
				userText,
				updatedAttachments,
				providerId,
				resolvedModelId,
				assistantId,
				options,
				signal,
			);
		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') {
				setMessageStreaming(assistantId, false);
			} else {
				const friendlyMsg = formatLlmError(err);
				setMessageError(assistantId, friendlyMsg);
				debugLogger.logError('llm', err instanceof Error ? err : new Error(String(err)));
			}
		} finally {
			isLoading.set(false);
			// 안전망: 예기치 못한 종료 시 스트리밍 상태 확실히 해제
			setMessageStreaming(assistantId, false);
		}
	}

	private async processLlmRequest(
		userText: string,
		updatedAttachments: ContextAttachment[],
		providerId: string,
		resolvedModelId: string | undefined,
		assistantId: string,
		options?: { useRagContext?: boolean; includeActiveNote?: boolean },
		signal?: AbortSignal,
	): Promise<void> {
		const reqStart = Date.now();
		const { chat, rag, connections } = this.plugin.settings;
		const providerConfig = connections.providers.find(p => p.id === providerId);

		// ── 4. 프로바이더 검증 ────────────────────────────────────────────────
		if (!providerConfig || !providerConfig.isVerified) {
			throw new Error(t('settings.translation.noValidModel'));
		}
		if (!resolvedModelId) {
			throw new Error(t('settings.translation.noValidModel'));
		}

		// 현재 store의 메시지 중 방금 추가한 user/assistant를 id로 제외
		const allMessages = getMessages();
		// 마지막 2개 메시지(user, assistant)를 제외한 히스토리 계산
		const chatHistory = allMessages.slice(0, -2);

		// ── 5. 컨텍스트 & LLM 메시지 구성 ─────────────────────────────────
		const ctx = await buildLlmContext(
			this.plugin,
			userText,
			updatedAttachments,
			chatHistory,
			providerConfig,
			resolvedModelId,
			chat,
			rag,
			connections.ragEnabled,
			options?.useRagContext,
			assistantId,
			signal,
		);

		// ── 6. LLM 호출 ────────────────────────────────────────────────────
		const { fullResponse, tokenUsage, hasTokenLimitBeenHit } =
			await executeLlmCall(
				this.plugin,
				ctx,
				providerConfig,
				resolvedModelId,
				chat,
				signal,
				assistantId
			);

		// ── 7. 응답 후처리 ──────────────────────────────────────────────────
		handleLlmResponse(assistantId, fullResponse, tokenUsage, hasTokenLimitBeenHit);

		// ── 7.5. 자동 요약 (백그라운드) ───────────────────────────────────────────
		if (chat.memoryMethod === 'auto_summary') {
			triggerAutoSummarization(this.plugin, providerConfig, resolvedModelId, chat.contextWindowTurns).catch((e: unknown) => {
				debugLogger.logError('auto_summary', e instanceof Error ? e : new Error(String(e)));
			});
		}

		// ── 8. 디버그: LLM 요청/응답 로그 ─────────────────────────────────
		const systemMessage = ctx.llmMessages.find(m => m.role === 'system');
		const systemPromptText = typeof systemMessage?.content === 'string' 
			? systemMessage.content 
			: (systemMessage?.content ? JSON.stringify(systemMessage.content) : '');

		const requestId = debugLogger.logRequest({
			provider: providerConfig.type,
			model: resolvedModelId,
			temperature: chat.temperature,
			maxTokens: chat.maxOutputTokens,
			stream: chat.streaming,
			systemPrompt: systemPromptText,
			messages: ctx.llmMessages.map(m => ({
				role: m.role,
				content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
			})),
			...(ctx.ragChunksForLog ? { ragChunks: ctx.ragChunksForLog } : {}),
		});
		debugLogger.logResponse(requestId, {
			model: resolvedModelId,
			content: fullResponse,
			durationMs: Date.now() - reqStart,
			usage: tokenUsage,
		});
	}

	/**
	 * 특정 사용자의 메시지를 수정하고, 그 이후의 대화 기록을 잘라낸 뒤 다시 전송합니다.
	 */
	async editMessageAndResend(
		messageId: string,
		newContent: string,
		providerId: string,
		modelId: string,
		options: { useRagContext?: boolean; includeActiveNote?: boolean } | undefined,
		signal?: AbortSignal,
	): Promise<void> {
		const msgs = getMessages();
		const targetIndex = msgs.findIndex((m) => m.id === messageId);
		if (targetIndex === -1) return;

		const targetMsg = msgs[targetIndex];
		const attachments = targetMsg.attachments || [];

		messages.set(msgs.slice(0, targetIndex));

		await this.sendMessage(newContent, attachments, providerId, modelId, options, signal);
	}

	// ─── History Methods (Delegated to ChatHistoryController) ─────────────

	async saveHistory(providerId: string, modelId: string): Promise<void> {
		if (this._isSaving) return;
		this._isSaving = true;
		try {
			await this.history.saveHistory(providerId, modelId);
		} finally {
			this._isSaving = false;
		}
	}

	async fetchSessions(): Promise<ChatSession[]> {
		return this.history.fetchSessions();
	}

	async restoreSession(sessionId: string): Promise<boolean> {
		return this.history.restoreSession(sessionId);
	}

	async removeSession(sessionId: string): Promise<boolean> {
		return this.history.removeSession(sessionId);
	}

	/** 수동 컨텍스트 압축 (모든 메모리 모드에서 동작). */
	async compressContext(providerId: string, modelId: string): Promise<import('./utils/summarizationHelper').SummarizeResult> {
		const providerConfig = this.plugin.settings.connections.providers.find(p => p.id === providerId);
		if (!providerConfig) return { status: 'error' };
		const { summarizeConversation } = await import('./utils/summarizationHelper');
		return summarizeConversation(this.plugin, providerConfig, modelId);
	}

	/** 구독 해제 및 타이머 정리. ChatView가 unload될 때 호출할 것. */
	destroy(): void {
		this._unsubMessages?.();
		this._unsubMessages = null;
		if (this.autoSaveTimeout) {
			window.clearTimeout(this.autoSaveTimeout);
			this.autoSaveTimeout = null;
		}
	}
}