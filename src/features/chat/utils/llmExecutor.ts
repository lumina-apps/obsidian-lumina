import { createProvider } from '../../../core/llm-providers/index';
import { isCliProvider, type LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ChatOptions, TokenUsage } from '../../../shared/types/llm.types';
import type {
	CliToolCallLog,
	CliFileEditLog,
} from '../../../shared/types/cliAgent.types';
import { CliAgentProvider, formatMessagesToPrompt } from '../../../core/llm-providers/cli/cli-agent.provider';
import { stripAnsiCodes, extractTextFromUnknown } from '../../../core/llm-providers/cli/ndjson-parser';
import { runAgentLoop, isTokenLimitReached } from '../agentLoop';
import { debugLogger } from '../../../shared/debugLogger';
import {
	appendChunk,
	appendThinking,
	appendRawLog,
	setActivityStatus,
	addCliToolCall,
	updateCliToolCall,
	addCliFileEdit,
	updateCliFileEdit,
	setCliUsage,
	activeCliExecution,
	getMessages,
} from '../../../core/store/chatStore';
import type { ResolvedContext } from './contextBuilder';
import type LuminaPlugin from '../../../main';
import {
	getVaultBasePath as getVaultBasePathUtil,
	toVaultRelativePath as toVaultRelativePathUtil,
} from '../../../shared/utils/fileUtils';
import { TFile } from 'obsidian';
import * as path from 'path';
import { IMAGE_EXTENSIONS } from './ChatAttachmentHandler';
import { t } from '../../../shared/locales/helpers';

/**
 * 볼트 파일 시스템 절대 경로를 반환합니다.
 */
export function getVaultBasePath(plugin: LuminaPlugin): string {
	return getVaultBasePathUtil(plugin.app);
}

/**
 * 입력된 파일 경로(절대 경로 또는 상대 경로)를 볼트 루트 기준 상대 경로로 정규화합니다.
 */
export function toVaultRelativePath(plugin: LuminaPlugin, inputPath: string): string {
	return toVaultRelativePathUtil(plugin.app, inputPath);
}

/**
 * 볼트 내 파일 내용을 안전하게 읽습니다.
 */
async function getFileContentSafely(plugin: LuminaPlugin, filePath: string): Promise<string | null> {
	try {
		const relPath = toVaultRelativePath(plugin, filePath);
		const file = plugin.app.vault.getAbstractFileByPath(relPath);
		if (file instanceof TFile) {
			return await plugin.app.vault.read(file);
		}
	} catch (e) {
		debugLogger.logDebug('cli-agent', `Could not read file ${filePath}: ${e}`);
	}
	return null;
}

/**
 * 프로바이더 설정에서 유효한 모델 ID를 결정한다.
 * fallback: modelId → availableModels[0] → ''
 */
export function resolveModelId(
	providerConfig: LLMProviderConfig | undefined,
	modelId: string,
): string {
	if (!providerConfig?.isVerified) return '';
	return modelId || providerConfig.availableModels[0] || '';
}

/**
 * CLI 에이전트 전용 실행 함수.
 * 이벤트 스트림(text, thinking, tool_call, file_edit, usage 등)을 소비하여 chatStore에 반영합니다.
 */
export async function executeCliAgentCall(
	plugin: LuminaPlugin,
	ctx: ResolvedContext,
	providerConfig: LLMProviderConfig,
	resolvedModelId: string,
	chatSettings: LuminaPlugin['settings']['chat'] | undefined,
	signal: AbortSignal | undefined,
	assistantId: string,
	pendingApprovals?: Map<string, (approved: boolean) => void>,
): Promise<{
	fullResponse: string;
	tokenUsage: TokenUsage | undefined;
	hasTokenLimitBeenHit: boolean;
}> {
	const provider = new CliAgentProvider(providerConfig);
	const cwd = getVaultBasePath(plugin);
	// CLI 에이전트 모드에서는 CLI가 항상 자체 도구를 실행하며, 읽기/수정 모드는 채팅창 설정에 따라 결정됨
	const isAgentEnabled = true;
	const agentExecutionMode = chatSettings?.agentExecutionMode ?? 'read';

	// 첨부 파일 중 이미지 및 컨텍스트 파일 절대 경로 수집
	const contextFiles: string[] = [];
	const imageFiles: string[] = [];
	for (const att of ctx.attachments ?? []) {
		const ext = att.name.split('.').pop()?.toLowerCase();
		let absPath: string | null = null;
		if (att.type === 'external_file') {
			absPath = att.path;
		} else if (att.type === 'file' || att.type === 'active_note') {
			absPath = path.join(cwd, att.path);
		}

		if (absPath) {
			contextFiles.push(absPath);
			if (ext && IMAGE_EXTENSIONS.has(ext)) {
				imageFiles.push(absPath);
			}
		}
	}

	// 현재 열린 활성 파일이 있고 아직 목록에 없으면 추가
	const activeFile = plugin.app.workspace.getActiveFile();
	if (activeFile) {
		const activeAbsPath = path.join(cwd, activeFile.path);
		if (!contextFiles.includes(activeAbsPath)) {
			contextFiles.push(activeAbsPath);
		}
	}

	// 전체 대화 맥락(시스템 프롬프트, 이전 대화 등)을 온전히 보존하여 CLI에 전달
	let prompt = formatMessagesToPrompt(ctx.llmMessages);

	const nonImageFiles = contextFiles.filter((f) => !imageFiles.includes(f));
	if (nonImageFiles.length > 0) {
		const fileListStr = nonImageFiles.map((f) => `- ${f}`).join('\n');
		prompt = `[Active Note / Referenced Files]:\n${fileListStr}\n(The user may be referring to the active note or files above. Inspect and read them directly using your file tools if needed.)\n\n${prompt}`;
	}

	if (imageFiles.length > 0) {
		const imageListStr = imageFiles.map((f) => `- ${f}`).join('\n');
		prompt = `[Attached Image Files]:\n${imageListStr}\n(The user has attached the above local image files. Please inspect and analyze them.)\n\n${prompt}`;
	}

	const startTime = Date.now();
	const requestId = debugLogger.logRequest({
		provider: providerConfig.type,
		model: resolvedModelId,
		temperature: chatSettings?.temperature ?? 0.7,
		maxTokens: chatSettings?.maxOutputTokens ?? 4096,
		stream: true,
		systemPrompt: `CLI Agent Execution (${agentExecutionMode})`,
		messages: ctx.llmMessages.map((m) => ({
			role: m.role,
			content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
		})),
	});

	debugLogger.logSystem(
		'cli-agent-start',
		`Starting CLI Agent: ${providerConfig.type} (${resolvedModelId}) in ${agentExecutionMode} mode`,
		{
			provider: providerConfig.type,
			model: resolvedModelId,
			mode: agentExecutionMode,
			contextFilesCount: contextFiles.length,
			contextFiles,
		},
	);

	const fileSnapshots = new Map<string, string>();
	let fullResponse = '';
	let toolCallCounter = 0;
	let tokenUsage: TokenUsage | undefined;

	const execution = provider.executeRaw(prompt, {
		cwd,
		model: resolvedModelId,
		autoApprove: agentExecutionMode === 'edit',
		allowedTools: [],
		contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
		agentEnabled: isAgentEnabled,
		agentExecutionMode,
		signal,
	});

	activeCliExecution.set(execution);

	try {
		for await (const event of execution.events) {
			if (signal?.aborted) break;

			switch (event.type) {
				case 'text':
					if (event.content) {
						fullResponse += event.content;
						appendChunk(assistantId, event.content);
					}
					break;

				case 'thinking':
					if (event.content) {
						appendThinking(assistantId, event.content);
						setActivityStatus(assistantId, t('uiMessages.thoughtProcess') || 'Thinking...');
					}
					break;

				case 'raw_log':
					if (event.content) {
						appendRawLog(assistantId, event.content);
					}
					break;

				case 'activity_status':
					setActivityStatus(assistantId, event.content);
					break;

				case 'tool_call':
					if (event.toolCall) {
						debugLogger.logSystem(
							'cli-tool-call',
							`CLI Tool Call: ${event.toolCall.name}`,
							{
								tool: event.toolCall.name,
								arguments: event.toolCall.arguments,
							},
						);
						const args = event.toolCall.arguments || {};
						const candidatePath = (args.file_path || args.path || args.file || args.TargetFile || args.filePath || args.targetFile) as string | undefined;
						if (candidatePath && typeof candidatePath === 'string') {
							const relPath = toVaultRelativePath(plugin, candidatePath);
							if (!fileSnapshots.has(relPath)) {
								const currentContent = await getFileContentSafely(plugin, relPath);
								fileSnapshots.set(relPath, currentContent ?? '');
								fileSnapshots.set(candidatePath, currentContent ?? '');
							}
						}

						const toolLogId = `tc-${Date.now()}-${++toolCallCounter}`;

						const toolLog: CliToolCallLog = {
							id: toolLogId,
							name: event.toolCall.name,
							arguments: event.toolCall.arguments,
							timestamp: Date.now(),
							status: 'running',
						};
						addCliToolCall(assistantId, toolLog);

						const target = (args.file_path || args.path || args.file || args.filename || args.TargetFile || args.command || args.cmd || args.CommandLine || args.query || args.pattern) as string | undefined;
						const toolDetail = target ? `${event.toolCall.name} (${target})` : event.toolCall.name;

						setActivityStatus(
							assistantId,
							`${t('settings.cli.runningToolPrefix') || '⚡ Running:'} ${toolDetail}`,
						);
					}
					break;

				case 'tool_result':
					if (event.toolResult) {
						debugLogger.logSystem(
							'cli-tool-result',
							`CLI Tool Result: ${event.toolResult.name || 'unknown'} (${event.toolResult.error ? 'failed' : 'completed'})`,
							{
								tool: event.toolResult.name,
								hasError: !!event.toolResult.error,
								error: event.toolResult.error,
							},
						);
						const currentMsgs = getMessages();
						const targetMsg = currentMsgs.find((m) => m.id === assistantId);
						const runningTool =
							targetMsg?.cliToolCalls?.find(
								(tc) =>
									(tc.status === 'running' || tc.status === 'pending_approval') &&
									(!event.toolResult?.name || tc.name === event.toolResult.name),
							) || targetMsg?.cliToolCalls?.find((tc) => tc.status === 'running' || tc.status === 'pending_approval');
						if (runningTool) {
							updateCliToolCall(assistantId, runningTool.id, {
								output: event.toolResult.output,
								error: event.toolResult.error,
								status: event.toolResult.error ? 'failed' : 'completed',
							});
						}
						setActivityStatus(assistantId, undefined);
					}
					break;

				case 'file_edit':
					if (event.fileEdit) {
						debugLogger.logSystem(
							'cli-file-edit',
							`CLI File Edit: ${event.fileEdit.path} (${event.fileEdit.action})`,
							{
								path: event.fileEdit.path,
								action: event.fileEdit.action,
							},
						);
						const rawPath = event.fileEdit.path;
						const relPath = toVaultRelativePath(plugin, rawPath);
						const action = event.fileEdit.action;
						const beforeContent = fileSnapshots.get(relPath) ?? fileSnapshots.get(rawPath) ?? '';
						let afterContent = '';
						if (action !== 'delete') {
							afterContent = (await getFileContentSafely(plugin, relPath)) ?? '';
						}

						const fileLog: CliFileEditLog = {
							id: `fe-${Date.now()}`,
							path: relPath || rawPath,
							action,
							timestamp: Date.now(),
							beforeContent: action === 'create' ? '' : beforeContent,
							afterContent,
						};
						addCliFileEdit(assistantId, fileLog);
						setActivityStatus(assistantId, `Editing file: ${relPath || rawPath}`);
					}
					break;

				case 'usage':
					if (event.usage) {
						debugLogger.logDebug(
							'cli-agent',
							`Token usage: in=${event.usage.inputTokens}, out=${event.usage.outputTokens}, total=${event.usage.totalTokens}`,
						);
						tokenUsage = {
							inputTokens: event.usage.inputTokens || 0,
							outputTokens: event.usage.outputTokens || 0,
							totalTokens: event.usage.totalTokens || 0,
						};
						setCliUsage(assistantId, event.usage);
					}
					break;

				case 'status':
					setActivityStatus(assistantId, event.content);
					break;
			}
		}

		const exitResult = await execution.waitForExit();

		if (requestId) {
			debugLogger.logResponse(requestId, {
				model: resolvedModelId,
				content: fullResponse,
				durationMs: Date.now() - startTime,
				usage: tokenUsage,
			});
		}

		debugLogger.logSystem(
			'cli-agent-finish',
			`CLI execution finished: ${providerConfig.type} (exitCode: ${exitResult?.exitCode ?? 0})`,
			{
				exitCode: exitResult?.exitCode,
				durationMs: Date.now() - startTime,
				tokenUsage,
			},
		);

		if (exitResult && exitResult.exitCode !== 0) {
			debugLogger.logError('cli-agent', `CLI process exited with non-zero exitCode: ${exitResult.exitCode}`);
		}

		// 파일 편집 로그들에 대해 최종 afterContent 보정
		const currentMsgs = getMessages();
		const finalAssistantMsg = currentMsgs.find((m) => m.id === assistantId);
		if (finalAssistantMsg?.cliFileEdits) {
			for (const fe of finalAssistantMsg.cliFileEdits) {
				if (!fe.afterContent && fe.action !== 'delete') {
					const current = await getFileContentSafely(plugin, fe.path);
					if (current !== null) {
						updateCliFileEdit(assistantId, fe.id, { afterContent: current });
					}
				}
			}
		}

		// 본문 내용이 없을 때 rawLogs fallback (JSON 또는 일반 텍스트에서 텍스트 추출 시도)
		if (!fullResponse && finalAssistantMsg?.rawLogs && finalAssistantMsg.rawLogs.length > 0) {
			const candidateTexts: string[] = [];
			for (const chunk of finalAssistantMsg.rawLogs) {
				const lines = chunk.split('\n');
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
						try {
							const parsed: unknown = JSON.parse(trimmed);
							const extracted = extractTextFromUnknown(parsed);
							if (extracted) candidateTexts.push(extracted);
						} catch {
							// not json
						}
					} else if (!trimmed.startsWith('INFO:') && !trimmed.startsWith('DEBUG:') && !trimmed.startsWith('ERROR:')) {
						candidateTexts.push(stripAnsiCodes(trimmed));
					}
				}
			}

			const textLines = candidateTexts.filter(Boolean).join('\n').trim();

			if (textLines) {
				fullResponse = textLines;
				appendChunk(assistantId, textLines);
			}
		}

		// CLI 프로세스가 비정상 종료되었거나(exitCode !== 0) 에러 로그가 있는 경우
		if (!fullResponse && exitResult && exitResult.exitCode !== 0) {
			const errorLogs = (finalAssistantMsg?.rawLogs || [])
				.map(l => stripAnsiCodes(l).trim())
				.filter(l => l.length > 0)
				.join('\n');
			const errorSnippet = errorLogs.length > 600 ? errorLogs.slice(-600) : errorLogs;
			const errorMsg = errorSnippet
				? `⚠️ CLI 실행 중 오류가 발생했습니다 (종료 코드: ${exitResult.exitCode}):\n\n\`\`\`\n${errorSnippet}\n\`\`\``
				: `⚠️ CLI 실행 중 오류가 발생했습니다 (종료 코드: ${exitResult.exitCode}).`;
			fullResponse = errorMsg;
			appendChunk(assistantId, errorMsg);
		}
	} catch (err) {
		debugLogger.logError(
			'cli-agent',
			`CLI agent execution failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		throw err;
	} finally {
		setActivityStatus(assistantId, undefined);
		activeCliExecution.set(null);
	}

	return { fullResponse, tokenUsage, hasTokenLimitBeenHit: false };
}

/**
 * LLM 호출을 실행한다.
 * CLI 프로바이더 / streaming / non-streaming / agent-loop 분기를 처리한다.
 */
export async function executeLlmCall(
	plugin: LuminaPlugin,
	ctx: ResolvedContext,
	providerConfig: LLMProviderConfig,
	resolvedModelId: string,
	chatSettings: LuminaPlugin['settings']['chat'],
	signal: AbortSignal | undefined,
	assistantId: string,
	pendingApprovals?: Map<string, (approved: boolean) => void>,
): Promise<{
	fullResponse: string;
	tokenUsage: TokenUsage | undefined;
	hasTokenLimitBeenHit: boolean;
}> {
	// ── CLI 에이전트 분기 ────────────────
	const isCli = isCliProvider(providerConfig.type);
	if (isCli) {
		return executeCliAgentCall(
			plugin,
			ctx,
			providerConfig,
			resolvedModelId,
			chatSettings,
			signal,
			assistantId,
			pendingApprovals,
		);
	}

	const { llmMessages, useTextTools, mcpTools, toolServerMap } = ctx;

	const provider = createProvider(providerConfig);

	const chatOptions: ChatOptions = {
		model: resolvedModelId,
		temperature: chatSettings.temperature,
		maxOutputTokens: chatSettings.maxOutputTokens,
		signal,
		tools: (!useTextTools && mcpTools.length > 0) ? mcpTools : undefined,
		stop: (useTextTools && mcpTools.length > 0) ? [] : undefined,
		ttftTimeoutMs: chatSettings.ttftTimeoutMs,
		interTokenTimeoutMs: chatSettings.interTokenTimeoutMs,
		cwd: getVaultBasePath(plugin),
	};

	const hasTools = mcpTools.length > 0;
	let fullResponse = '';
	let tokenUsage: TokenUsage | undefined;
	let hasTokenLimitBeenHit = false;

	debugLogger.logMcp('Loop Start', `MCP 툴 루프 시작`, {
		hasTools,
		streaming: chatSettings.streaming,
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
			chatSettings,
			mcpManager: plugin.mcpManager ?? null,
			toolServerMap,
			useTextTools,
			signal,
			webSearchSettings: plugin.settings.webSearch,
		});
		fullResponse = result.fullResponse;
		tokenUsage = result.tokenUsage;
		hasTokenLimitBeenHit = result.hasTokenLimitBeenHit;
	} else if (chatSettings.streaming) {
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

