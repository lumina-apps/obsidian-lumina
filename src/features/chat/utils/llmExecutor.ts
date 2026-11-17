import { createProvider } from '../../../core/llm-providers/index';
import { isCliProvider, type LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ChatOptions, TokenUsage } from '../../../shared/types/llm.types';
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
} from '../../../core/llm-providers/cli/ndjson-parser';
import { runAgentLoop, isTokenLimitReached } from '../agentLoop';
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
import { TFile, normalizePath } from 'obsidian';
import * as path from 'path';
import { IMAGE_EXTENSIONS } from './ChatAttachmentHandler';
import { t } from '../../../shared/locales/helpers';
import { getActiveProject } from '../../../core/store/projectStore';
import { DEFAULT_EXCLUDED_PATHS } from '../../../shared/utils/exclusions';

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
 * CLI 파일 수정 전 원본 내용을 스냅샷 맵에 1회 기록합니다.
 * 파일이 존재하지 않으면 null을 기록해 신규 생성 파일과 구분합니다.
 */
async function captureFileSnapshot(
	plugin: LuminaPlugin,
	fileSnapshots: Map<string, string | null>,
	rawPath: string,
): Promise<void> {
	const relPath = toVaultRelativePath(plugin, rawPath);
	if (!relPath || fileSnapshots.has(relPath)) return;

	const currentContent = await getFileContentSafely(plugin, relPath);
	fileSnapshots.set(relPath, currentContent);
	if (rawPath && rawPath !== relPath && !fileSnapshots.has(rawPath)) {
		fileSnapshots.set(rawPath, currentContent);
	}
}

/**
 * CLI 에이전트가 볼트 문서를 수정하거나 삭제할 때 수정 전 원본 백업을 생성합니다.
 * 한 턴 내에서 동일 파일이 여러 번 수정되더라도 최초 원본 기준으로 1회만 백업합니다.
 */
async function backupCliEditedFile(
	plugin: LuminaPlugin,
	relPath: string,
	rawPath: string,
	action: 'create' | 'modify' | 'delete',
	fileSnapshots: Map<string, string | null>,
	backedUpPaths: Set<string>,
): Promise<void> {
	const targetPath = relPath || rawPath;
	if (!targetPath) return;

	const normalizedPath = normalizePath(targetPath);
	if (!normalizedPath) {
		return;
	}

	const { BACKUP_FOLDER, createBackup, createBackupFromContent } = await import('../../backup/backupManager');
	if (normalizedPath === BACKUP_FOLDER || normalizedPath.startsWith(`${BACKUP_FOLDER}/`)) {
		return;
	}
	if (backedUpPaths.has(normalizedPath)) {
		return;
	}

	const snapshot = fileSnapshots.has(relPath)
		? fileSnapshots.get(relPath)
		: fileSnapshots.get(rawPath);

	if (typeof snapshot === 'string') {
		backedUpPaths.add(normalizedPath);
		await createBackupFromContent(plugin.app, normalizedPath, snapshot);
		return;
	}

	// 수정 전 볼트에 존재하지 않았던 신규 생성 파일은 백업을 생략
	if (snapshot === null || action === 'create') {
		return;
	}

	// 사전 스냅샷 없이 file_edit 이벤트만 직접 수신된 경우(예: Codex/Antigravity) 기존 파일 백업 시도
	backedUpPaths.add(normalizedPath);
	await createBackup(plugin.app, normalizedPath);
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
			absPath = path.join(cwd, att.path);
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

	const startTime = Date.now();
	const estimatedInputTokens = ctx.llmMessages.reduce((acc, m) => {
		const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
		return acc + estimateTokens(c);
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

		// file_edit 이벤트가 누락되었거나 셸 명령 등으로 수정된 스냅샷 파일들에 대해 종료 후 디스크 변경 대조 백업 수행
		const checkedSnapshotPaths = new Set<string>();
		for (const [snapshotKey, snapshot] of fileSnapshots.entries()) {
			if (typeof snapshot !== 'string') continue;
			const relPath = toVaultRelativePath(plugin, snapshotKey);
			if (!relPath) continue;
			const normalizedPath = normalizePath(relPath);
			if (!normalizedPath || checkedSnapshotPaths.has(normalizedPath)) continue;
			checkedSnapshotPaths.add(normalizedPath);

			if (backedUpPaths.has(normalizedPath)) continue;

			const currentContent = await getFileContentSafely(plugin, normalizedPath);
			if (currentContent === snapshot) continue;

			const action: 'modify' | 'delete' = currentContent === null ? 'delete' : 'modify';
			await backupCliEditedFile(
				plugin,
				normalizedPath,
				snapshotKey,
				action,
				fileSnapshots,
				backedUpPaths,
			);

			const latestMsg = getMessages().find((m) => m.id === assistantId);
			const alreadyLogged = latestMsg?.cliFileEdits?.some(
				(fe) => normalizePath(toVaultRelativePath(plugin, fe.path)) === normalizedPath,
			);
			if (!alreadyLogged) {
				addCliFileEdit(assistantId, {
					id: `fe-${Date.now()}-${checkedSnapshotPaths.size}`,
					path: normalizedPath,
					action,
					timestamp: Date.now(),
					beforeContent: snapshot,
					afterContent: currentContent ?? '',
				});
			}
		}

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

	if (hasTools) {
		debugLogger.logMcp('Loop Start', `MCP 툴 루프 시작`, {
			hasTools,
			streaming: chatSettings.streaming,
			toolsCount: mcpTools.length,
			useTextTools,
			method: useTextTools ? '텍스트' : 'bindTools',
		});

		// ── Tool calling 루프 (라운드별 LLM 요청/응답은 runAgentLoop 내부에서 기록) ──
		const result = await runAgentLoop({
			assistantId,
			messagesForLLM: [...llmMessages],
			chatOptions,
			provider,
			providerType: providerConfig.type,
			chatSettings,
			mcpManager: plugin.mcpManager ?? null,
			toolServerMap,
			useTextTools,
			signal,
			webSearchSettings: plugin.settings.webSearch,
			ragChunksForLog: ctx.ragChunksForLog,
		});
		fullResponse = result.fullResponse;
		tokenUsage = result.tokenUsage;
		hasTokenLimitBeenHit = result.hasTokenLimitBeenHit;
	} else {
		const reqStart = Date.now();
		const systemMessage = llmMessages.find((m) => m.role === 'system');
		const systemPromptText =
			typeof systemMessage?.content === 'string'
				? systemMessage.content
				: systemMessage?.content
					? JSON.stringify(systemMessage.content)
					: '';
		const estimatedInputTokens = llmMessages.reduce((acc, m) => {
			const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
			return acc + estimateTokens(c);
		}, 0);

		const requestId = debugLogger.logRequest({
			provider: providerConfig.type,
			model: resolvedModelId,
			temperature: chatSettings.temperature,
			maxTokens: chatSettings.maxOutputTokens,
			stream: chatSettings.streaming,
			systemPrompt: systemPromptText,
			messages: formatMessagesForDebugLog(llmMessages),
			estimatedInputTokens,
			...(ctx.ragChunksForLog ? { ragChunks: ctx.ragChunksForLog } : {}),
		});

		try {
			let finishReason: string | undefined;
			if (chatSettings.streaming) {
				// ── Streaming (no tools) ──────────────────────────────────────
				const streamRes = await provider.stream(llmMessages, chatOptions, (chunk) => {
					fullResponse += chunk;
					appendChunk(assistantId, chunk);
				});
				tokenUsage = streamRes?.usage;
				finishReason = streamRes?.finishReason;
				hasTokenLimitBeenHit = isTokenLimitReached(finishReason);
			} else {
				// ── Non-streaming (no tools) ──────────────────────────────────
				const response = await provider.chat(llmMessages, chatOptions);
				fullResponse = response.content;
				tokenUsage = response?.usage;
				finishReason = response.finishReason;
				appendChunk(assistantId, fullResponse);
				hasTokenLimitBeenHit = isTokenLimitReached(finishReason);
			}

			debugLogger.logResponse(requestId, {
				model: resolvedModelId,
				content: fullResponse,
				durationMs: Date.now() - reqStart,
				usage: tokenUsage,
				...(finishReason ? { stopReason: finishReason } : {}),
			});
		} catch (err: unknown) {
			const isAborted = (err instanceof Error && err.name === 'AbortError') || Boolean(signal?.aborted);
			debugLogger.logResponse(requestId, {
				model: resolvedModelId,
				content: fullResponse || `❌ [Error] ${err instanceof Error ? err.message : String(err)}`,
				durationMs: Date.now() - reqStart,
				usage: tokenUsage,
				stopReason: isAborted ? 'aborted' : 'error',
			});
			throw err;
		}
	}

	return { fullResponse, tokenUsage, hasTokenLimitBeenHit };
}

