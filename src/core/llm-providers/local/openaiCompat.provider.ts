/**
 * openaiCompat.provider.ts
 * OpenAI 호환 로컬 LLM 프로바이더 (Ollama, LM Studio, Custom)
 *
 * - Ollama: /v1/ OpenAI 호환 엔드포인트 또는 /api/tags 로 모델 목록 조회
 * - LM Studio: /v1/models 로 모델 목록 조회
 * - Custom: /v1/models 시도, 실패 시 credential 입력 그대로 baseURL 사용
 *
 * API 키 없이 baseURL만으로 동작.
 */

import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type { ProviderType } from '../../../shared/types/settings.types';
import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, ToolCall } from '../../../shared/types/llm.types';
import { debugLogger } from '../../../shared/debugLogger';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage, AIMessageChunk } from '@langchain/core/messages';

import { tool } from '@langchain/core/tools';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';

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
		// Ollama는 /api/tags 를 우선 시도
		if (this.type === 'ollama') {
			return this.listOllamaModels();
		}
		// 나머지는 OpenAI 호환 /v1/models
		return this.listOpenAICompatModels();
	}

	async chat(messages: ChatMessage[], options: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResponse> {
		const llm = this.buildLLM(options);
		const lc = toLangChainMessages(messages);

		const executor = options.tools && options.tools.length > 0
			? llm.bindTools(options.tools.map(td => tool(
				async () => '',
				{
					name: td.name,
					description: td.description,
					schema: td.inputSchema as unknown as import('zod').ZodTypeAny,
				}
			)))
			: llm;

		const stopSeq = options.stop ?? ["<|im_end|>", "<|endoftext|>", "<|eot_id|>", "<|end_of_text|>"];
		const streamOptions: { signal?: AbortSignal; stop?: string[] } = { signal: options.signal };
		if (stopSeq.length > 0) {
			streamOptions.stop = stopSeq;
		}
		debugLogger.logMcp('Stream Options', `🔍 chat stream 옵션`, { stop: streamOptions.stop, hasSignal: !!streamOptions.signal });

		// .invoke() 대신 .stream()으로 응답을 직접 수집 (Ollama 호환성)
		const stream = await executor.stream(lc, streamOptions);
		let finalMessage: AIMessageChunk | null = null;
		let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;

		for await (const chunk of stream) {
			const aiChunk = chunk as AIMessageChunk & {
				usage_metadata?: {
					input_tokens: number;
					output_tokens: number;
					total_tokens: number;
				};
			};
			if (!finalMessage) {
				finalMessage = aiChunk;
			} else {
				finalMessage = finalMessage.concat(aiChunk);
			}

			if (onChunk && typeof aiChunk.content === 'string' && aiChunk.content) {
				onChunk(aiChunk.content);
			}

			if (aiChunk.usage_metadata) {
				usage = {
					inputTokens: aiChunk.usage_metadata.input_tokens,
					outputTokens: aiChunk.usage_metadata.output_tokens,
					totalTokens: aiChunk.usage_metadata.total_tokens,
				};
			}
		}

		let content = typeof finalMessage?.content === 'string' ? finalMessage.content : '';
		
		const toolCalls: ToolCall[] = [];
		if (finalMessage) {
			const tcList = finalMessage.tool_calls as Array<{ id?: string; name: string; args?: unknown }> | undefined;
			if (tcList && tcList.length > 0) {
				for (const tc of tcList) {
					toolCalls.push({
						id: tc.id || crypto.randomUUID(),
						name: tc.name,
						arguments: (tc.args as Record<string, unknown>) || {},
					});
				}
			}
		}

		debugLogger.logMcp('Raw API Response', `🔍 raw 응답`, {
			content_type: typeof content,
			content_len: content.length,
			content_preview: content.substring(0, 200),
			tool_calls: toolCalls.length,
			usage_metadata: usage,
		});

		return {
			content,
			usage,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		};
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: import('../../../shared/types/llm.types').TokenUsage }> {
		const llm = new ChatOpenAI({
			apiKey: this.apiKey,
			modelName: options.model,
			temperature: options.temperature ?? 0.7,
			maxTokens: options.maxOutputTokens,
			streaming: true,
			maxRetries: 0,
			configuration: {
				baseURL: `${this.baseUrl}/v1`,
			},
		});
		const lc = toLangChainMessages(messages);
		const iter = await llm.stream(lc, { 
			signal: options.signal,
			stop: ["<|im_end|>", "<|endoftext|>", "<|eot_id|>", "<|end_of_text|>"]
		});
		let usage;
		for await (const chunk of iter) {
			if (chunk.usage_metadata) {
				usage = {
					inputTokens: chunk.usage_metadata.input_tokens,
					outputTokens: chunk.usage_metadata.output_tokens,
					totalTokens: chunk.usage_metadata.total_tokens,
				};
			}
			const text = typeof chunk.content === 'string' ? chunk.content : '';
			if (text) onChunk(text);
		}
		return { usage };
	}

	async embed(texts: string[], options: { model: string }): Promise<number[][]> {
		const embeddings = new OpenAIEmbeddings({
			apiKey: this.apiKey,
			modelName: options.model,
			configuration: {
				baseURL: `${this.baseUrl}/v1`,
			},
		});
		return await embeddings.embedDocuments(texts);
	}

	// ─── Model listing ────────────────────────────────────────────────────────

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
			const err = error as { status?: string | number; message?: string };
			const status = err.status ? String(err.status) : 'unknown';
			const text = err.message || '';
			throw new Error(t('settings.providerErrors.apiError', { provider: 'Ollama', status, text }));
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
			const err = error as { status?: string | number; message?: string };
			const status = err.status ? String(err.status) : 'unknown';
			const text = err.message || '';
			throw new Error(t('settings.providerErrors.connectFail', { status, text }));
		}
	}

	// ─── LangChain builder ────────────────────────────────────────────────────

	private buildLLM(options: ChatOptions): ChatOpenAI {
		return new ChatOpenAI({
			apiKey: this.apiKey,
			modelName: options.model,
			temperature: options.temperature ?? 0.7,
			maxTokens: options.maxOutputTokens,
			streaming: true,
			maxRetries: 0,
			configuration: {
				baseURL: `${this.baseUrl}/v1`,
			},
		});
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function toLangChainMessages(messages: ChatMessage[]) {
	return messages.map((m) => {
		if (m.role === 'system') return new SystemMessage(m.content as string);
		if (m.role === 'user') return new HumanMessage({ content: m.content as unknown as import('@langchain/core/messages').MessageContent });
		if (m.role === 'tool') return new ToolMessage({
			name: m.name ?? '',
			content: m.content as string,
			tool_call_id: m.tool_call_id ?? '',
		});
		if (m.role === 'assistant') return new AIMessage({
			content: m.content as string,
			tool_calls: m.tool_calls?.map(tc => ({
				id: tc.id,
				name: tc.name,
				args: tc.arguments,
				type: 'tool_call' as const,
			})),
		});
		return new SystemMessage(m.content as string); // unreachable, fallback
	});
}