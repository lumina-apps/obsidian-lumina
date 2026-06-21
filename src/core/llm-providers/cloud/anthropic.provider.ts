/**
 * anthropic.provider.ts
 * Anthropic Claude API 프로바이더
 */
import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, TokenUsage, ToolCall } from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';
import { extractSystemContent, raiseApiError, readStreamLines, requestUrlWithAbort } from '../provider-helpers';
import { ANTHROPIC_MODELS } from './anthropic.types';
import type { AnthropicResponse } from './anthropic.types';
import { formatAnthropicMessages, formatAnthropicTools } from './anthropic-message-formatter';
import { AnthropicStreamAccumulator, parseAnthropicNonStreamResponse } from './anthropic-stream-parser';

export class AnthropicProvider implements ILLMProvider {
	readonly providerId: string;
	private apiKey: string;

	constructor(providerId: string, apiKey: string) {
		this.providerId = providerId;
		this.apiKey = apiKey;
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
			const { fullContent, toolCalls, usage, finishReason } = await this.streamInternal(messages, options, onChunk);

			return {
				content: fullContent,
				usage,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				finishReason,
			};
		}

		// Non-streaming
		const url = 'https://api.anthropic.com/v1/messages';
		const headers = this.buildHeaders();
		const payload = this.buildPayload(options, messages, false);

		const res = await requestUrlWithAbort({
			url,
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		}, options.signal);

		const data = res.json as AnthropicResponse;
		const { fullContent, toolCalls, usage, finishReason } = parseAnthropicNonStreamResponse(res.text, data);

		return {
			content: fullContent,
			usage,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			finishReason,
		};
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
		const system = extractSystemContent(messages);
		const formattedMessages = formatAnthropicMessages(messages);
		const formattedTools = formatAnthropicTools(options.tools);

		const payload: Record<string, unknown> = {
			model: options.model,
			messages: formattedMessages,
			temperature: options.temperature ?? 0.7,
			max_tokens: options.maxOutputTokens ?? 4096,
			tools: formattedTools,
			stream,
		};

		if (system) {
			payload.system = system;
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
		usage?: TokenUsage;
		finishReason?: string;
	}> {
		const url = 'https://api.anthropic.com/v1/messages';
		const headers = this.buildHeaders();
		const payload = this.buildPayload(options, messages, true);

		const response = await window.fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			signal: options.signal,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`Anthropic Error (HTTP ${response.status}): ${errText}`);
		}

		const accumulator = new AnthropicStreamAccumulator(onChunk);

		await readStreamLines(response, options.signal, (line) => {
			accumulator.processLine(line);
		});

		return accumulator.getResult();
	}
}