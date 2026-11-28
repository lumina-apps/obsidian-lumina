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
import {
	readStreamLines,
	requestUrlWithAbort,
	IdleTimeoutController,
	isStreamingCorsFallbackError,
} from './provider-helpers';
import { debugLogger } from '../../shared/debugLogger';
import {
	mapOpenAIUsage,
	convertOpenAIToolCalls,
	wrapReasoningContent,
	StreamChunkAccumulator,
} from './stream-accumulator';
import {
	buildOpenAIResponseFormat,
	isStructuredOutputRetryableError,
	structuredOutputFallbackCache,
	type StructuredOutputProvider,
} from './structured-output';

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

		const timeoutCtrl = new IdleTimeoutController(options.signal, options.ttftTimeoutMs, options.interTokenTimeoutMs);

		return timeoutCtrl.run(async () => {
			if (onChunk) {
				return await this.handleStreamingChat(url, headers, payload, timeoutCtrl, onChunk);
			}
			try {
				return await this.handleNonStreamingChat(url, headers, payload, timeoutCtrl);
			} catch (err: unknown) {
				if (payload.response_format !== undefined && isStructuredOutputRetryableError(err)) {
					structuredOutputFallbackCache.markUnsupported(this.providerId, options.model);
					debugLogger.logWarn(
						'llm',
						`${this.type} structured output rejected (${options.model}); retrying without response_format`,
					);
					const fallbackPayload = this.buildPayload({ ...options, responseFormat: undefined }, messages, false);
					return await this.handleNonStreamingChat(url, headers, fallbackPayload, timeoutCtrl);
				}
				throw err;
			}
		});
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }> {
		const url = `${this.baseUrl}/v1/chat/completions`;
		const headers = this.buildHeaders();
		const payload = this.buildStreamOnlyPayload(options, messages);

		const timeoutCtrl = new IdleTimeoutController(options.signal, options.ttftTimeoutMs, options.interTokenTimeoutMs);

		return timeoutCtrl.run(async () => {
			return await this.handleStreamingChatRaw(url, headers, payload, timeoutCtrl, onChunk);
		});
	}

	async embed(texts: string[], options: { model: string }): Promise<number[][]> {
		if (texts.length === 0) return [];
		try {
			const BATCH_SIZE = 100;
			const allEmbeddings: number[][] = [];

			for (let i = 0; i < texts.length; i += BATCH_SIZE) {
				const slice = texts.slice(i, i + BATCH_SIZE);
				const res = await requestUrl({
					url: `${this.baseUrl}/v1/embeddings`,
					method: 'POST',
					headers: this.buildHeaders(),
					body: JSON.stringify({
						input: slice,
						model: options.model,
					}),
				});
				const data = res.json as { data?: { embedding: number[]; index?: number }[] };
				if (!data?.data || !Array.isArray(data.data)) {
					throw new Error(`Invalid response format from embeddings endpoint: ${res.text || 'No data array'}`);
				}
				const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
				allEmbeddings.push(...sorted.map((d) => d.embedding));
			}

			return allEmbeddings;
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

	/**
	 * 데스크탑 환경에서 스트리밍 fetch가 CORS/네트워크 TypeError로 차단됐을 때
	 * requestUrl 기반 비스트리밍 폴백을 허용할지 여부를 반환합니다.
	 */
	protected shouldAllowDesktopCorsFallback(): boolean {
		return false;
	}

	/** Structured Outputs(response_format) 지원 프로바이더 식별자 (미지원 시 undefined) */
	protected getStructuredOutputProvider(): Exclude<StructuredOutputProvider, 'google' | 'anthropic'> | undefined {
		return undefined;
	}

	/** 프로바이더 지원 여부·캐시·모델 가드를 확인해 response_format 페이로드를 생성합니다. */
	protected resolveResponseFormatPayload(options: ChatOptions): Record<string, unknown> | undefined {
		const structuredProvider = this.getStructuredOutputProvider();
		if (!structuredProvider || !options.responseFormat) {
			return undefined;
		}
		if (structuredOutputFallbackCache.isUnsupported(this.providerId, options.model)) {
			return undefined;
		}
		return buildOpenAIResponseFormat(structuredProvider, options.model, options.responseFormat);
	}

	protected buildPayload(
		options: ChatOptions,
		messages: ChatMessage[],
		stream: boolean,
	): Record<string, unknown> {
		const isReasoning = /(?:^|\/)(o\d|gpt-5)(-|\.|_|$)/i.test(options.model);
		const payload: Record<string, unknown> = {
			model: options.model,
			messages: formatOpenAIMessages(messages),
			tools: formatOpenAITools(options.tools),
			stream,
		};

		// Reasoning 및 GPT-5 계열 모델(o1/o3/o4/gpt-5 등)은 커스텀 temperature 및 stop을 지원하지 않으며 max_completion_tokens를 사용
		if (!isReasoning) {
			payload.temperature = options.temperature ?? 0.7;
		}
		payload[isReasoning ? 'max_completion_tokens' : 'max_tokens'] = options.maxOutputTokens;

		if (stream) {
			payload.stream_options = { include_usage: true };
		}

		if (!isReasoning) {
			const stopSeq = this.getStopSequences(options);
			if (stopSeq) {
				payload.stop = stopSeq;
			}
		}

		const responseFormatPayload = this.resolveResponseFormatPayload(options);
		if (responseFormatPayload) {
			payload.response_format = responseFormatPayload;
		}

		return payload;
	}

	protected buildStreamOnlyPayload(
		options: ChatOptions,
		messages: ChatMessage[],
	): Record<string, unknown> {
		const isReasoning = /(?:^|\/)(o\d|gpt-5)(-|\.|_|$)/i.test(options.model);
		const payload: Record<string, unknown> = {
			model: options.model,
			messages: formatOpenAIMessages(messages),
			stream: true,
			stream_options: { include_usage: true },
		};

		// Reasoning 및 GPT-5 계열 모델(o1/o3/o4/gpt-5 등)은 커스텀 temperature 및 stop을 지원하지 않으며 max_completion_tokens를 사용
		if (!isReasoning) {
			payload.temperature = options.temperature ?? 0.7;
		}
		payload[isReasoning ? 'max_completion_tokens' : 'max_tokens'] = options.maxOutputTokens;

		if (!isReasoning) {
			const stopSeq = this.getStopSequences(options);
			if (stopSeq) {
				payload.stop = stopSeq;
			}
		}

		const responseFormatPayload = this.resolveResponseFormatPayload(options);
		if (responseFormatPayload) {
			payload.response_format = responseFormatPayload;
		}

		return payload;
	}

	private async handleStreamingChat(
		url: string,
		headers: Record<string, string>,
		payload: Record<string, unknown>,
		timeoutCtrl: IdleTimeoutController,
		onChunk: (chunk: string) => void,
	): Promise<ChatResponse> {
		let response: Response;
		try {
			response = await window.fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
				signal: timeoutCtrl.signal,
			});
		} catch (err: unknown) {
			if (!timeoutCtrl.signal.aborted && isStreamingCorsFallbackError(err, this.shouldAllowDesktopCorsFallback())) {
				debugLogger.logWarn(
					'llm',
					`${this.type} streaming fetch blocked (CORS/network), falling back to requestUrl: ${err.message}`,
				);
				timeoutCtrl.switchToNonStreamingFallback();
				const nonStreamPayload: Record<string, unknown> = { ...payload, stream: false };
				delete nonStreamPayload.stream_options;
				const fallbackRes = await this.handleNonStreamingChat(url, headers, nonStreamPayload, timeoutCtrl);
				if (fallbackRes.content) {
					onChunk(fallbackRes.content);
				}
				return fallbackRes;
			}
			throw err;
		}

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`${this.type} Error (HTTP ${response.status}): ${errText}`);
		}

		const accumulator = new StreamChunkAccumulator(onChunk, this.enableReasoning ? { enableReasoning: true } : undefined);

		await readStreamLines(response, timeoutCtrl.signal, (line) => {
			timeoutCtrl.onChunkReceived();
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
		timeoutCtrl: IdleTimeoutController,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }> {
		const result = await this.handleStreamingChat(url, headers, payload, timeoutCtrl, onChunk);
		return { usage: result.usage, finishReason: result.finishReason };
	}

	private async handleNonStreamingChat(
		url: string,
		headers: Record<string, string>,
		payload: Record<string, unknown>,
		timeoutCtrl: IdleTimeoutController,
	): Promise<ChatResponse> {
		const res = await requestUrlWithAbort({
			url,
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		}, timeoutCtrl.signal);

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
		if (!content && message.refusal) {
			debugLogger.logWarn('llm', `${this.type} structured output refusal: ${message.refusal}`);
		}
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
