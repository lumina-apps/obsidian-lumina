/**
 * chatController.ts
 *
 * Chat 도메인의 메인 컨트롤러.
 * UI → controller → store 흐름:
 *   ChatPanel이 sendMessage() 호출
 *   → controller가 chatStore 액션으로 직접 상태 업데이트
 *   → ChatPanel은 $messages/$isLoading 구독으로 반응형 렌더링
 *
 * 콜백이 필요 없으므로 ChatPanel이 단순해짐.
 *
 * 리팩토링 내역:
 *   - 첨부파일 처리 → ChatAttachmentHandler.buildAttachmentContext()로 위임
 *   - MCP 툴 루프 → agentLoop.ts의 runAgentLoop()로 위임
 *   - isTokenLimit 중복 → isTokenLimitReached() 헬퍼 공유 사용
 *   - RAG shouldSearchRag 결정 → resolveRagSearchFlag() 순수 함수로 추출
 *   - buildTextToolPrompt, parseTextToolCalls → textToolParser.ts로 분리
 */

import { Notice, type App } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import type LuminaPlugin from '../../main';
import { createProvider, isLocalProvider } from '../../core/llm-providers/index';
import { formatLlmError } from '../../core/llm-providers/utils';
import { buildMessages } from './promptBuilder';
import { searchVault, formatRagContext } from '../rag/search';
import {
	addMessage,
	appendChunk,
	setMessageStreaming,
	setMessageError,
	setMessageSources,
	setMessageTokenUsage,
	syncMessageContent,
	isLoading,
	getMessages,
	messages,
	setSession,
	currentSessionId,
	currentSessionTitle,
	resetChat,
} from '../../core/store/chatStore';
import { get } from 'svelte/store';
import { indexingState } from '../../core/store/ragStore';
import { saveSession, generateTitle, loadSessionsList, loadSession, deleteSession } from './history';
import type { UIChatMessage, ChatSession, ContextAttachment } from '../../shared/types/chat.types';
import type { ChatOptions, ChatMessage, ToolDefinition, MultiModalContent } from '../../shared/types/llm.types';
import type { McpTool } from '../../core/mcp/mcpClient';
import { debugLogger as originalDebugLogger } from '../../shared/debugLogger';

interface IDebugLogger {
	logMcp(action: string, message: string, data?: unknown): void;
	logRequest(params: unknown): string;
	logResponse(requestId: string, params: unknown): void;
	logError(domain: string, error: unknown): void;
	logSystem(event: string, message: string, meta?: unknown): void;
	logRagSearch(params: unknown): void;
}
const debugLogger = originalDebugLogger as unknown as IDebugLogger;
import type { RagChunkMeta } from '../../shared/types/debug.types';
import { ChatAttachmentHandler } from './utils/ChatAttachmentHandler';
import { calculateEstimatedCost } from '../../shared/pricing';
import { runAgentLoop, isTokenLimitReached } from './agentLoop';
import { buildTextToolPrompt } from './utils/textToolParser';
import type { TokenUsage } from '../../shared/types/llm.types';
import type { RagSettings } from '../../core/settings/settings.types';



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
	 *
	 * @param userText     사용자 입력 텍스트
	 * @param attachments  컨텍스트 첨부파일 목록
	 * @param providerId   사용할 프로바이더 ID
	 * @param modelId      사용할 모델 ID
	 * @param options      RAG/활성 노트 포함 여부
	 * @param signal       AbortSignal (취소용)
	 */
	async sendMessage(
		userText: string,
		attachments: ContextAttachment[],
		providerId: string,
		modelId: string,
		options?: { useRagContext?: boolean; includeActiveNote?: boolean },
		signal?: AbortSignal,
	): Promise<void> {
		const { connections, chat, rag } = this.plugin.settings;

		const providerConfig = connections.providers.find(p => p.id === providerId);
		const resolvedModelId = providerConfig?.isVerified ? (modelId || providerConfig.availableModels[0] || '') : '';

		// 활성 노트를 attachments에 추가할지 판단
		const updatedAttachments = await this.resolveAttachmentsWithActiveNote(
			attachments,
			options?.includeActiveNote ?? rag.includeActiveNote,
		);

		// ── 1. 사용자 메시지를 store에 추가 ──────────────────────────────────
		const userMsg: UIChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: userText,
			attachments: updatedAttachments,
			isStreaming: false,
			timestamp: Date.now(),
		};
		addMessage(userMsg);

		// ── 2. 어시스턴트 placeholder 추가 ──────────────────────────────────
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

			// ── 5. 컨텍스트 구성 (첨부파일 + 활성 노트 + RAG 검색) ──────────────────────
			const { attachmentContext, multimodalImages } =
				await ChatAttachmentHandler.buildAttachmentContext(this.app, updatedAttachments, this.plugin);

			let ragContext: string | undefined = attachmentContext || undefined;

			// 활성 노트 컨텍스트 (includeActiveNote 설정)
			// attachments에 active_note가 이미 있다면 이중 포함을 방지하기 위해 건너뜁니다.
			const hasActiveNoteInAttachments = updatedAttachments.some(att => att.type === 'active_note');
			if (!hasActiveNoteInAttachments) {
				const activeNoteText = await this.getActiveNoteContext(options?.includeActiveNote);
				if (activeNoteText) {
					const txt = `[${t('settings.chat.context.activeNotePrompt')}]\n${activeNoteText}`;
					ragContext = ragContext ? `${ragContext}\n\n${txt}` : txt;
				}
			}

			// RAG 벡터 검색
			let ragChunksForLog: RagChunkMeta[] | undefined;
			const shouldSearchRag = resolveRagSearchFlag({
				ragEnabled: connections.ragEnabled,
				dataScope: rag.dataScope,
				useRagContext: options?.useRagContext,
			});

			if (shouldSearchRag && this.plugin.indexer && get(indexingState).status === 'ready') {
				({ ragContext, ragChunksForLog } = await this.performRagSearch(
					userText,
					rag,
					ragContext,
					assistantId,
				));
			}

			// ── 6. MCP 툴 목록 가져오기 ─────────────────────────────────────────
			const { mcpTools, toolServerMap } = this.collectMcpTools(chat.agentEnabled);

			// ── 7. 프롬프트 빌드 & LLM 대화 메시지 구성 ──────────────────────────
			const useLocal = isLocalProvider(providerConfig?.type ?? 'custom');
			const modelName = (modelId || providerConfig?.availableModels?.[0] || '').toLowerCase();
			const isReasoningModel = modelName.includes('reasoner') || modelName.includes('r1');
			const useTextTools = useLocal || isReasoningModel;

			let llmMessages: ChatMessage[] = buildMessages(history, userText, { chat, ragContext });

			// 툴 사용 지침 주입
			llmMessages = this.injectToolPrompts(llmMessages, mcpTools, useTextTools);

			// 멀티모달 이미지 주입
			if (multimodalImages.length > 0) {
				llmMessages = injectMultimodalImages(llmMessages, multimodalImages);
			}

			// ── 8. LLM 호출 ────────────────────────────────────────────────────
			const provider = createProvider(providerConfig);

			const chatOptions: ChatOptions = {
				model: modelId || providerConfig.availableModels[0] || '',
				temperature: chat.temperature,
				maxOutputTokens: chat.maxOutputTokens,
				signal,
				tools: (!useTextTools && mcpTools.length > 0) ? mcpTools : undefined,
				stop: (useTextTools && mcpTools.length > 0) ? [] : undefined,
			};

			// 디버그: LLM 요청 로그
			const activePreset = chat.systemPrompts.find(p => p.id === chat.activeSystemPromptId);
			const requestId = debugLogger.logRequest({
				provider: providerConfig.type,
				model: chatOptions.model,
				temperature: chat.temperature,
				maxTokens: chat.maxOutputTokens,
				stream: chat.streaming,
				systemPrompt: activePreset?.content ?? '',
				messages: llmMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
				...(ragChunksForLog ? { ragChunks: ragChunksForLog } : {}),
			});

			const hasTools = mcpTools.length > 0;
			let fullResponse = '';
			let tokenUsage: TokenUsage | undefined;
			let hasTokenLimitBeenHit = false;

			debugLogger.logMcp('Loop Start', `MCP 툴 루프 시작`, { hasTools, streaming: chat.streaming, toolsCount: mcpTools.length, useTextTools, method: useTextTools ? '텍스트' : 'bindTools' });

			if (hasTools) {
				// ── Tool calling 루프 ──────────────────────────────────────────
				({ fullResponse, tokenUsage, hasTokenLimitBeenHit } = await runAgentLoop({
					assistantId,
					messagesForLLM: [...llmMessages],
					chatOptions,
					provider,
					chatSettings: chat,
					mcpManager: this.plugin.mcpManager ?? null,
					toolServerMap,
					useTextTools,
					signal,
				}));
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

			// ── 토큰 사용량 기록 ──────────────────────────────────────────────
			if (tokenUsage) {
				const estimatedCost = calculateEstimatedCost(chatOptions.model, tokenUsage.inputTokens, tokenUsage.outputTokens);
				setMessageTokenUsage(assistantId, {
					...tokenUsage,
					...(estimatedCost !== undefined ? { estimatedCost } : {}),
				});
			}

			// ── 빈 응답 / 토큰 한도 처리 ─────────────────────────────────────
			if (!fullResponse.trim()) {
				fullResponse = hasTokenLimitBeenHit
					? t('uiMessages.emptyResponseTokenLimit')
					: t('settings.chat.emptyResponseFallback');
				appendChunk(assistantId, fullResponse);
			} else if (hasTokenLimitBeenHit) {
				fullResponse += t('uiMessages.tokenLimitHitWarning');
				syncMessageContent(assistantId, fullResponse);
			}

			// 디버그: LLM 응답 로그
			debugLogger.logResponse(requestId, {
				model: chatOptions.model,
				content: fullResponse,
				durationMs: 0,
				usage: tokenUsage,
			});

			// ── 9. 스트리밍 완료 표시 ────────────────────────────────────────
			setMessageStreaming(assistantId, false);
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
			title = generateTitle(msgs);
		}

		const session: ChatSession = {
			id: newId,
			title,
			messages: msgs,
			createdAt: msgs[0].timestamp,
			updatedAt: Date.now(),
			providerId,
			modelId,
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
			setSession(session.id, session.messages, session.title);
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

	/**
	 * 활성 노트 파일 내용을 읽어 반환합니다.
	 * includeActiveNote 설정이 꺼져있으면 null 반환.
	 */
	async getActiveNoteContext(useActiveNote?: boolean): Promise<string | null> {
		const shouldInclude = useActiveNote ?? this.plugin.settings.rag.includeActiveNote;
		if (!shouldInclude) return null;
		const file = this.app.workspace.getActiveFile();
		if (!file) return null;
		try {
			return await this.app.vault.read(file);
		} catch {
			return null;
		}
	}

	// ─── Private helpers ─────────────────────────────────────────────────────

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
	 * RAG 벡터 검색을 수행하고 결과를 ragContext에 병합한다.
	 * 검색 결과가 있으면 assistantId 메시지에 RAG 소스도 설정한다.
	 */
	private async performRagSearch(
		userText: string,
		rag: RagSettings,
		existingContext: string | undefined,
		assistantId: string,
	): Promise<{ ragContext: string | undefined; ragChunksForLog: RagChunkMeta[] | undefined }> {
		try {
			let chunksToSearch = this.plugin.indexer!.indexedChunks;

			if (rag.dataScope === 'active-note') {
				const activeFile = this.app.workspace.getActiveFile();
				chunksToSearch = activeFile
					? chunksToSearch.filter(c => c.path === activeFile.path)
					: [];
			}

			const ragStart = Date.now();
			const results = await searchVault(
				userText,
				chunksToSearch,
				(texts) => this.plugin.indexer!.embed(texts),
				rag.topK,
			);

			if (results.length === 0) {
				return { ragContext: existingContext, ragChunksForLog: undefined };
			}

			const ragText = formatRagContext(results);
			const ragContext = existingContext
				? `${existingContext}\n\n---\n\n${ragText}`
				: ragText;

			const ragChunksForLog: RagChunkMeta[] = results.map((r) => ({
				filePath: r.chunk?.path ?? '',
				score: r.score ?? 0,
				preview: (r.chunk?.text ?? '').slice(0, 200),
				fullContent: r.chunk?.text ?? '',
			}));

			debugLogger.logRagSearch({
				query: userText,
				topK: rag.topK,
				chunks: ragChunksForLog,
				durationMs: Date.now() - ragStart,
			});

			const uniquePaths = Array.from(new Set(ragChunksForLog.map(c => c.filePath).filter(Boolean)));
			if (uniquePaths.length > 0) {
				setMessageSources(assistantId, uniquePaths.map(p => ({ filePath: p })));
			}

			return { ragContext, ragChunksForLog };
		} catch (err) {
			debugLogger.logError('rag', err instanceof Error ? err : new Error(`RAG 검색 실패: ${err}`));
			return { ragContext: existingContext, ragChunksForLog: undefined };
		}
	}

	/**
	 * MCP 툴 목록을 수집하고 toolServerMap을 구성한다.
	 * agentEnabled가 false이거나 mcpManager가 없으면 빈 배열을 반환한다.
	 */
	private collectMcpTools(agentEnabled: boolean): {
		mcpTools: ToolDefinition[];
		toolServerMap: Record<string, string>;
	} {
		const mcpTools: ToolDefinition[] = [];
		const toolServerMap: Record<string, string> = {};

		const { mcp } = this.plugin.settings;
		if (!agentEnabled || !this.plugin.mcpManager || !mcp.clientToolsEnabled) {
			debugLogger.logMcp('Tools Init', 'MCP 툴 비활성화됨 (clientToolsEnabled=false 또는 mcpManager 없음)');
			return { mcpTools, toolServerMap };
		}

		const rawTools = this.plugin.mcpManager.getAllTools();
		debugLogger.logMcp('Tools Init', `MCP 툴 ${rawTools.length}개 수집`, rawTools.map((t: McpTool) => t.name));

		for (const tool of rawTools) {
			const schema = tool.inputSchema ?? { type: 'object', properties: {} };
			const properties: Record<string, unknown> & { _serverId?: unknown } = { ...(schema.properties ?? {}) };
			// _serverId를 inputSchema에 숨겨서 LLM이 tool call 시 arguments에 포함하도록 함
			properties._serverId = { type: 'string', description: 'DO NOT FILL - internal use' };
			mcpTools.push({
				name: tool.name,
				description: tool.description ?? '',
				inputSchema: {
					type: 'object',
					properties: properties as Record<string, { type: string; description: string }>,
					required: schema.required ?? [],
				},
			});
			toolServerMap[tool.name] = tool._serverId ?? '';
		}

		return { mcpTools, toolServerMap };
	}

	/**
	 * 모델 타입에 따라 적절한 툴 사용 지침을 system 메시지에 주입한다.
	 * - 로컬/추론 모델: buildTextToolPrompt() 결과를 system 메시지 말미에 추가
	 * - 클라우드 모델: 간략한 tool use instruction 추가
	 */
	private injectToolPrompts(
		llmMessages: ChatMessage[],
		mcpTools: ToolDefinition[],
		useTextTools: boolean,
	): ChatMessage[] {
		if (mcpTools.length === 0) return llmMessages;

		let systemContent = llmMessages.length > 0 && llmMessages[0].role === 'system'
			? (llmMessages[0].content as string)
			: null;

		if (useTextTools) {
			const textToolPrompt = buildTextToolPrompt(mcpTools);
			if (systemContent !== null) {
				llmMessages[0].content = systemContent + textToolPrompt;
			} else {
				llmMessages.unshift({ role: 'system', content: textToolPrompt });
			}
		} else {
			const cloudToolPrompt =
				`\n\n[Tool Use Instruction]\nYou have access to tools. If the user asks you to do something that can be done with a tool (e.g., modifying, writing, appending to, or reading Obsidian notes/files, or running a search), you MUST call the appropriate tool to execute the action. Do not just describe what you would do or output the raw text in the chat; always execute it via tool calling.`;
			if (systemContent !== null) {
				llmMessages[0].content = systemContent + cloudToolPrompt;
			} else {
				llmMessages.unshift({ role: 'system', content: cloudToolPrompt });
			}
		}

		return llmMessages;
	}
}

// ─── 모듈 스코프 순수 함수 ────────────────────────────────────────────────────

/**
 * RAG 검색 수행 여부를 결정하는 순수 함수.
 *
 * 규칙:
 *   - ragEnabled가 false이면 검색하지 않는다.
 *   - useRagContext가 명시적으로 true이면 dataScope 무관하게 검색한다.
 *   - dataScope가 'manual'이고 useRagContext가 명시되지 않았으면 검색하지 않는다.
 *   - 그 외에는 ragEnabled를 따른다.
 */
function resolveRagSearchFlag(opts: {
	ragEnabled: boolean;
	dataScope: string;
	useRagContext?: boolean;
}): boolean {
	const { ragEnabled, dataScope, useRagContext } = opts;
	if (!ragEnabled) return false;
	if (useRagContext === true) return true;
	if (dataScope === 'manual') return false;
	return ragEnabled;
}

/**
 * 멀티모달 이미지를 마지막 user 메시지에 주입한다.
 */
function injectMultimodalImages(llmMessages: ChatMessage[], imageUrls: string[]): ChatMessage[] {
	const lastMsg = llmMessages[llmMessages.length - 1];
	if (!lastMsg || lastMsg.role !== 'user') return llmMessages;

	const multiContent: MultiModalContent[] = [
		{ type: 'text', text: lastMsg.content as string },
		...imageUrls.map(url => ({ type: 'image_url' as const, image_url: { url } })),
	];
	lastMsg.content = multiContent;
	return llmMessages;
}
