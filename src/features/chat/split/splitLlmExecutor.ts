import { createProvider } from '../../../core/llm-providers/index';
import type { ChatSettings } from '../../../core/settings/settings.types';
import { debugLogger, formatMessagesForDebugLog } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import type { UIChatMessage } from '../../../shared/types/chat.types';
import type { ChatOptions, TokenUsage } from '../../../shared/types/llm.types';
import {
	isCliProvider,
	PROVIDER_LABELS,
	VISION_UNSUPPORTED_PROVIDERS,
	type LLMProviderConfig,
} from '../../../shared/types/settings.types';
import type {
	SplitResponseMetrics,
	SplitSlotConfig,
} from '../../../shared/types/splitChat.types';
import { extractThinkBlocks, sanitizeDisplayContent } from '../../../shared/utils/llmTextSanitizer';
import { estimateTokens } from '../../../shared/utils/tokenEstimator';
import { isTokenLimitReached } from '../agentLoop';
import { buildMessages } from '../promptBuilder';
import type { SharedTurnContext } from '../utils/contextBuilder';
import { resolveModelId } from '../utils/llmExecutor';
import { injectMultimodalImages } from '../utils/multimodalHelper';

/** 스트리밍 청크 UI 배치 플러시 간격 (ms) */
export const SPLIT_CHUNK_BATCH_INTERVAL_MS = 50;

/** 개별 슬롯 LLM 실행 입력 파라미터 */
export interface ExecuteSplitSlotParams {
	slot: SplitSlotConfig;
	providerConfig: LLMProviderConfig | undefined;
	userText: string;
	history: UIChatMessage[];
	sharedContext: SharedTurnContext;
	chatSettings: ChatSettings;
	signal?: AbortSignal;
	onChunkFlush: (delta: string) => void;
	onFirstToken?: (firstTokenAt: number, ttftMs: number) => void;
}

/** 개별 슬롯 LLM 실행 결과 */
export interface ExecuteSplitSlotResult {
	content: string;
	thinking?: string;
	tokenUsage?: TokenUsage;
	hasTokenLimitBeenHit: boolean;
	metrics: SplitResponseMetrics;
}

/**
 * Split 모드 내 단일 모델 슬롯에 대한 LLM 요청을 실행하고,
 * 50ms 청크 배칭 및 TTFT/생성 속도 메트릭을 측정합니다.
 */
export async function executeSplitSlotCall(
	params: ExecuteSplitSlotParams,
): Promise<ExecuteSplitSlotResult> {
	const {
		slot,
		providerConfig,
		userText,
		history,
		sharedContext,
		chatSettings,
		signal,
		onChunkFlush,
		onFirstToken,
	} = params;

	if (!providerConfig || !providerConfig.isVerified) {
		throw new Error(t('settings.translation.noValidModel'));
	}
	if (isCliProvider(providerConfig.type)) {
		throw new Error(t('splitChat.cliNotSupported'));
	}

	const resolvedModelId = resolveModelId(providerConfig, slot.modelId);
	if (!resolvedModelId) {
		throw new Error(t('settings.translation.noValidModel'));
	}

	if (
		sharedContext.multimodalImages.length > 0 &&
		VISION_UNSUPPORTED_PROVIDERS.has(providerConfig.type)
	) {
		const providerLabel = PROVIDER_LABELS[providerConfig.type] || providerConfig.type;
		throw new Error(
			t('settings.providerErrors.visionNotSupported', { provider: providerLabel }),
		);
	}

	// Split 모드에서는 파일 수정 에이전트 도구를 사용하지 않으므로 읽기전용 안내 프롬프트 주입을 생략
	const effectiveChatSettings: ChatSettings = {
		...chatSettings,
		agentExecutionMode: 'edit',
	};

	let llmMessages = buildMessages(history, userText, {
		chat: effectiveChatSettings,
		attachmentContext: sharedContext.attachmentContext || undefined,
		ragContext: sharedContext.ragContext,
		sessionSummary: undefined,
		summaryUpToMessageId: undefined,
		activeFilePath: sharedContext.activeFilePath,
		activeFileTitle: sharedContext.activeFileTitle,
		providerType: providerConfig.type,
	});

	if (sharedContext.multimodalImages.length > 0) {
		llmMessages = injectMultimodalImages(llmMessages, sharedContext.multimodalImages);
	}

	const provider = createProvider(providerConfig);
	const effectiveTemp = slot.temperatureOverride ?? chatSettings.temperature;

	const chatOptions: ChatOptions = {
		model: resolvedModelId,
		temperature: effectiveTemp,
		maxOutputTokens: chatSettings.maxOutputTokens,
		signal,
		ttftTimeoutMs: chatSettings.ttftTimeoutMs,
		interTokenTimeoutMs: chatSettings.interTokenTimeoutMs,
	};

	const startedAt = Date.now();
	let firstTokenAt: number | undefined;
	let ttftMs: number | undefined;

	const systemMessage = llmMessages.find((m) => m.role === 'system');
	const systemPromptText =
		typeof systemMessage?.content === 'string'
			? systemMessage.content
			: systemMessage?.content
				? JSON.stringify(systemMessage.content)
				: '';
	const estimatedInputTokens = llmMessages.reduce((acc, m) => {
		const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
		return acc + estimateTokens(c, providerConfig.type);
	}, 0);

	const requestId = debugLogger.logRequest({
		provider: providerConfig.type,
		model: resolvedModelId,
		temperature: effectiveTemp,
		maxTokens: chatSettings.maxOutputTokens,
		stream: chatSettings.streaming,
		systemPrompt: systemPromptText,
		messages: formatMessagesForDebugLog(llmMessages),
		estimatedInputTokens,
		...(sharedContext.ragChunksForLog ? { ragChunks: sharedContext.ragChunksForLog } : {}),
	});

	let fullResponse = '';
	let tokenUsage: TokenUsage | undefined;
	let finishReason: string | undefined;

	let chunkBuffer = '';
	let flushTimer: number | null = null;

	const flushBuffer = (): void => {
		if (flushTimer !== null) {
			window.clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (chunkBuffer.length > 0) {
			const pending = chunkBuffer;
			chunkBuffer = '';
			onChunkFlush(pending);
		}
	};

	const enqueueChunk = (chunk: string): void => {
		if (!chunk) return;
		if (firstTokenAt === undefined) {
			firstTokenAt = Date.now();
			ttftMs = Math.max(0, firstTokenAt - startedAt);
			onFirstToken?.(firstTokenAt, ttftMs);
		}
		fullResponse += chunk;
		chunkBuffer += chunk;
		if (flushTimer === null) {
			flushTimer = window.setTimeout(flushBuffer, SPLIT_CHUNK_BATCH_INTERVAL_MS);
		}
	};

	try {
		if (chatSettings.streaming) {
			const streamRes = await provider.stream(llmMessages, chatOptions, enqueueChunk);
			flushBuffer();
			tokenUsage = streamRes?.usage;
			finishReason = streamRes?.finishReason;
		} else {
			const response = await provider.chat(llmMessages, chatOptions);
			fullResponse = response.content;
			tokenUsage = response?.usage;
			finishReason = response.finishReason;
			if (fullResponse) {
				firstTokenAt = Date.now();
				ttftMs = Math.max(0, firstTokenAt - startedAt);
				onFirstToken?.(firstTokenAt, ttftMs);
				onChunkFlush(fullResponse);
			}
		}

		const finishedAt = Date.now();
		const durationMs = Math.max(1, finishedAt - startedAt);
		const outputTokenCount = tokenUsage?.outputTokens || estimateTokens(fullResponse, providerConfig.type);
		const tokensPerSecond =
			outputTokenCount > 0
				? Number(((outputTokenCount / durationMs) * 1000).toFixed(1))
				: undefined;

		const effectiveStopReason = signal?.aborted ? 'aborted' : finishReason;
		debugLogger.logResponse(requestId, {
			model: resolvedModelId,
			content: fullResponse,
			durationMs,
			usage: tokenUsage,
			...(effectiveStopReason ? { stopReason: effectiveStopReason } : {}),
		});

		const hasTokenLimitBeenHit = isTokenLimitReached(finishReason);
		const thinkBlocks = extractThinkBlocks(fullResponse);
		const thinking = thinkBlocks.length > 0 ? thinkBlocks.join('\n\n') : undefined;
		let finalContent = sanitizeDisplayContent(fullResponse);

		if (!finalContent) {
			finalContent = hasTokenLimitBeenHit
				? t('uiMessages.emptyResponseTokenLimit')
				: t('settings.chat.emptyResponseFallback');
		} else if (hasTokenLimitBeenHit) {
			finalContent += '\n\n' + t('uiMessages.tokenLimitHitWarning');
		}

		return {
			content: finalContent,
			thinking,
			tokenUsage,
			hasTokenLimitBeenHit,
			metrics: {
				startedAt,
				firstTokenAt,
				finishedAt,
				durationMs,
				ttftMs,
				tokensPerSecond,
			},
		};
	} catch (err: unknown) {
		flushBuffer();
		const isAborted = (err instanceof Error && err.name === 'AbortError') || Boolean(signal?.aborted);
		debugLogger.logResponse(requestId, {
			model: resolvedModelId,
			content: fullResponse || `❌ [Error] ${err instanceof Error ? err.message : String(err)}`,
			durationMs: Date.now() - startedAt,
			usage: tokenUsage,
			stopReason: isAborted ? 'aborted' : 'error',
		});
		throw err;
	} finally {
		if (flushTimer !== null) {
			window.clearTimeout(flushTimer);
			flushTimer = null;
		}
	}
}
