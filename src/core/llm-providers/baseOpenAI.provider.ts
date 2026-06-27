import { requestUrl } from 'obsidian';
import type {
	ChatMessage,
	ChatOptions,
	ChatResponse,
	ILLMProvider,
	TokenUsage,
} from '../../shared/types/llm.types';
import { formatOpenAIMessages, formatOpenAITools } from './openai-formatter';
import type { OpenAIResponse, OpenAIToolCallInfo } from './openai-types';
import { readStreamLines, requestUrlWithAbort } from './provider-helpers';
import {
	mapOpenAIUsage,
	convertOpenAIToolCalls,
	wrapReasoningContent,
	StreamChunkAccumulator,
} from './stream-accumulator';

export abstract class BaseOpenAIProvider implements ILLMProvider {
	abstract readonly providerId: string;
	protected abstract readonly type: string;
	protected abstract readonly baseUrl: string;
	protected apiKey: string;
	protected enableReasoning = false;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	abstract listModels(): Promise<string[]>;

	async chat(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk?: (chunk: string) => void,
	): Promise<ChatResponse> {
		const url = `${this.baseUrl}/v1/chat/completions`;
		const headers = this.buildHeaders();
		const payload = this.buildPayload(options, messages, !!onChunk);

		if (onChunk) {
			return this.handleStreamingChat(url, headers, payload, options.signal, onChunk);
		}
		return this.handleNonStreamingChat(url, headers, payload, options.signal);
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }> {
		const url = `${this.baseUrl}/v1/chat/completions`;
		const headers = this.buildHeaders();
		const payload = this.buildStreamOnlyPayload(options, messages);

		return this.handleStreamingChatRaw(url, headers, payload, options.signal, onChunk);
	}

	async embed(texts: string[], options: { model: string }): Promise<number[][]> {
		try {
			const res = await requestUrl({
				url: `${this.baseUrl}/v1/embeddings`,
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
			throw new Error(`${this.type} Embedding Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// ─── Protected / Private helpers ─────────────────────────────────────────

	protected buildHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.apiKey}`,
		};
	}

	protected getStopSequences(options: ChatOptions): string[] | undefined {
		if (options.stop && options.stop.length > 0) {
			return options.stop;
		}
		return undefined;
	}

	protected buildPayload(
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

		const stopSeq = this.getStopSequences(options);
		if (stopSeq) {
			payload.stop = stopSeq;
		}

		return payload;
	}

	protected buildStreamOnlyPayload(
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

		const stopSeq = this.getStopSequences(options);
		if (stopSeq) {
			payload.stop = stopSeq;
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
			throw new Error(`${this.type} Error (HTTP ${response.status}): ${errText}`);
		}

		const accumulator = new StreamChunkAccumulator(onChunk, this.enableReasoning ? { enableReasoning: true } : undefined);

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
			throw new Error(`${this.type} Error (HTTP ${response.status}): ${errText}`);
		}

		const accumulator = new StreamChunkAccumulator(onChunk, this.enableReasoning ? { enableReasoning: true } : undefined);

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
		signal?: AbortSignal,
	): Promise<ChatResponse> {
		const res = await requestUrlWithAbort({
			url,
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		}, signal);

		const data = res.json as OpenAIResponse;
		const choice = data.choices?.[0];
		const message = choice?.message;
		if (!message) {
			throw new Error(`${this.type} API returned an empty response. Response: ${res.text}`);
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

		let content = message.content || '';
		if (this.enableReasoning) {
			const reasoning = (message.reasoning_content ?? message.reasoning) ?? undefined;
			content = wrapReasoningContent(reasoning, content);
		}

		return {
			content,
			usage,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			finishReason,
		};
	}
}
