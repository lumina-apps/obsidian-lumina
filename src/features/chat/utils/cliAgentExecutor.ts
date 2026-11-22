import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { TokenUsage } from '../../../shared/types/llm.types';
import type {
	CliToolCallLog,
	CliFileEditLog,
} from '../../../shared/types/cliAgent.types';
import { CliAgentProvider, formatMessagesToPrompt } from '../../../core/llm-providers/cli/cli-agent.provider';
import {
	stripAnsiCodes,
	extractTextFromUnknown,
	isDuplicateCliSnapshotText,
	extractCandidateFilePaths,
	mergeCliTokenUsage,
} from '../../../core/llm-providers/cli/ndjson-parser';
import { debugLogger, formatMessagesForDebugLog } from '../../../shared/debugLogger';
import { estimateTokens } from '../../../shared/utils/tokenEstimator';
import { normalizeHistoryRootPath } from '../../../shared/utils/historyPathUtils';
import {
	appendChunk,
	appendThinking,
	appendRawLog,
	setActivityStatus,
	addCliToolCall,
	updateCliToolCall,
	addCliFileEdit,
	setCliUsage,
	activeCliExecution,
	getMessages,
} from '../../../core/store/chatStore';
import type { ResolvedContext } from './contextBuilder';
import type LuminaPlugin from '../../../main';
import { joinSystemPath } from '../../../shared/utils/fileUtils';
import { IMAGE_EXTENSIONS } from './ChatAttachmentHandler';
import { t } from '../../../shared/locales/helpers';
import { getActiveProject } from '../../../core/store/projectStore';
import { DEFAULT_EXCLUDED_PATHS } from '../../../shared/utils/exclusions';
import {
	backfillCliFileEditContents,
	backupCliEditedFile,
	captureFileSnapshot,
	getFileContentSafely,
	getVaultBasePath,
	reconcileSnapshotBackups,
	toVaultRelativePath,
} from './cliFileBackupHelper';

interface PreparedCliPrompt {
	prompt: string;
	contextFiles: string[];
	nonImageFiles: string[];
}

/**
 * CLI 에이전트에 전달할 프롬프트, 첨부/이미지 파일 경로 목록 및 볼트 경로 접근 정책 블록을 조립합니다.
 */
function prepareCliAgentPrompt(
	plugin: LuminaPlugin,
	ctx: ResolvedContext,
	cwd: string,
): PreparedCliPrompt {
	// 전체 대화 맥락(시스템 프롬프트, 이전 대화 등)을 온전히 보존하여 CLI에 전달
	let prompt = formatMessagesToPrompt(ctx.llmMessages);
	const hasContextBlockInPrompt = prompt.includes('<context>');

	// 첨부 파일 중 이미지 및 컨텍스트 파일 절대 경로 수집
	const contextFiles: string[] = [];
	const imageFiles: string[] = [];
	const inlineContexts: string[] = [];
	for (const att of ctx.attachments ?? []) {
		const ext = att.name.split('.').pop()?.toLowerCase();
		let absPath: string | null = null;
		if (att.type === 'external_file') {
			absPath = att.path || null;
		} else if (att.type === 'file' || att.type === 'active_note') {
			absPath = joinSystemPath(cwd, att.path);
		}

		if (absPath) {
			contextFiles.push(absPath);
			if (ext && IMAGE_EXTENSIONS.has(ext)) {
				imageFiles.push(absPath);
			}
		} else if (att.content) {
			if (att.content.startsWith('data:image/')) {
				inlineContexts.push(`[Attached Image: ${att.name} (image binary omitted for CLI agent)]`);
			} else if (!hasContextBlockInPrompt) {
				inlineContexts.push(`[Attached Content: ${att.name}]\n${att.content}`);
			}
		}
	}

	if (inlineContexts.length > 0) {
		prompt = `${inlineContexts.join('\n\n')}\n\n${prompt}`;
	}

	const nonImageFiles = contextFiles.filter((f) => !imageFiles.includes(f));
	if (nonImageFiles.length > 0) {
		const fileListStr = nonImageFiles.map((f) => `- ${f}`).join('\n');
		prompt = `[Active Note / Referenced Files]:\n${fileListStr}\n(The contents of attached files are already included in <context> below. Only use file tools if you need to edit them or inspect other files in the vault.)\n\n${prompt}`;
	}

	if (imageFiles.length > 0) {
		const imageListStr = imageFiles.map((f) => `- ${f}`).join('\n');
		prompt = `[Attached Image Files]:\n${imageListStr}\n(The user has attached the above local image files. Please inspect and analyze them.)\n\n${prompt}`;
	}

	// CLI 에이전트가 자체 파일 시스템 도구(find, grep, read_file 등)로 컨텍스트 제외 폴더를 읽지 못하도록 경로 정책 주입
	const respectExclusions = plugin.settings?.mcp?.agentRespectRagExclusions ?? true;
	if (respectExclusions) {
		const activeProject = getActiveProject();
		const excludedDirs = Array.from(
			new Set([
				...DEFAULT_EXCLUDED_PATHS,
				...(activeProject?.ragExcludedPaths ?? []),
				normalizeHistoryRootPath(plugin.settings?.chat?.historyPath),
				plugin.app.vault.configDir,
			]),
		).filter(Boolean);
		const includedDirs = (activeProject?.ragIncludedPaths ?? []).filter(Boolean);

		let policyBlock = `[VAULT PATH ACCESS POLICY - STRICTLY ENFORCED]:\n- Excluded directories/paths (NEVER read, list, search, grep, or access any files inside these paths under any circumstances): ${excludedDirs.join(', ')}`;
		if (includedDirs.length > 0) {
			policyBlock += `\n- Allowed directories/paths whitelist (ONLY access files inside these paths): ${includedDirs.join(', ')}`;
		}
		prompt = `${policyBlock}\n\n${prompt}`;
	}

	return { prompt, contextFiles, nonImageFiles };
}

/**
 * CLI 프로세스 종료 후 수신된 에러 이벤트, rawLogs 폴백 및 비정상 종료 코드를 최종 응답 문자열로 정리합니다.
 */
function resolveCliPostExitResponse(
	assistantId: string,
	initialResponse: string,
	cliErrors: string[],
	exitResult: { exitCode?: number } | null | undefined,
): string {
	let fullResponse = initialResponse;
	const finalAssistantMsg = getMessages().find((m) => m.id === assistantId);

	// CLI 에러 이벤트가 명시적으로 수신된 경우 우선 반영
	if (cliErrors.length > 0) {
		const specificErrors = cliErrors.filter(
			(msg) => !/^CLI process exited with code \d+$/.test(msg),
		);
		const displayErrors = specificErrors.length > 0 ? specificErrors : cliErrors;
		if (!fullResponse) {
			const errorMsg = `⚠️ CLI 실행 중 오류가 발생했습니다:\n\n\`\`\`\n${displayErrors.join('\n')}\n\`\`\``;
			fullResponse = errorMsg;
			appendChunk(assistantId, errorMsg);
		} else if (specificErrors.length > 0) {
			const errorNotice = `\n\n⚠️ CLI 실행 중 오류가 발생했습니다: ${specificErrors.join(' / ')}`;
			fullResponse += errorNotice;
			appendChunk(assistantId, errorNotice);
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
			.map((l) => stripAnsiCodes(l).trim())
			.filter((l) => l.length > 0)
			.join('\n');
		const errorSnippet = errorLogs.length > 600 ? errorLogs.slice(-600) : errorLogs;
		const errorMsg = errorSnippet
			? `⚠️ CLI 실행 중 오류가 발생했습니다 (종료 코드: ${exitResult.exitCode}):\n\n\`\`\`\n${errorSnippet}\n\`\`\``
			: `⚠️ CLI 실행 중 오류가 발생했습니다 (종료 코드: ${exitResult.exitCode}).`;
		fullResponse = errorMsg;
		appendChunk(assistantId, errorMsg);
	}

	return fullResponse;
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
	_pendingApprovals?: Map<string, (approved: boolean) => void>,
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

	const { prompt, contextFiles, nonImageFiles } = prepareCliAgentPrompt(plugin, ctx, cwd);

	const startTime = Date.now();
	const estimatedInputTokens = ctx.llmMessages.reduce((acc, m) => {
		const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
		return acc + estimateTokens(c, providerConfig.type);
	}, 0);

	const systemMsg = ctx.llmMessages.find((m) => m.role === 'system');
	const resolvedSystemPrompt =
		typeof systemMsg?.content === 'string' && systemMsg.content.trim()
			? systemMsg.content
			: `CLI Agent Execution (${agentExecutionMode})`;

	const requestId = debugLogger.logRequest({
		provider: providerConfig.type,
		model: resolvedModelId,
		temperature: chatSettings?.temperature ?? 0.7,
		maxTokens: chatSettings?.maxOutputTokens ?? 4096,
		stream: true,
		systemPrompt: resolvedSystemPrompt,
		messages: formatMessagesForDebugLog(ctx.llmMessages),
		estimatedInputTokens,
		...(ctx.ragChunksForLog ? { ragChunks: ctx.ragChunksForLog } : {}),
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

	const fileSnapshots = new Map<string, string | null>();
	const backedUpPaths = new Set<string>();
	// CLI 프로세스가 디스크를 수정하기 전에 첨부·참조된 볼트 파일의 원본을 선제적으로 스냅샷 확보
	for (const filePath of nonImageFiles) {
		await captureFileSnapshot(plugin, fileSnapshots, filePath);
	}
	let fullResponse = '';
	let toolCallCounter = 0;
	let tokenUsage: TokenUsage | undefined;
	const cliErrors: string[] = [];

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
					if (event.content && !isDuplicateCliSnapshotText(fullResponse, event)) {
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
						for (const candidatePath of extractCandidateFilePaths(event.toolCall.name, args)) {
							await captureFileSnapshot(plugin, fileSnapshots, candidatePath);
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
						const beforeContent = (fileSnapshots.has(relPath) ? fileSnapshots.get(relPath) : fileSnapshots.get(rawPath)) ?? '';
						await backupCliEditedFile(plugin, relPath, rawPath, action, fileSnapshots, backedUpPaths);
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
						tokenUsage = mergeCliTokenUsage(tokenUsage, event.usage);
						debugLogger.logDebug(
							'cli-agent',
							`Token usage: in=${tokenUsage.inputTokens}, out=${tokenUsage.outputTokens}, total=${tokenUsage.totalTokens}`,
						);
						setCliUsage(assistantId, tokenUsage);
					}
					break;

				case 'status':
					setActivityStatus(assistantId, event.content);
					break;

				case 'error':
					if (event.content) {
						const errText = stripAnsiCodes(event.content).trim();
						if (errText && !cliErrors.includes(errText)) {
							cliErrors.push(errText);
						}
						debugLogger.logError('cli-agent', `CLI Error Event: ${errText || event.content}`);
					}
					break;
			}
		}

		const exitResult = await execution.waitForExit();

		await reconcileSnapshotBackups(plugin, assistantId, fileSnapshots, backedUpPaths);

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

		await backfillCliFileEditContents(plugin, assistantId);

		fullResponse = resolveCliPostExitResponse(assistantId, fullResponse, cliErrors, exitResult);
	} catch (err) {
		if (requestId) {
			debugLogger.logResponse(requestId, {
				model: resolvedModelId,
				content: fullResponse || `❌ [CLI Error] ${err instanceof Error ? err.message : String(err)}`,
				durationMs: Date.now() - startTime,
				usage: tokenUsage,
				stopReason: (err instanceof Error && err.name === 'AbortError') || signal?.aborted ? 'aborted' : 'error',
			});
		}
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
