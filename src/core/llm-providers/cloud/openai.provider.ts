import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, TokenUsage } from '../../../shared/types/llm.types';
import { requestUrl } from 'obsidian';
import { formatOpenAIMessages, formatOpenAITools } from '../openai-formatter';
import type { OpenAIResponse } from '../openai-types';
import { raiseApiError, readStreamLines } from '../provider-helpers';
import { mapOpenAIUsage, convertOpenAIToolCalls, StreamChunkAccumulator } from '../stream-accumulator';
import type { OpenAIToolCallInfo } from '../openai-types';

export class OpenAIProvider implements ILLMProvider {
	readonly providerId: string;
	private apiKey: string;

	constructor(providerId: string, apiKey: string) {
		this.providerId = providerId;
		this.apiKey = apiKey;
	}

	async listModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: 'https://api.openai.com/v1/models',
				method: 'GET',
				headers: { Authorization: `Bearer ${this.apiKey}` },
			});
			const data = res.json as { data: { id: string; created: number }[] };

			return data.data
				.filter((m) => /^gpt-|^o\d|^chatgpt-/.test(m.id) || m.id.includes('embedding'))
				.sort((a, b) => b.created - a.created)
				.map((m) => m.id);
		} catch (error) {
			raiseApiError(error, 'OpenAI');
		}
	}

	async chat(messages: ChatMessage[], options: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResponse> {
		const url = 'https://api.openai.com/v1/chat/completions';
		const headers = this.buildHeaders();
		const payload = this.buildPayload(options, messages, !!onChunk);

		if (onChunk) {
			return this.handleStreamingChat(url, headers, payload, options.signal, onChunk);
		}
		return this.handleNonStreamingChat(url, headers, payload);
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }> {
		const url = 'https://api.openai.com/v1/chat/completions';
		const headers = this.buildHeaders();
		const payload = this.buildStreamOnlyPayload(options, messages);

		return this.handleStreamingChatRaw(url, headers, payload, options.signal, onChunk);
	}

	async embed(texts: string[], options: { model: string }): Promise<number[][]> {
		try {
			const res = await requestUrl({
				url: 'https://api.openai.com/v1/embeddings',
				method: 'POST',
				headers: this.buildHeaders(),
				body: JSON.stringify({
					input: texts,
					model: options.model,
				}),
			});
			const data = res.json as { data: { embedding: number[]; index: number }[] };
			return data.data
				.sort((a, b) => a.index - b.index)
				.map((d) => d.embedding);
		} catch (error) {
			throw new Error(`OpenAI Embedding Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// ─── Private helpers ─────────────────────────────────────────────────────

	private buildHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.apiKey}`,
		};
	}

	private buildPayload(
		options: ChatOptions,
		messages: ChatMessage[],
		stream: boolean,
	): Record<string, unknown> {
		const payload: Record<string, unknown> = {
			model: options.model,
			messages: formatOpenAIMessages(messages),
			temperature: options.temperature ?? 0.7,
			max_tokens: options.maxOutputTokens,
			tools: formatOpenAITools(options.tools),
			stream,
		};

		if (options.stop && options.stop.length > 0) {
			payload.stop = options.stop;
		}

		return payload;
	}

	private buildStreamOnlyPayload(
		options: ChatOptions,
		messages: ChatMessage[],
	): Record<string, unknown> {
		const payload: Record<string, unknown> = {
			model: options.model,
			messages: formatOpenAIMessages(messages),
			temperature: options.temperature ?? 0.7,
			max_tokens: options.maxOutputTokens,
			stream: true,
		};

		if (options.stop && options.stop.length > 0) {
			payload.stop = options.stop;
		}

		return payload;
	}

	private async handleStreamingChat(
		url: string,
		headers: Record<string, string>,
		payload: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onChunk: (chunk: string) => void,
	): Promise<ChatResponse> {
		const response = await window.fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			signal,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`OpenAI Error (HTTP ${response.status}): ${errText}`);
		}

		const accumulator = new StreamChunkAccumulator(onChunk);

		await readStreamLines(response, signal, (line) => {
			accumulator.processLine(line);
		});

		accumulator.finalize();

		const result = accumulator.getResult();
		return {
			content: result.content,
			usage: result.usage,
			toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
			finishReason: result.finishReason,
		};
	}

	private async handleStreamingChatRaw(
		url: string,
		headers: Record<string, string>,
		payload: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }> {
		const response = await window.fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			signal,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`OpenAI Error (HTTP ${response.status}): ${errText}`);
		}

		const accumulator = new StreamChunkAccumulator(onChunk);

		await readStreamLines(response, signal, (line) => {
			accumulator.processLine(line);
		});

		accumulator.finalize();

		return { usage: accumulator.usage, finishReason: accumulator.finishReason };
	}

	private async handleNonStreamingChat(
		url: string,
		headers: Record<string, string>,
		payload: Record<string, unknown>,
	): Promise<ChatResponse> {
		const res = await requestUrl({
			url,
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		});

		const data = res.json as OpenAIResponse;
		const choice = data.choices?.[0];
		const message = choice?.message;
		if (!message) {
			throw new Error(`OpenAI API returned an empty response. Response: ${res.text}`);
		}
		const finishReason = choice?.finish_reason || undefined;

		const toolCalls = message.tool_calls
			? convertOpenAIToolCalls(message.tool_calls.map((tc): OpenAIToolCallInfo => ({
					id: tc.id,
					name: tc.function.name,
					arguments: tc.function.arguments,
				})))
			: [];

		const usage = mapOpenAIUsage(data.usage);

		return {
			content: message.content || '',
			usage,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			finishReason,
		};
	}
}