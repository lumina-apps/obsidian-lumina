/**
 * openai.provider.ts
 * OpenAI (GPT) 클라우드 프로바이더
 *
 * 사용 패키지: @langchain/openai
 * 모델 목록: /v1/models API 동적 조회
 *             송수신 지원 모델만 필터링 (gpt-, o숙자-, chatgpt-)
 *             임베딩 / TTS / Whisper / DALL-E 제외
 */

import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, ToolCall } from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { tool } from '@langchain/core/tools';
import { requestUrl } from 'obsidian';

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
			const err = error as { status?: string | number; message?: string };
			const status = err.status ? String(err.status) : 'unknown';
			const text = err.message || '';
			throw new Error(t('settings.providerErrors.apiError', { provider: 'OpenAI', status, text }));
		}
	}

	async chat(messages: ChatMessage[], options: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResponse> {
		const llm = this.buildLLM(options);
		const lc = toLangChainMessages(messages);

		// bind tools if provided
		const executor = options.tools && options.tools.length > 0
			? llm.bindTools(options.tools.map(td => tool(
				async () => '',
				{
					name: td.name,
					description: td.description,
					schema: td.inputSchema as unknown as import('zod').ZodType,
				}
			)))
			: llm;

		const res = await executor.invoke(lc, { signal: options.signal });

		let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;
		if (res.usage_metadata) {
			usage = {
				inputTokens: res.usage_metadata.input_tokens,
				outputTokens: res.usage_metadata.output_tokens,
				totalTokens: res.usage_metadata.total_tokens,
			};
		}

		// parse tool_calls from AIMessage
		const toolCalls: ToolCall[] = [];
		if (res.tool_calls && res.tool_calls.length > 0) {
			for (const tc of res.tool_calls) {
				toolCalls.push({
					id: tc.id ?? crypto.randomUUID(),
					name: tc.name,
					arguments: tc.args as Record<string, unknown>,
				});
			}
		}

		return {
			content: typeof res.content === 'string' ? res.content : '',
			usage,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		};
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: import('../../../shared/types/llm.types').TokenUsage }> {
		const llm = this.buildLLM(options);
		const lc = toLangChainMessages(messages);
		const iter = await llm.stream(lc, { signal: options.signal });
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
		});
		return await embeddings.embedDocuments(texts);
	}

	private buildLLM(options: ChatOptions): ChatOpenAI {
		return new ChatOpenAI({
			apiKey: this.apiKey,
			modelName: options.model,
			temperature: options.temperature ?? 0.7,
			maxTokens: options.maxOutputTokens,
			streaming: true,
			maxRetries: 0,
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