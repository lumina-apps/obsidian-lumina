/**
 * batchLlmHelper.ts
 *
 * Batch Studio 레시피 및 AI 폴더 분류(Folder Routing)가 공유하는
 * LLM 프로바이더 선택, 호출, Rate Limit 판별 및 JSON 추출 헬퍼.
 */

import type LuminaPlugin from '../../../main';
import { createProvider } from '../../../core/llm-providers';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import type { BatchRecipeOptions } from '../../../shared/types/batch.types';
import type { ChatResponse, ReasoningOptions, ResponseFormatOptions } from '../../../shared/types/llm.types';
import { isCliProvider, type LLMProviderConfig } from '../../../shared/types/settings.types';
import { stripThinkTags } from '../../../shared/utils/llmTextSanitizer';
import { isEmbeddingModel, isProviderSupportedOnCurrentPlatform } from '../../../shared/utils/modelUtils';

/** 배치 LLM 호출 시 출력 잘림을 방지하기 위한 기본 최대 출력 토큰 */
export const BATCH_DEFAULT_MAX_OUTPUT_TOKENS = 1200;

/**
 * 배치 작업에서 사용 가능한 비-CLI 검증 완료 LLM 프로바이더 목록을 반환합니다.
 */
export function getBatchEligibleProviders(
	providers: readonly LLMProviderConfig[],
): LLMProviderConfig[] {
	return providers
		.filter(
			(p) =>
				!isCliProvider(p.type) &&
				isProviderSupportedOnCurrentPlatform(p.type) &&
				p.isVerified &&
				p.availableModels.length > 0,
		)
		.map((p) => {
			const chatModels = p.availableModels.filter((m) => !isEmbeddingModel(p.type, m));
			return {
				...p,
				availableModels: chatModels.length > 0 ? chatModels : p.availableModels,
			};
		});
}

/**
 * 레시피 옵션 또는 플러그인 Task/기본 설정에서 실행할 프로바이더와 모델 ID를 결정합니다.
 */
export function resolveBatchProviderAndModel(
	plugin: LuminaPlugin,
	options: Pick<BatchRecipeOptions, 'providerId' | 'modelId'>,
): { providerConfig: LLMProviderConfig; modelId: string } {
	const connections = plugin.settings.connections;
	const eligible = getBatchEligibleProviders(connections.providers);
	if (eligible.length === 0) {
		throw new Error(t('batchStudio.options.noModelConfigured'));
	}

	// 1. 사용자가 배치 스튜디오 UI에서 명시적으로 고른 모델 우선
	if (options.providerId && options.modelId) {
		const explicit = eligible.find((p) => p.id === options.providerId);
		if (explicit) {
			return { providerConfig: explicit, modelId: options.modelId };
		}
	}

	// 2. 설정의 Task 전용 모델 우선
	if (connections.taskProviderId && connections.taskModelId) {
		const taskProv = eligible.find((p) => p.id === connections.taskProviderId);
		if (taskProv) {
			return { providerConfig: taskProv, modelId: connections.taskModelId };
		}
	}

	// 3. 퀵 액션 모델 폴백
	if (connections.quickActionProviderId && connections.quickActionModelId) {
		const qaProv = eligible.find((p) => p.id === connections.quickActionProviderId);
		if (qaProv) {
			return { providerConfig: qaProv, modelId: connections.quickActionModelId };
		}
	}

	// 4. 첫 번째 검증된 모델 폴백
	const first = eligible[0];
	return { providerConfig: first, modelId: first.availableModels[0] };
}

/** 마크다운 원문에서 선행 YAML 프론트매터 블록과 본문을 분리합니다. */
export function splitFrontmatterAndBody(rawContent: string): {
	frontmatterBlock: string;
	body: string;
} {
	const match = rawContent.match(/^(---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n?)/);
	if (!match) {
		return { frontmatterBlock: '', body: rawContent };
	}
	const frontmatterBlock = match[1];
	const body = rawContent.slice(frontmatterBlock.length);
	return { frontmatterBlock, body };
}

/** Rate limit(429) 오류인지 판별합니다. */
export function isRateLimitError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	const status =
		typeof err === 'object' && err !== null && 'status' in err ? Number(err.status) : null;
	return status === 429 || msg.includes('HTTP 429') || /\b429\b/.test(msg) || /rate\s*limit/i.test(msg);
}

/** 마크다운 코드펜스를 벗기고 JSON 객체를 추출 */
export function extractJsonObject(text: string): unknown {
	const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
	const match = stripped.match(/\{[\s\S]*\}/);
	if (!match) {
		throw new Error('LLM did not return a valid JSON object.');
	}
	return JSON.parse(match[0]) as unknown;
}

/** 공통 LLM 호출 및 디버그 로깅 헬퍼 */
export async function callBatchLlm(
	plugin: LuminaPlugin,
	options: Pick<BatchRecipeOptions, 'providerId' | 'modelId'>,
	filePath: string,
	recipeLabel: string,
	prompt: string,
	signal?: AbortSignal,
	maxOutputTokens: number = BATCH_DEFAULT_MAX_OUTPUT_TOKENS,
	extraOptions?: {
		responseFormat?: ResponseFormatOptions;
		reasoning?: ReasoningOptions;
	},
): Promise<{ text: string; tokensUsed: number }> {
	const { providerConfig, modelId } = resolveBatchProviderAndModel(plugin, options);
	const reqStart = Date.now();
	const requestId = debugLogger.logRequest({
		provider: providerConfig.type,
		model: modelId,
		temperature: 0.2,
		maxTokens: maxOutputTokens,
		stream: false,
		systemPrompt: `[Batch ${recipeLabel} — ${filePath}]`,
		messages: [{ role: 'user', content: prompt }],
	});

	const provider = createProvider(providerConfig);
	let response: ChatResponse;
	try {
		response = await provider.chat([{ role: 'user', content: prompt }], {
			model: modelId,
			temperature: 0.2,
			maxOutputTokens,
			signal,
			ttftTimeoutMs: 20000,
			interTokenTimeoutMs: 12000,
			...(extraOptions?.responseFormat ? { responseFormat: extraOptions.responseFormat } : {}),
			...(extraOptions?.reasoning ? { reasoning: extraOptions.reasoning } : {}),
		});
		debugLogger.logResponse(requestId, {
			model: modelId,
			content: response.content,
			durationMs: Date.now() - reqStart,
			usage: response.usage,
			...(response.finishReason ? { stopReason: response.finishReason } : {}),
		});
	} catch (err) {
		debugLogger.logResponse(requestId, {
			model: modelId,
			content: `❌ [Error] ${err instanceof Error ? err.message : String(err)}`,
			durationMs: Date.now() - reqStart,
			stopReason: 'error',
		});
		throw err;
	}

	const cleaned = stripThinkTags(
		response.content
			.replace(/&lt;think&gt;/gi, '<think>')
			.replace(/&lt;\/think&gt;/gi, '</think>'),
	).trim();

	return {
		text: cleaned,
		tokensUsed: response.usage?.totalTokens ?? 0,
	};
}
