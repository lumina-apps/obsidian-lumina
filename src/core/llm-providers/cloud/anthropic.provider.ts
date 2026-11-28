/**
 * anthropic.provider.ts
 * Anthropic Claude API 프로바이더
 */
import type {
	AnthropicThinkingBlock,
	ChatMessage,
	ChatOptions,
	ChatResponse,
	ILLMProvider,
	TokenUsage,
	ToolCall,
} from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';
import {
	extractSystemContent,
	raiseApiError,
	readStreamLines,
	requestUrlWithAbort,
	IdleTimeoutController,
	isMobileStreamingCorsFallbackError,
} from '../provider-helpers';
import { debugLogger } from '../../../shared/debugLogger';
import { ANTHROPIC_MODELS } from './anthropic.types';
import type { AnthropicResponse } from './anthropic.types';
import {
	applyAnthropicMessageCacheBreakpoints,
	formatAnthropicMessages,
	formatAnthropicSystem,
	formatAnthropicTools,
} from './anthropic-message-formatter';
import { AnthropicStreamAccumulator, parseAnthropicNonStreamResponse } from './anthropic-stream-parser';
import { resolveAnthropicThinking } from '../reasoning-config';

export class AnthropicProvider implements ILLMProvider {
	readonly providerId: string;
	private apiKey: string;

	constructor(providerId: string, apiKey: string) {
		this.providerId = providerId;
		this.apiKey = apiKey.trim();
	}

	async listModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: 'https://api.anthropic.com/v1/models',
				method: 'GET',
				headers: {
					'x-api-key': this.apiKey,
					'anthropic-version': '2023-06-01',
				},
			});
			const data = res.json as { data?: { id: string; type?: string }[] };
			const apiModels = data.data
				?.map(m => m.id)
				.filter(id => id.startsWith('claude-')) ?? [];

			return apiModels.length > 0 ? apiModels : [...ANTHROPIC_MODELS];
		} catch (error) {
			raiseApiError(error, 'Anthropic');
		}
	}

	async chat(messages: ChatMessage[], options: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResponse> {
		if (onChunk) {
			const { fullContent, toolCalls, thinkingBlocks, usage, finishReason } = await this.streamInternal(messages, options, onChunk);

			return {
				content: fullContent,
				usage,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				...(thinkingBlocks ? { thinkingBlocks } : {}),
				finishReason,
			};
		}

		// Non-streaming
		const url = 'https://api.anthropic.com/v1/messages';
		const headers = this.buildHeaders();
		const payload = this.buildPayload(options, messages, false);

		const timeoutCtrl = new IdleTimeoutController(options.signal, options.ttftTimeoutMs, options.interTokenTimeoutMs);

		return timeoutCtrl.run(async () => {
			const res = await requestUrlWithAbort({
				url,
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			}, timeoutCtrl.signal);

			const data = res.json as AnthropicResponse;
			const { fullContent, toolCalls, thinkingBlocks, usage, finishReason } = parseAnthropicNonStreamResponse(res.text, data);

			return {
				content: fullContent,
				usage,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				...(thinkingBlocks ? { thinkingBlocks } : {}),
				finishReason,
			};
		});
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }> {
		const { usage, finishReason } = await this.streamInternal(messages, options, onChunk);
		return { usage, finishReason };
	}

	async embed(_texts: string[], _options: { model: string }): Promise<number[][]> {
		throw new Error(t('settings.providerErrors.anthropicNoEmbed'));
	}

	// ─── Private ──────────────────────────────────────────────────────────

	private buildHeaders(): Record<string, string> {
		return {
			'content-type': 'application/json',
			'x-api-key': this.apiKey,
			'anthropic-version': '2023-06-01',
		};
	}

	private buildPayload(
		options: ChatOptions,
		messages: ChatMessage[],
		stream: boolean,
	): Record<string, unknown> {
		const enableCaching = Boolean(options.promptCaching?.enabled);
		const system = extractSystemContent(messages);
		const formattedMessages = formatAnthropicMessages(messages);
		const finalMessages = enableCaching
			? applyAnthropicMessageCacheBreakpoints(formattedMessages)
			: formattedMessages;
		const formattedTools = formatAnthropicTools(options.tools, enableCaching);
		const requestedMaxTokens = options.maxOutputTokens ?? 4096;
		const resolvedThinking = resolveAnthropicThinking(options.model, options.reasoning, requestedMaxTokens);

		const payload: Record<string, unknown> = {
			model: options.model,
			messages: finalMessages,
			max_tokens: resolvedThinking?.adjustedMaxTokens ?? requestedMaxTokens,
			tools: formattedTools,
			stream,
		};

		// Claude 4.7+ / 5+ 모델 또는 thinking 활성 시 temperature 전송하면 HTTP 400 발생하므로 생략
		const isTempDeprecated = /^claude-(?:(?:opus|sonnet|haiku)-)?(?:4[-.](?:[7-9]|\d{2})(?:[-._]|$)|[5-9](?:[-._]|$))/i.test(options.model);
		if (!resolvedThinking?.omitTemperature && !isTempDeprecated) {
			payload.temperature = options.temperature ?? 0.7;
		}

		if (resolvedThinking) {
			payload.thinking = resolvedThinking.thinking;
			if (resolvedThinking.outputConfig) {
				payload.output_config = resolvedThinking.outputConfig;
			}
		}

		if (options.stop && options.stop.length > 0) {
			payload.stop_sequences = options.stop;
		}

		if (system) {
			payload.system = formatAnthropicSystem(system, enableCaching);
		}

		return payload;
	}

	private async streamInternal(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk?: (chunk: string) => void,
	): Promise<{
		fullContent: string;
		toolCalls: ToolCall[];
		thinkingBlocks?: AnthropicThinkingBlock[];
		usage?: TokenUsage;
		finishReason?: string;
	}> {
		const url = 'https://api.anthropic.com/v1/messages';
		// 모바일 WebView 등 브라우저 fetch 환경에서 Anthropic CORS 허용 헤더 포함
		const headers: Record<string, string> = {
			...this.buildHeaders(),
			'anthropic-dangerous-direct-browser-access': 'true',
		};
		const payload = this.buildPayload(options, messages, true);

		const timeoutCtrl = new IdleTimeoutController(options.signal, options.ttftTimeoutMs, options.interTokenTimeoutMs);

		return timeoutCtrl.run(async () => {
			let response: Response;
			try {
				response = await window.fetch(url, {
					method: 'POST',
					headers,
					body: JSON.stringify(payload),
					signal: timeoutCtrl.signal,
				});
			} catch (err: unknown) {
				if (isMobileStreamingCorsFallbackError(err)) {
					debugLogger.logWarn('llm', `Anthropic streaming fetch blocked on mobile, falling back to requestUrl: ${err.message}`);
					timeoutCtrl.switchToNonStreamingFallback();
					const nonStreamPayload = this.buildPayload(options, messages, false);
					const res = await requestUrlWithAbort({
						url,
						method: 'POST',
						headers: this.buildHeaders(),
						body: JSON.stringify(nonStreamPayload),
					}, timeoutCtrl.signal);
					const data = res.json as AnthropicResponse;
					const parsed = parseAnthropicNonStreamResponse(res.text, data);
					if (parsed.fullContent) {
						onChunk?.(parsed.fullContent);
					}
					return parsed;
				}
				throw err;
			}

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`Anthropic Error (HTTP ${response.status}): ${errText}`);
			}

			const accumulator = new AnthropicStreamAccumulator(onChunk);

			await readStreamLines(response, timeoutCtrl.signal, (line) => {
				timeoutCtrl.onChunkReceived();
				accumulator.processLine(line);
			});

			return accumulator.getResult();
		});
	}
}