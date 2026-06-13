/**
 * google.provider.ts
 * Google Gemini 클라우드 프로바이더
 *
 * 사용 패키지: @langchain/google-genai
 * 모델 목록: /v1beta/models API 동적 조회
 *             generateContent 지원 모델만 필터링 (임베딩 전용 모델 제외)
 *             API 실패 시 하드코딩 fallback 사용
 */

import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { TaskType } from '@google/generative-ai';
import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, ToolCall } from '../../../shared/types/llm.types';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { t } from '../../../shared/locales/helpers';
import { tool } from '@langchain/core/tools';
import { requestUrl } from 'obsidian';

/** Google Gemini 지원 모델 목록 (최신순) */
const GOOGLE_MODELS = [
	'gemini-2.0-flash',
	'gemini-2.0-flash-lite',
	'gemini-2.5-pro-preview-06-05',
	'gemini-2.5-flash-preview-05-20',
	'gemini-1.5-pro',
	'gemini-1.5-flash',
	'gemini-1.5-flash-8b',
	'text-embedding-004',
];

export class GoogleProvider implements ILLMProvider {
	readonly providerId: string;
	private apiKey: string;

	constructor(providerId: string, apiKey: string) {
		this.providerId = providerId;
		this.apiKey = apiKey;
	}

	async listModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
				method: 'GET',
			});
			const data = res.json as {
				models: { name: string; supportedGenerationMethods?: string[] }[]
			};
			const apiModels = data.models
				.filter(m =>
					(m.name.startsWith('models/gemini') && (m.supportedGenerationMethods ?? []).includes('generateContent')) ||
					m.name.includes('embedding')
				)
				.map(m => m.name.replace('models/', ''));

			return apiModels.length > 0 ? apiModels : GOOGLE_MODELS;
		} catch (error) {
			const err = error as { status?: string | number; message?: string };
			const status = err.status ? String(err.status) : 'unknown';
			const text = err.message || '';
			throw new Error(t('settings.providerErrors.apiError', { provider: 'Google', status, text }));
		}
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
		const embeddings = new GoogleGenerativeAIEmbeddings({
			apiKey: this.apiKey,
			modelName: options.model,
			taskType: TaskType.RETRIEVAL_DOCUMENT,
		});
		return await embeddings.embedDocuments(texts);
	}

	private buildLLM(options: ChatOptions): ChatGoogleGenerativeAI {
		return new ChatGoogleGenerativeAI({
			apiKey: this.apiKey,
			model: options.model,
			temperature: options.temperature ?? 0.7,
			maxOutputTokens: options.maxOutputTokens,
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