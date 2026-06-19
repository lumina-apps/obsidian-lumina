/**
 * Chat 도메인 메인 컨트롤러.
 * UI → controller → chatStore 액션으로 상태를 직접 관리하며,
 * ChatPanel은 $messages/$isLoading 구독으로 반응형 렌더링한다.
 */

import { Notice, type App } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import type LuminaPlugin from '../../main';
import { createProvider, isLocalProvider } from '../../core/llm-providers/index';
import { formatLlmError } from '../../shared/utils/llmErrorFormatter';
import { buildMessages } from './promptBuilder';
import { VISION_UNSUPPORTED_PROVIDERS, PROVIDER_LABELS } from '../../shared/types/settings.types';
import {
	addMessage,
	appendChunk,
	setMessageStreaming,
	setMessageError,
	setMessageTokenUsage,
	syncMessageContent,
	isLoading,
	getMessages,
	messages,
	setSession,
	currentSessionId,
	currentSessionTitle,
	sessionSummary,
	summaryUpToMessageId,
	resetChat,
	setMessageRagStep,
} from '../../core/store/chatStore';
import { get } from 'svelte/store';
import { indexingState } from '../../core/store/ragStore';
import { saveSession, generateTitle, generateTitleWithLLM, loadSessionsList, loadSession, deleteSession } from './history';
import type { UIChatMessage, ChatSession, ContextAttachment } from '../../shared/types/chat.types';
import type { ChatOptions, ChatMessage, ToolDefinition, TokenUsage } from '../../shared/types/llm.types';
import type { LLMProviderConfig } from '../../shared/types/settings.types';
import { debugLogger } from '../../shared/debugLogger';
import type { RagChunkMeta } from '../../shared/types/debug.types';
import { ChatAttachmentHandler } from './utils/ChatAttachmentHandler';
import { calculateEstimatedCost } from '../../shared/pricing';
import { runAgentLoop, isTokenLimitReached } from './agentLoop';
import { resolveRagSearchFlag, performRagSearch } from './utils/ragSearchHelper';
import { collectMcpTools, injectToolPrompts } from './utils/mcpToolHelper';
import { injectMultimodalImages } from './utils/multimodalHelper';
import { triggerAutoSummarization } from './utils/summarizationHelper';

// ─── Internal types ───────────────────────────────────────────────────────────

/** resolveContext() → executeLlmCall() 간 전달용 컨텍스트 번들 */
interface ResolvedContext {
	llmMessages: ChatMessage[];
	ragChunksForLog: RagChunkMeta[] | undefined;
	useTextTools: boolean;
	mcpTools: ToolDefinition[];
	toolServerMap: Record<string, string>;
}

// ─── ChatController ───────────────────────────────────────────────────────────

export class ChatController {
	private app: App;
	private plugin: LuminaPlugin;

	constructor(plugin: LuminaPlugin) {
		this.app = plugin.app;
		this.plugin = plugin;
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
		const { chat, rag, connections } = this.plugin.settings;

		const providerConfig = connections.providers.find(p => p.id === providerId);

		// ── 1. 사용자 메시지를 store에 추가 ──────────────────────────────────
		const updatedAttachments = await this.resolveAttachmentsWithActiveNote(
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
		const resolvedModelId = this.resolveModelId(providerConfig, modelId);
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
			// ── 4. 프로바이더 검증 ────────────────────────────────────────────────
			if (!providerConfig || !providerConfig.isVerified) {
				throw new Error(t('settings.translation.noValidModel'));
			}
			if (!resolvedModelId) {
				throw new Error(t('settings.translation.noValidModel'));
			}

			// 현재 store의 메시지 중 방금 추가한 user/assistant를 id로 제외
			const allMessages = getMessages();
			const history = allMessages.filter(
				m => m.id !== userMsg.id && m.id !== assistantId,
			);

			// ── 5. 컨텍스트 & LLM 메시지 구성 ─────────────────────────────────
			const ctx = await this.resolveContext(
				userText,
				updatedAttachments,
				history,
				providerConfig,
				resolvedModelId,
				chat,
				rag,
				connections.ragEnabled,
				options?.useRagContext,
				assistantId,
			);

			// ── 6. LLM 호출 ────────────────────────────────────────────────────
			const { fullResponse, tokenUsage, hasTokenLimitBeenHit } =
				await this.executeLlmCall(ctx, providerConfig, resolvedModelId, chat, signal, assistantId);

			// ── 7. 응답 후처리 ──────────────────────────────────────────────────
			this.finalizeResponse(assistantId, fullResponse, tokenUsage, hasTokenLimitBeenHit, resolvedModelId);

			// ── 7.5. 자동 요약 (백그라운드) ───────────────────────────────────────────
			if (chat.memoryMethod === 'auto_summary') {
				// Fire and forget (don't await)
				triggerAutoSummarization(this.plugin, providerConfig, resolvedModelId, chat.contextWindowTurns).catch((e: unknown) => {
					debugLogger.logError('auto_summary', e as Error);
				});
			}

			// ── 8. 디버그: LLM 요청/응답 로그 ─────────────────────────────────
			const activePreset = chat.systemPrompts.find(p => p.id === chat.activeSystemPromptId);
			const requestId = debugLogger.logRequest({
				provider: providerConfig.type,
				model: resolvedModelId,
				temperature: chat.temperature,
				maxTokens: chat.maxOutputTokens,
				stream: chat.streaming,
				systemPrompt: activePreset?.content ?? '',
				messages: ctx.llmMessages.map(m => ({
					role: m.role,
					content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
				})),
				...(ctx.ragChunksForLog ? { ragChunks: ctx.ragChunksForLog } : {}),
			});
			debugLogger.logResponse(requestId, {
				model: resolvedModelId,
				content: fullResponse,
				durationMs: 0,
				usage: tokenUsage,
			});
		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') {
				setMessageStreaming(assistantId, false);
			} else {
				const friendlyMsg = formatLlmError(err);
				setMessageError(assistantId, friendlyMsg);
				debugLogger.logError('llm', err as Error);
			}
			throw err;
		} finally {
			isLoading.set(false);
		}
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

	/**
	 * 현재 store 상태를 기반으로 히스토리를 저장합니다.
	 * autoSaveHistory 설정이 꺼져있으면 무시.
	 */
	async saveHistory(providerId: string, modelId: string): Promise<void> {
		const { chat } = this.plugin.settings;
		if (!chat.autoSaveHistory) return;

		const msgs = getMessages();
		if (msgs.length === 0) return;

		const currentId = get(currentSessionId);
		const newId = currentId || crypto.randomUUID();

		let title = get(currentSessionTitle);
		if (!title) {
			const { taskProviderId, taskModelId, providers } = this.plugin.settings.connections;
			if (taskProviderId && taskModelId) {
				const providerConfig = providers.find(p => p.id === taskProviderId);
				if (providerConfig) {
					title = await generateTitleWithLLM(msgs, providerConfig, taskModelId, this.plugin.settings);
					currentSessionTitle.set(title);
				} else {
					title = generateTitle(msgs);
				}
			} else {
				title = generateTitle(msgs);
			}
		}

		const session: ChatSession = {
			id: newId,
			title,
			messages: msgs,
			createdAt: msgs[0].timestamp,
			updatedAt: Date.now(),
			providerId,
			modelId,
			sessionSummary: get(sessionSummary),
			summaryUpToMessageId: get(summaryUpToMessageId),
		};

		try {
			await saveSession(this.app, session, chat.historyPath);
			if (!currentId) {
				currentSessionId.set(newId);
			}
		} catch (e) {
			new Notice(t('settings.chat.history.saveFail', { error: (e as Error).message }));
		}
	}

	/** 히스토리 세션 목록을 반환합니다. */
	async fetchSessions(): Promise<ChatSession[]> {
		return loadSessionsList(this.app, this.plugin.settings.chat.historyPath);
	}

	/** 특정 세션을 불러와 현재 대화창을 덮어씁니다. */
	async restoreSession(sessionId: string): Promise<boolean> {
		const session = await loadSession(this.app, sessionId, this.plugin.settings.chat.historyPath);
		if (session) {
			setSession(session);
			return true;
		}
		new Notice(t('settings.chat.history.loadFail'));
		return false;
	}

	/** 특정 세션을 삭제합니다. */
	async removeSession(sessionId: string): Promise<boolean> {
		const success = await deleteSession(this.app, sessionId, this.plugin.settings.chat.historyPath);
		if (success) {
			const currentId = get(currentSessionId);
			if (currentId === sessionId) {
				resetChat();
			}
			new Notice(t('settings.chat.history.deleteSuccess'));
		} else {
			new Notice(t('settings.chat.history.deleteFail'));
		}
		return success;
	}

	// ─── Private helpers ─────────────────────────────────────────────────────

	/**
	 * 프로바이더 설정에서 유효한 모델 ID를 결정한다.
	 * fallback: modelId → availableModels[0] → ''
	 */
	private resolveModelId(
		providerConfig: LLMProviderConfig | undefined,
		modelId: string,
	): string {
		if (!providerConfig?.isVerified) return '';
		return modelId || providerConfig.availableModels[0] || '';
	}

	/**
	 * includeActiveNote가 활성화된 경우 attachments에 active_note를 추가한다.
	 * 이미 포함된 경우 중복 추가하지 않는다.
	 */
	private async resolveAttachmentsWithActiveNote(
		attachments: ContextAttachment[],
		includeActiveNote: boolean,
	): Promise<ContextAttachment[]> {
		if (!includeActiveNote) return [...attachments];

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return [...attachments];

		const alreadyIncluded = attachments.some(
			att => att.type === 'active_note' || (att.type === 'file' && att.path === activeFile.path),
		);
		if (alreadyIncluded) return [...attachments];

		return [
			...attachments,
			{
				type: 'active_note',
				path: activeFile.path,
				name: t('settings.chat.context.activeNote', { name: activeFile.basename }),
			},
		];
	}

	/**
	 * 컨텍스트(첨부파일 + RAG)와 LLM 메시지를 구성한다.
	 * attachmentContext 생성, RAG 검색, 프롬프트 빌드, 툴/멀티모달 주입까지 일괄 처리.
	 */
	private async resolveContext(
		userText: string,
		updatedAttachments: ContextAttachment[],
		history: UIChatMessage[],
		providerConfig: LLMProviderConfig,
		resolvedModelId: string,
		chat: LuminaPlugin['settings']['chat'],
		rag: LuminaPlugin['settings']['rag'],
		ragEnabled: boolean,
		useRagContext: boolean | undefined,
		assistantId: string,
	): Promise<ResolvedContext> {
		// 첨부파일 컨텍스트 빌드
		const { attachmentContext, multimodalImages } =
			await ChatAttachmentHandler.buildAttachmentContext(this.app, updatedAttachments, this.plugin);

		let ragContext: string | undefined = attachmentContext || undefined;
		let ragChunksForLog: RagChunkMeta[] | undefined;

		// RAG 벡터 검색
		const shouldSearchRag = resolveRagSearchFlag({
			ragEnabled,
			dataScope: rag.dataScope,
			useRagContext,
		});

		if (shouldSearchRag && this.plugin.indexer && get(indexingState).status === 'ready') {
			const result = await performRagSearch({
				userText,
				rag,
				connections: this.plugin.settings.connections,
				existingContext: ragContext,
				assistantId,
				indexer: this.plugin.indexer,
				activeFilePath: this.app.workspace.getActiveFile()?.path ?? null,
			});
			ragContext = result.ragContext;
			ragChunksForLog = result.ragChunksForLog;
		}

		// MCP 툴 수집
		const { mcp } = this.plugin.settings;
		const { mcpTools, toolServerMap } = collectMcpTools({
			agentEnabled: chat.agentEnabled,
			clientToolsEnabled: mcp.clientToolsEnabled,
			mcpManager: this.plugin.mcpManager ?? null,
		});

		// 프롬프트 빌드
		const useLocal = isLocalProvider(providerConfig.type ?? 'custom');
		const modelName = resolvedModelId.toLowerCase();
		const isReasoningModel = modelName.includes('reasoner') || modelName.includes('r1');
		const useTextTools = useLocal || isReasoningModel;

		let llmMessages: ChatMessage[] = buildMessages(history, userText, { 
			chat, 
			ragContext,
			sessionSummary: get(sessionSummary),
			summaryUpToMessageId: get(summaryUpToMessageId)
		});

		// 툴 사용 지침 주입
		llmMessages = injectToolPrompts(llmMessages, mcpTools, useTextTools);

		// 멀티모달 이미지 주입
		if (multimodalImages.length > 0) {
			if (VISION_UNSUPPORTED_PROVIDERS.has(providerConfig.type)) {
				const providerLabel = PROVIDER_LABELS[providerConfig.type];
				throw new Error(t('settings.providerErrors.visionNotSupported', { provider: providerLabel }));
			}
			llmMessages = injectMultimodalImages(llmMessages, multimodalImages);
		}

		return { llmMessages, ragChunksForLog, useTextTools, mcpTools, toolServerMap };
	}

	/**
	 * LLM 호출을 실행한다.
	 * streaming / non-streaming / agent-loop 분기를 처리한다.
	 */
	private async executeLlmCall(
		ctx: ResolvedContext,
		providerConfig: LLMProviderConfig,
		resolvedModelId: string,
		chat: LuminaPlugin['settings']['chat'],
		signal: AbortSignal | undefined,
		assistantId: string,
	): Promise<{
		fullResponse: string;
		tokenUsage: TokenUsage | undefined;
		hasTokenLimitBeenHit: boolean;
	}> {
		const { llmMessages, useTextTools, mcpTools, toolServerMap } = ctx;

		const provider = createProvider(providerConfig);

		const chatOptions: ChatOptions = {
			model: resolvedModelId,
			temperature: chat.temperature,
			maxOutputTokens: chat.maxOutputTokens,
			signal,
			tools: (!useTextTools && mcpTools.length > 0) ? mcpTools : undefined,
			stop: (useTextTools && mcpTools.length > 0) ? [] : undefined,
		};

		const hasTools = mcpTools.length > 0;
		let fullResponse = '';
		let tokenUsage: TokenUsage | undefined;
		let hasTokenLimitBeenHit = false;

		debugLogger.logMcp('Loop Start', `MCP 툴 루프 시작`, {
			hasTools,
			streaming: chat.streaming,
			toolsCount: mcpTools.length,
			useTextTools,
			method: useTextTools ? '텍스트' : 'bindTools',
		});

		if (hasTools) {
			// ── Tool calling 루프 ──────────────────────────────────────────
			const result = await runAgentLoop({
				assistantId,
				messagesForLLM: [...llmMessages],
				chatOptions,
				provider,
				chatSettings: chat,
				mcpManager: this.plugin.mcpManager ?? null,
				toolServerMap,
				useTextTools,
				signal,
			});
			fullResponse = result.fullResponse;
			tokenUsage = result.tokenUsage;
			hasTokenLimitBeenHit = result.hasTokenLimitBeenHit;
		} else if (chat.streaming) {
			// ── Streaming (no tools) ──────────────────────────────────────
			const streamRes = await provider.stream(llmMessages, chatOptions, (chunk) => {
				fullResponse += chunk;
				appendChunk(assistantId, chunk);
			});
			tokenUsage = streamRes?.usage;
			hasTokenLimitBeenHit = isTokenLimitReached(streamRes?.finishReason);
		} else {
			// ── Non-streaming (no tools) ──────────────────────────────────
			const response = await provider.chat(llmMessages, chatOptions);
			fullResponse = response.content;
			tokenUsage = response?.usage;
			appendChunk(assistantId, fullResponse);
			hasTokenLimitBeenHit = isTokenLimitReached(response.finishReason);
		}

		return { fullResponse, tokenUsage, hasTokenLimitBeenHit };
	}

	/**
	 * LLM 응답 후처리: 토큰 사용량 기록, 빈 응답/토큰 한도 처리, 스트리밍 완료 표시.
	 */
	private finalizeResponse(
		assistantId: string,
		fullResponse: string,
		tokenUsage: TokenUsage | undefined,
		hasTokenLimitBeenHit: boolean,
		resolvedModelId: string,
	): void {
		// 토큰 사용량 기록
		if (tokenUsage) {
			const estimatedCost = calculateEstimatedCost(
				resolvedModelId,
				tokenUsage.inputTokens,
				tokenUsage.outputTokens,
			);
			setMessageTokenUsage(assistantId, {
				...tokenUsage,
				...(estimatedCost !== undefined ? { estimatedCost } : {}),
			});
		}

		// 생각 과정(<think>...</think>) 제거
		let finalContent = fullResponse.replace(/<think>[\s\S]*?<\/think>\n*/gi, '').trim();

		// 빈 응답 / 토큰 한도 처리
		if (!finalContent) {
			finalContent = hasTokenLimitBeenHit
				? t('uiMessages.emptyResponseTokenLimit')
				: t('settings.chat.emptyResponseFallback');
		} else if (hasTokenLimitBeenHit) {
			finalContent += '\n\n' + t('uiMessages.tokenLimitHitWarning');
		}
		
		syncMessageContent(assistantId, finalContent);
		setMessageStreaming(assistantId, false);
		setMessageRagStep(assistantId, null);
	}
}