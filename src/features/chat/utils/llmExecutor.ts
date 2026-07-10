import { createProvider } from '../../../core/llm-providers/index';
import type { ChatOptions, TokenUsage } from '../../../shared/types/llm.types';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import { runAgentLoop, isTokenLimitReached } from '../agentLoop';
import { debugLogger } from '../../../shared/debugLogger';
import { appendChunk } from '../../../core/store/chatStore';
import type { ResolvedContext } from './contextBuilder';
import type LuminaPlugin from '../../../main';

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
 * streaming / non-streaming / agent-loop 분기를 처리한다.
 */
export async function executeLlmCall(
	plugin: LuminaPlugin,
	ctx: ResolvedContext,
	providerConfig: LLMProviderConfig,
	resolvedModelId: string,
	chatSettings: LuminaPlugin['settings']['chat'],
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
		temperature: chatSettings.temperature,
		maxOutputTokens: chatSettings.maxOutputTokens,
		signal,
		tools: (!useTextTools && mcpTools.length > 0) ? mcpTools : undefined,
		stop: (useTextTools && mcpTools.length > 0) ? [] : undefined,
		ttftTimeoutMs: chatSettings.ttftTimeoutMs,
		interTokenTimeoutMs: chatSettings.interTokenTimeoutMs,
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
