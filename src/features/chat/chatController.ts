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
 */

import { Notice, TFile, TFolder, MarkdownView, requestUrl, type App } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import type LuminaPlugin from '../../main';
import { createProvider, isLocalProvider } from '../../core/llm-providers/index';
import { buildMessages } from './promptBuilder';
import { searchVault, formatRagContext } from '../rag/search';
import {
	addMessage,
	appendChunk,
	setMessageStreaming,
	setMessageError,
	setMessageSources,
	setMessageTokenUsage,
	isLoading,
	getMessages,
	setSession,
	messages,
	currentSessionId,
	currentSessionTitle,
	setSessionTitle,
	resetChat,
} from '../../core/store/chatStore';
import { get } from 'svelte/store';
import { indexingState } from '../../core/store/ragStore';
import { saveSession, generateTitle, loadSessionsList, loadSession, deleteSession } from './history';
import type { UIChatMessage, ChatSession, ContextAttachment } from '../../shared/types/chat.types';
import type { ChatOptions, ChatMessage, ToolDefinition, MultiModalContent, ToolCall } from '../../shared/types/llm.types';
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
import type { TokenUsage } from '../../shared/types/llm.types';



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
	 * @param providerId   사용할 프로바이더 ID
	 * @param modelId      사용할 모델 ID
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
		const updatedAttachments = [...attachments];
		const includeActiveNote = options?.includeActiveNote ?? this.plugin.settings.rag.includeActiveNote;
		if (includeActiveNote) {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const exists = updatedAttachments.some(
					att => att.type === 'active_note' || (att.type === 'file' && att.path === activeFile.path)
				);
				if (!exists) {
					updatedAttachments.push({
						type: 'active_note',
						path: activeFile.path,
						name: t('settings.chat.context.activeNote', { name: activeFile.basename }),
					});
				}
			}
		}

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
				throw new Error(
					t('settings.translation.noValidModel'),
				);
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
			let ragContext: string | undefined;
			let attachmentContext = "";

			// 첨부파일 처리
			const multimodalImages: string[] = [];

			for (const att of updatedAttachments) {
				try {
					if (att.type === 'file' || att.type === 'url' || att.type === 'external_file') {
						const parsed = await ChatAttachmentHandler.parseAttachment(this.app, att);
						if (parsed) {
							if (parsed.type === 'image') {
								multimodalImages.push(parsed.content);
							} else {
								attachmentContext += `${parsed.content}\n\n`;
							}
						}
					} else if (att.type === 'folder') {
						const folder = this.app.vault.getAbstractFileByPath(att.path);
						if (folder instanceof TFolder) {
							let folderContent = `[폴더: ${att.name} 내의 파일들]\n`;
							for (const child of folder.children) {
								if (child instanceof TFile && child.extension === 'md') {
									const content = await this.app.vault.read(child);
									folderContent += `--- ${child.basename} ---\n${content}\n\n`;
								}
							}
							attachmentContext += folderContent;
						}
					} else if (att.type === 'selection') {
						const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
						// @ts-ignore
						const selection = activeView?.editor?.getSelection();
						if (selection) {
							attachmentContext += `[${t('uiMessages.qaSelectedText')}]\n${selection}\n\n`;
						}
					} else if (att.type === 'active_note') {
						const activeFile = this.app.workspace.getActiveFile();
						if (activeFile) {
							const content = await this.app.vault.read(activeFile);
							attachmentContext += `[현재 노트: ${activeFile.basename}]\n${content}\n\n`;
						}
					} else if (att.type === 'canvas') {
						const file = this.app.vault.getAbstractFileByPath(att.path);
						if (file instanceof TFile) {
							const content = await this.app.vault.read(file);
							try {
								interface CanvasNode {
									type: string;
									text?: string;
								}
								interface CanvasData {
									nodes?: CanvasNode[];
								}
								const canvasData = JSON.parse(content) as CanvasData;
								let canvasText = `[캔버스 파일: ${att.name}]\n`;
								canvasData.nodes?.forEach((node) => {
									if (node.type === 'text' && node.text) {
										canvasText += `- ${node.text}\n`;
									}
								});
								attachmentContext += canvasText + "\n";
							} catch (e) {
								console.warn("Failed to parse canvas", e);
							}
						}
					} else if (att.type === 'tag') {
						const files = this.app.vault.getMarkdownFiles();
						let tagContent = `[태그: ${att.name} 가 포함된 파일들 (최대 5개)]\n`;
						let count = 0;
						for (const file of files) {
							const cache = this.app.metadataCache.getFileCache(file);
							const tags = cache?.tags;
							const fmTags = cache?.frontmatter?.tags as string[] | undefined;
							const hasTag = (Array.isArray(tags) && tags.some(t => t.tag === att.name)) || (Array.isArray(fmTags) && fmTags.includes(att.name.replace('#', '')));
							if (hasTag) {
								const content = await this.app.vault.read(file);
								tagContent += `--- ${file.basename} ---\n${content}\n\n`;
								count++;
								if (count >= 5) break;
							}
						}
						attachmentContext += tagContent;
					}
				} catch (e) {
					console.warn(`Failed to read attachment: ${att.name}`, e);
				}
			}

			if (attachmentContext) {
				ragContext = attachmentContext;
			}

			// 활성 노트 컨텍스트 (includeActiveNote 설정)
			// 만약 attachments에 active_note가 이미 포함되어 있다면 이중 포함을 방지하기 위해 건너뜁니다.
			const hasActiveNoteInAttachments = updatedAttachments.some(att => att.type === 'active_note');
			const activeNoteText = hasActiveNoteInAttachments
				? null
				: await this.getActiveNoteContext(options?.includeActiveNote);
			if (activeNoteText) {
				const txt = `[현재 활성 노트]\n${activeNoteText}`;
				ragContext = ragContext ? `${ragContext}\n\n${txt}` : txt;
			}

			// RAG 벡터 검색 (ragEnabled + 워커 ready + 인덱서 준비됨)
			let ragChunksForLog: RagChunkMeta[] | undefined;

			let shouldSearchRag = options?.useRagContext ?? connections.ragEnabled;
			if (shouldSearchRag && rag.dataScope === 'manual' && options?.useRagContext !== true) {
				shouldSearchRag = false;
			}

			if (
				shouldSearchRag &&
				connections.ragEnabled &&
				this.plugin.indexer &&
				get(indexingState).status === 'ready'
			) {
				try {
					let chunksToSearch = this.plugin.indexer.indexedChunks;

					if (rag.dataScope === 'active-note') {
						const activeFile = this.app.workspace.getActiveFile();
						if (activeFile) {
							chunksToSearch = chunksToSearch.filter(c => c.path === activeFile.path);
						} else {
							chunksToSearch = [];
						}
					}

					const ragStart = Date.now();
					const results = await searchVault(
						userText,
						chunksToSearch,
						(texts) => this.plugin.indexer!.embed(texts),
						rag.topK,
					);
					if (results.length > 0) {
						const ragText = formatRagContext(results);
						ragContext = ragContext
							? `${ragContext}\n\n---\n\n${ragText}`
							: ragText;

						ragChunksForLog = results.map((r) => ({
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
					}
				} catch (err) {
					debugLogger.logError('rag', err instanceof Error ? err : new Error(`RAG 검색 실패: ${err}`));
				}
			}

			// ── 6. MCP 툴 목록 가져오기 ─────────────────────────────────────────
			const mcpTools: ToolDefinition[] = [];
			const toolServerMap: Record<string, string> = {}; // toolName → serverId
			if (chat.agentEnabled && this.plugin.mcpManager && this.plugin.settings.mcp.clientToolsEnabled) {
				const rawTools = this.plugin.mcpManager.getAllTools();
				debugLogger.logMcp('Tools Init', `MCP 툴 ${rawTools.length}개 수집`, rawTools.map((t: McpTool) => t.name));
				for (const t of rawTools) {
					const schema = t.inputSchema ?? { type: 'object', properties: {} };
					// _serverId를 inputSchema에 숨겨서 LLM이 tool call 시 arguments에 포함하도록 함
					const properties: Record<string, unknown> & { _serverId?: unknown } = { ...(schema.properties ?? {}) };
					properties._serverId = { type: 'string', description: 'DO NOT FILL - internal use' };
					mcpTools.push({
						name: t.name,
						description: t.description ?? '',
						inputSchema: { 
							type: 'object', 
							properties: properties as Record<string, { type: string; description: string }>, 
							required: schema.required ?? [] 
						},
					});
					toolServerMap[t.name] = t._serverId ?? '';
				}
			} else {
				debugLogger.logMcp('Tools Init', 'MCP 툴 비활성화됨 (clientToolsEnabled=false 또는 mcpManager 없음)');
			}

			// ── 7. 프롬프트 빌드 & LLM 대화 메시지 구성 ──────────────────────────
			const useLocal = isLocalProvider(providerConfig?.type ?? 'custom');
			let llmMessages: ChatMessage[] = buildMessages(history, userText, { chat, ragContext });

			// ── 7.5 로컬 모델용 텍스트 기반 툴 프롬프트 주입 ────────────────
			const textToolPrompt = useLocal && mcpTools.length > 0
				? buildTextToolPrompt(mcpTools)
				: '';
			if (textToolPrompt) {
				// system 메시지에 툴 설명 추가
				if (llmMessages.length > 0 && llmMessages[0].role === 'system') {
					llmMessages[0].content = (llmMessages[0].content as string) + textToolPrompt;
				} else {
					llmMessages.unshift({ role: 'system', content: textToolPrompt });
				}
			}

			// 멀티모달 이미지
			if (multimodalImages.length > 0) {
				const lastMsg = llmMessages[llmMessages.length - 1];
				if (lastMsg && lastMsg.role === 'user') {
					const multiContent: MultiModalContent[] = [{ type: 'text', text: lastMsg.content as string }];
					multimodalImages.forEach(imgUrl => {
						multiContent.push({ type: 'image_url', image_url: { url: imgUrl } });
					});
					lastMsg.content = multiContent;
				}
			}

			// ── 8. LLM 호출 (with MCP tool loop) ────────────────────────────────
			const provider = createProvider(providerConfig);

			const chatOptions: ChatOptions = {
				model: modelId || providerConfig.availableModels[0] || '',
				temperature: chat.temperature,
				maxOutputTokens: chat.maxOutputTokens,
				signal,
				// 로컬 모델은 LangChain bindTools 대신 텍스트 기반 파싱 사용
				tools: (!useLocal && mcpTools.length > 0) ? mcpTools : undefined,
				// 텍스트 tool prompt 모드 시 stop 토큰 비활성화 (stop 토큰이 <lumina_tool_call> 태그와 충돌 방지)
				stop: (useLocal && mcpTools.length > 0) ? [] : undefined,
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

			// Tool calling 루프 (MCP 툴이 있을 때만)
			const hasTools = mcpTools.length > 0;
			let fullResponse = '';
			let accumulatedText = '';
			let tokenUsage: TokenUsage | undefined;

			debugLogger.logMcp('Loop Start', `MCP 툴 루프 시작`, { hasTools, streaming: chat.streaming, toolsCount: mcpTools.length, useLocal, method: useLocal ? '텍스트' : 'bindTools' });

			if (hasTools) {
				const maxRounds = chat.agentMaxSteps || 15;
				// ── Non-streaming tool loop ──
				let toolRound = 0;
				let messagesForLLM = [...llmMessages];
				let lastToolCallKeys: string[] = []; // 중복 호출 감지용 (최근 2개 키 저장, 3회 연속 감지)

				while (toolRound < maxRounds) {
					if (signal?.aborted) break;
					toolRound++;

					debugLogger.logMcp('Loop Round', `🔄 툴 루프 라운드 ${toolRound}/${maxRounds} 시작`);

					let currentChunkText = '';
					const rawResponse = await provider.chat(messagesForLLM, chatOptions, (chunk) => {
						if (chat.streaming) {
							// 툴 호출 여부를 아직 모르는 실시간 스트리밍 상태. 일단 UI에 추가함.
							// 추후 툴 호출 텍스트라면 아래에서 UI를 덮어씌워 지워줌.
							currentChunkText += chunk;
							fullResponse = accumulatedText + (accumulatedText && currentChunkText ? '\n\n' : '') + currentChunkText;
							appendChunk(assistantId, chunk);
						}
					});

					// 로컬 모델: 텍스트에서 <lumina_tool_call> 블록 파싱
					let resolvedToolCalls = rawResponse.toolCalls;
					let currentRoundText = rawResponse.content || '';

					if (useLocal && currentRoundText) {
						const parsed = parseTextToolCalls(currentRoundText);
						if (parsed.toolCalls.length > 0) {
							debugLogger.logMcp('Text Parse', `📝 텍스트 tool call 파싱: ${parsed.toolCalls.length}개 발견`, parsed.toolCalls.map(tc => tc.name));
							resolvedToolCalls = parsed.toolCalls;
							currentRoundText = parsed.cleanContent;
						}
					}

					// 현재 라운드의 순수 텍스트(툴 호출 블록 제외)를 누적
					if (currentRoundText.trim()) {
						let textToAdd = currentRoundText;
						// 툴 호출이 있는 중간 라운드라면, 모델이 실수로 일반 텍스트로 말했더라도 모두 추론 과정으로 간주하여 <think>로 강제 래핑
						if (resolvedToolCalls && resolvedToolCalls.length > 0) {
							const stripped = textToAdd.replace(/<\/?think>/gi, '').trim();
							if (stripped) {
								textToAdd = `<think>\n${stripped}\n</think>`;
							} else {
								textToAdd = '';
							}
						}

						if (textToAdd) {
							accumulatedText = accumulatedText ? accumulatedText + '\n\n' + textToAdd : textToAdd;
						}
					}

					// token usage 누적
					if (rawResponse.usage) {
						if (!tokenUsage) {
							tokenUsage = { ...rawResponse.usage };
						} else {
							tokenUsage.inputTokens += rawResponse.usage.inputTokens;
							tokenUsage.outputTokens += rawResponse.usage.outputTokens;
							tokenUsage.totalTokens += rawResponse.usage.totalTokens;
						}
					}

					debugLogger.logMcp('LLM Output', `LLM 응답: content=${currentRoundText?.length ?? 0}자, toolCalls=${resolvedToolCalls?.length ?? 0}개`);

					// tool call이 없으면 텍스트 응답으로 처리하고 종료
					if (!resolvedToolCalls || resolvedToolCalls.length === 0) {
						fullResponse = accumulatedText;
						debugLogger.logMcp('Loop End', `✅ 툴 루프 완료 (라운드 ${toolRound}), 최종 응답: ${fullResponse.length}자`);
						if (!chat.streaming) {
							appendChunk(assistantId, fullResponse);
						} else {
							// 스트리밍 중이라도 최종적으로 UI를 깨끗하게 동기화
							messages.update(msgs => {
								const m = msgs.find(x => x.id === assistantId);
								if (m) m.content = fullResponse;
								return msgs;
							});
						}
						break;
					}

					// 툴 호출이 있는 경우, 스트리밍 시 UI에 툴 호출 코드가 찍힌 것을 지우고 깔끔한 텍스트로 덮어씌움
					if (chat.streaming) {
						fullResponse = accumulatedText;
						messages.update(msgs => {
							const m = msgs.find(x => x.id === assistantId);
							if (m) m.content = fullResponse;
							return msgs;
						});
					}

					// 중복 호출 감지: 동일 툴+동일 인자를 연속 3회 호출 시 강제 종료
					const currentKey = resolvedToolCalls.map((tc: ToolCall) => {
						const args = { ...tc.arguments } as Record<string, unknown> & { _serverId?: unknown };
						delete args._serverId;
						return `${tc.name}:${JSON.stringify(args)}`;
					}).join('|');
					if (lastToolCallKeys.length >= 2 && lastToolCallKeys.every(k => k === currentKey)) {
						debugLogger.logMcp('Loop Error', '⚠️ 동일한 툴 호출 3회 연속 감지, 루프 강제 종료');
						fullResponse = accumulatedText || t('uiMessages.agentRepeatedToolCalls');
						appendChunk(assistantId, fullResponse);
						break;
					}
					lastToolCallKeys.push(currentKey);
					if (lastToolCallKeys.length > 2) lastToolCallKeys.shift();

					debugLogger.logMcp('Tool Requested', `🔧 LLM이 ${resolvedToolCalls.length}개 툴 호출 요청`, resolvedToolCalls.map((tc: ToolCall) => tc.name));

					// assistant의 tool call 메시지를 대화에 추가
					// 로컬 모델은 텍스트 포맷을 유지하도록 <lumina_tool_call> 블록을 content에 포함하고 tool_calls 필드는 비웁니다.
					let assistantContent = currentRoundText || '';

					// DeepSeek API 에러 방지: 클라우드 모델의 경우 루프 내 assistant 응답에서 <think> 블록을 제거.
					// 로컬 모델은 자신의 사고 과정을 문맥으로 유지해야 환각(빈 토큰 무한생성 등)을 방지할 수 있음.
					if (!useLocal) {
						assistantContent = assistantContent.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, '').trim();
					}

					if (useLocal && resolvedToolCalls.length > 0) {
						const toolCallBlocks = resolvedToolCalls.map((tc: ToolCall) => {
							return `<lumina_tool_call>\n${JSON.stringify({ name: tc.name, arguments: tc.arguments })}\n</lumina_tool_call>`;
						}).join('\n\n');
						assistantContent = assistantContent ? `${assistantContent}\n\n${toolCallBlocks}` : toolCallBlocks;
					} else if (!useLocal && !assistantContent) {
						assistantContent = resolvedToolCalls.map((tc: ToolCall) => `Calling tool: ${tc.name}`).join(', ');
					}

					messagesForLLM.push({
						role: 'assistant',
						content: assistantContent,
						tool_calls: useLocal ? undefined : resolvedToolCalls.map((tc: ToolCall) => ({
							id: tc.id,
							name: tc.name,
							arguments: tc.arguments,
						})),
					});

					// 각 tool call 실행
					for (const tc of resolvedToolCalls) {
						try {
							const serverId = (tc.arguments as { _serverId?: string })._serverId;
							// _serverId 제거 후 전달
							const cleanArgs = { ...tc.arguments } as Record<string, unknown> & { _serverId?: unknown };
							delete cleanArgs._serverId;

							const resolvedServerId = serverId || toolServerMap[tc.name];
							debugLogger.logMcp('Tool Execute', `▶️ 툴 실행: ${tc.name}`, { serverId: resolvedServerId, args: cleanArgs });

							let toolResult: unknown;
							if (resolvedServerId && this.plugin.mcpManager) {
								toolResult = await this.plugin.mcpManager.callTool(resolvedServerId, tc.name, cleanArgs);
							} else {
								toolResult = { isError: true, content: [{ type: 'text', text: t('uiMessages.agentToolNotFound', { name: tc.name }) }] };
							}

							// 결과를 text로 변환
							let resultText = '';
							const typedResult = toolResult as { content?: Array<{ text?: string }>, isError?: boolean } | null | undefined;
							if (typedResult?.content) {
								resultText = typedResult.content
									.map((c) => c.text ?? '')
									.join('\n');
							} else if (typeof toolResult === 'string') {
								resultText = toolResult;
							} else {
								resultText = JSON.stringify(toolResult);
							}

							// 툴 결과 길이 제한 (LLM 컨텍스트 초과 방지)
							const MAX_TOOL_RESULT_CHARS = 4000;
							let truncationNote = '';
							if (resultText.length > MAX_TOOL_RESULT_CHARS) {
								truncationNote = t('uiMessages.agentToolTruncatedNote', { total: resultText.length, max: MAX_TOOL_RESULT_CHARS });
								resultText = resultText.substring(0, MAX_TOOL_RESULT_CHARS) + truncationNote;
							}
							debugLogger.logMcp('Tool Result', `◀️ 툴 결과: ${tc.name} → ${resultText.length}자${truncationNote ? ' (잘림)' : ''}`, { result: resultText });

							// tool 결과를 대화에 추가
							// 로컬 모델은 role: 'tool'을 지원하지 않으므로 role: 'user'로 변환
							const toolMsgRole = useLocal ? 'user' : 'tool';
							messagesForLLM.push({
								role: toolMsgRole,
								name: tc.name,
								content: useLocal
									? t('uiMessages.agentToolResultFor', { name: tc.name }) + '\n' + resultText
									: resultText,
								...(useLocal ? {} : { tool_call_id: tc.id }),
							});
						} catch (e) {
							debugLogger.logMcp('Tool Error', `❌ 툴 실행 오류 ${tc.name}`, { error: (e as Error).message });
							const toolMsgRole2 = useLocal ? 'user' : 'tool';
							messagesForLLM.push({
								role: toolMsgRole2,
								name: tc.name,
								content: useLocal
									? t('uiMessages.agentToolError', { name: tc.name, error: (e as Error).message })
									: t('uiMessages.agentToolExecuteError', { error: (e as Error).message }),
								...(useLocal ? {} : { tool_call_id: tc.id }),
							});
						}
					}
				}

				// 최대 라운드 도달 시
				if (toolRound >= maxRounds) {
					fullResponse = t('uiMessages.agentMaxStepsReached');
					debugLogger.logMcp('Loop Error', '⚠️ 최대 툴 루프 라운드 도달');
					appendChunk(assistantId, fullResponse);
				}
			} else if (chat.streaming) {
				// ── Streaming (no tools) ──
				const streamRes = await provider.stream(llmMessages, chatOptions, (chunk) => {
					fullResponse += chunk;
					appendChunk(assistantId, chunk);
				});
				tokenUsage = streamRes?.usage;
			} else {
				// ── Non-streaming (no tools) ──
				const response = await provider.chat(llmMessages, chatOptions);
				fullResponse = response.content;
				tokenUsage = response?.usage;
				appendChunk(assistantId, fullResponse);
			}

			if (tokenUsage) {
				const estimatedCost = calculateEstimatedCost(chatOptions.model, tokenUsage.inputTokens, tokenUsage.outputTokens);
				setMessageTokenUsage(assistantId, {
					...tokenUsage,
					...(estimatedCost !== undefined ? { estimatedCost } : {})
				});
			}

			// 응답이 비어있을 경우 (필터링, 모델 한계 등)
			if (!fullResponse.trim()) {
				fullResponse = t('settings.chat.emptyResponseFallback') || '⚠️ 모델이 빈 응답을 반환했습니다. (컨텍스트 초과 또는 지원되지 않는 요청일 수 있습니다.)';
				appendChunk(assistantId, fullResponse);
			}

			// 디버그: LLM 응답 로그
			debugLogger.logResponse(requestId, {
				model: chatOptions.model,
				content: fullResponse,
				durationMs: 0, // tool loop 때문에 정확한 측정 어려움
				usage: tokenUsage,
			});

			// ── 9. 스트리밍 완료 표시 ────────────────────────────────────────
			setMessageStreaming(assistantId, false);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : '알 수 없는 오류';
			if (err instanceof Error && err.name === 'AbortError') {
				setMessageStreaming(assistantId, false);
			} else {
				setMessageError(assistantId, msg);
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
}

// ─── 텍스트 기반 Tool Calling (로컬 모델 폴백) ──────────────────────────────

function buildTextToolPrompt(tools: ToolDefinition[]): string {
	const toolDescs = tools.map((t: ToolDefinition) => {
		const props = t.inputSchema?.properties ?? {};
		const required = t.inputSchema?.required ?? [];
		const argsDesc = Object.entries(props)
			.filter(([key]) => key !== '_serverId')
			.map(([key, val]) => {
				const isRequired = required.includes(key) ? ' (required)' : ' (optional)';
				const valObj = val as { description?: string; type?: string };
				return `    ${key}: ${valObj.description || valObj.type}${isRequired}`;
			})
			.join('\n');
		return `- ${t.name}: ${t.description}\n  Arguments:\n${argsDesc || '    (none)'}`;
	}).join('\n');

	return `\n\n## Available Tools
You have access to the following tools. To use a tool, you MUST output your reasoning in <think> tags first, followed by a JSON block like this:

<think>
I need to use the tool to find the information the user requested.
</think>
<lumina_tool_call>
{"name": "tool_name", "arguments": {"arg1": "value1"}}
</lumina_tool_call>

The tool result will be provided to you in the next message. You may call multiple tools, but only output ONE <lumina_tool_call> block per response. If you do not need any tools, just respond normally.

Available tools:
${toolDescs}

IMPORTANT: ALWAYS explain your reasoning inside <think>...</think> tags BEFORE outputting a <lumina_tool_call> block.
CRITICAL: If you decide to use a tool, you MUST output the <lumina_tool_call> JSON block immediately after the </think> tag. Do NOT output any conversational text or explanation outside of the <think> tags when calling a tool. Never output <lumina_tool_call> without thinking first.`;
}

function parsePythonArgs(argsStr: string): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	let i = 0;
	const len = argsStr.length;

	function skipWhitespace() {
		while (i < len && /\s/.test(argsStr[i])) {
			i++;
		}
	}

	while (i < len) {
		skipWhitespace();
		if (i >= len) break;

		// 1. Read key
		let key = '';
		while (i < len && /[a-zA-Z0-9_-]/.test(argsStr[i])) {
			key += argsStr[i];
			i++;
		}

		if (!key) {
			i++;
			continue;
		}

		skipWhitespace();
		if (i >= len || argsStr[i] !== '=') {
			continue;
		}
		i++; // skip '='
		skipWhitespace();

		if (i >= len) break;

		let val: unknown = undefined;
		const char = argsStr[i];

		if (char === '"' || char === "'") {
			const quoteChar = char;
			let isTriple = false;
			if (i + 2 < len && argsStr[i + 1] === quoteChar && argsStr[i + 2] === quoteChar) {
				isTriple = true;
				i += 3;
			} else {
				i++;
			}

			let strValue = '';
			while (i < len) {
				if (isTriple) {
					if (i + 2 < len && argsStr[i] === quoteChar && argsStr[i + 1] === quoteChar && argsStr[i + 2] === quoteChar) {
						i += 3;
						break;
					}
				} else {
					if (argsStr[i] === quoteChar && argsStr[i - 1] !== '\\') {
						i++;
						break;
					}
				}
				if (!isTriple && argsStr[i] === '\\' && i + 1 < len) {
					const next = argsStr[i + 1];
					if (next === 'n') strValue += '\n';
					else if (next === 't') strValue += '\t';
					else if (next === 'r') strValue += '\r';
					else strValue += next;
					i += 2;
				} else {
					strValue += argsStr[i];
					i++;
				}
			}
			val = strValue;
		} else if (char === '{') {
			let braceCount = 0;
			let dictStr = '';
			while (i < len) {
				const c = argsStr[i];
				dictStr += c;
				if (c === '{') braceCount++;
				else if (c === '}') {
					braceCount--;
					if (braceCount === 0) {
						i++;
						break;
					}
				}
				i++;
			}
			try {
				val = JSON.parse(dictStr.replace(/'/g, '"'));
			} catch {
				val = dictStr;
			}
		} else if (char === '[') {
			let bracketCount = 0;
			let listStr = '';
			while (i < len) {
				const c = argsStr[i];
				listStr += c;
				if (c === '[') bracketCount++;
				else if (c === ']') {
					bracketCount--;
					if (bracketCount === 0) {
						i++;
						break;
					}
				}
				i++;
			}
			try {
				val = JSON.parse(listStr.replace(/'/g, '"'));
			} catch {
				val = listStr;
			}
		} else {
			let valStr = '';
			while (i < len && !/[\s,]/.test(argsStr[i]) && argsStr[i] !== ')') {
				valStr += argsStr[i];
				i++;
			}
			valStr = valStr.trim();
			if (valStr.toLowerCase() === 'true') val = true;
			else if (valStr.toLowerCase() === 'false') val = false;
			else if (valStr.toLowerCase() === 'none' || valStr.toLowerCase() === 'null') val = null;
			else if (!isNaN(Number(valStr)) && valStr !== '') val = Number(valStr);
			else val = valStr;
		}

		args[key] = val;

		skipWhitespace();
		if (i < len && argsStr[i] === ',') {
			i++;
		}
	}

	return args;
}

function parsePythonCall(code: string): { name: string; arguments: Record<string, unknown> } | null {
	code = code.trim();
	if (code.startsWith('print(') && code.endsWith(')')) {
		code = code.substring(6, code.length - 1).trim();
	}

	const callMatch = code.match(/^([a-zA-Z0-9_-]+)\s*\(([\s\S]*)\)$/);
	if (!callMatch) return null;

	const name = callMatch[1];
	const argsString = callMatch[2].trim();

	const args = parsePythonArgs(argsString);
	return { name, arguments: args };
}

function parseTextToolCalls(content: string): { toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; cleanContent: string } {
	const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
	// 시작 태그의 오타($lumina_tool_call 등)를 허용하기 위해 더 관대하게 파싱
	const regex = /[<$]*(lumina_tool_call|tool_code|tool_call|use_tool)[>]*\s*([\s\S]*?)\s*<\/\1>/gi;
	let match;
	const parts: string[] = [];
	let lastEnd = 0;

	while ((match = regex.exec(content)) !== null) {
		parts.push(content.substring(lastEnd, match.index));
		const blockContent = match[2].trim();
		try {
			interface TextToolCallJson {
				name: string;
				arguments?: Record<string, unknown>;
			}
			const json = JSON.parse(blockContent) as TextToolCallJson | null | undefined;
			if (json?.name) {
				toolCalls.push({
					id: crypto.randomUUID(),
					name: json.name,
					arguments: json.arguments || {},
				});
			}
		} catch (e) {
			const parsedPy = parsePythonCall(blockContent);
			if (parsedPy) {
				toolCalls.push({
					id: crypto.randomUUID(),
					name: parsedPy.name,
					arguments: parsedPy.arguments,
				});
			} else {
				// XML 스타일 폴백 (예: <name>tool</name><arguments>{}</arguments>)
				const nameMatch = blockContent.match(/<name>\s*(.*?)\s*<\/name>/i) || blockContent.match(/"name"\s*:\s*"([^"]+)"/i);
				const argsMatch = blockContent.match(/<arguments>\s*([\s\S]*?)(?:<\/arguments>|$)/i);

				if (nameMatch) {
					const toolName = nameMatch[1].trim();
					let toolArgs: Record<string, unknown> = {};
					if (argsMatch) {
						let argsStr = argsMatch[1].trim();
						try {
							toolArgs = JSON.parse(argsStr) as Record<string, unknown>;
						} catch {
							// JSON.parse 실패 시 파이썬 스타일이나 단순 파싱 시도할 수도 있지만, 일단 빈 객체로 fallback
						}
					}
					toolCalls.push({
						id: crypto.randomUUID(),
						name: toolName,
						arguments: toolArgs,
					});
				} else {
					debugLogger.logMcp('Parse Error', '텍스트 tool call 파싱 실패', { error: (e as Error).message, text: blockContent });
				}
			}
		}
		lastEnd = regex.lastIndex;
	}

	if (lastEnd < content.length) {
		parts.push(content.substring(lastEnd));
	}

	return {
		toolCalls,
		cleanContent: parts.join('').trim(),
	};
}
