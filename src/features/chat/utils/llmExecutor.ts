import { createProvider } from '../../../core/llm-providers/index';
import { isCliProvider, type LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ChatOptions, TokenUsage } from '../../../shared/types/llm.types';
import { runAgentLoop, isTokenLimitReached } from '../agentLoop';
import { debugLogger, formatMessagesForDebugLog } from '../../../shared/debugLogger';
import { estimateTokens } from '../../../shared/utils/tokenEstimator';
import { appendChunk } from '../../../core/store/chatStore';
import type { ResolvedContext } from './contextBuilder';
import type LuminaPlugin from '../../../main';
import { getVaultBasePath, toVaultRelativePath } from './cliFileBackupHelper';
import { executeCliAgentCall } from './cliAgentExecutor';

export { getVaultBasePath, toVaultRelativePath, executeCliAgentCall };

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
