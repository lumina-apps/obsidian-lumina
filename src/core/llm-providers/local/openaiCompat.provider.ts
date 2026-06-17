import type { ProviderType } from '../../../shared/types/settings.types';
import type {
	ChatMessage,
	ChatOptions,
	ChatResponse,
	ILLMProvider,
	TokenUsage,
} from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';
import { formatOpenAIMessages, formatOpenAITools } from '../openai-formatter';
import type { OpenAIResponse } from '../openai-types';
import { raiseApiError, readStreamLines } from '../provider-helpers';
import { mapOpenAIUsage, convertOpenAIToolCalls, wrapReasoningContent, StreamChunkAccumulator } from '../stream-accumulator';
import type { OpenAIToolCallInfo } from '../openai-types';

/** 로컬 모델에서 사용하는 기본 stop 시퀀스 */
const LOCAL_STOP_SEQUENCES: string[] = [
	'<|im_end|>',
	'<|endoftext|>',
	'<|eot_id|>',
	'<|end_of_text|>',
];

export class OpenAICompatProvider implements ILLMProvider {
	readonly providerId: string;
	private type: ProviderType;
	private baseUrl: string;
	/** 클라우드 커스텀 프로바이더의 경우 API 키도 받을 수 있음 */
	private apiKey: string;

	constructor(providerId: string, type: ProviderType, baseUrl: string, apiKey = 'ollama') {
		this.providerId = providerId;
		this.type = type;
		// 후행 슬래시 제거
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.apiKey = apiKey || 'ollama'; // Ollama/LM Studio는 아무 문자열이나 가능
	}

	async listModels(): Promise<string[]> {
		if (this.type === 'ollama') {
			return this.listOllamaModels();
		}
		return this.listOpenAICompatModels();
	}

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
		return this.handleNonStreamingChat(url, headers, payload);
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

		const stopSeq = options.stop ?? LOCAL_STOP_SEQUENCES;
		if (stopSeq.length > 0) {
			payload.stop = stopSeq;
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

		const stopSeq = options.stop ?? LOCAL_STOP_SEQUENCES;
		if (stopSeq.length > 0) {
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

		const accumulator = new StreamChunkAccumulator(onChunk, { enableReasoning: true });

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

		const accumulator = new StreamChunkAccumulator(onChunk, { enableReasoning: true });

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

		const reasoning = (message.reasoning_content ?? message.reasoning) ?? undefined;
		const content = wrapReasoningContent(reasoning, message.content || '');

		return {
			content,
			usage,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			finishReason,
		};
	}

	// ─── Model listing ──────────────────────────────────────────────────────

	private async listOllamaModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: `${this.baseUrl}/api/tags`,
				method: 'GET',
			});
			const data = res.json as { models: { name: string }[] };
			if (!data.models?.length) throw new Error(t('settings.providerErrors.ollamaNoModel'));
			return data.models.map((m) => m.name);
		} catch (error) {
			raiseApiError(error, 'Ollama');
		}
	}

	private async listOpenAICompatModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: `${this.baseUrl}/v1/models`,
				method: 'GET',
				headers: { Authorization: `Bearer ${this.apiKey}` },
			});
			const data = res.json as { data: { id: string }[] };
			return data.data.map((m) => m.id);
		} catch (error) {
			raiseApiError(error, this.type);
		}
	}
}