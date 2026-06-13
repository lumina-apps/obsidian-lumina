import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, ToolCall } from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';
import { readStreamLines } from '../utils';

interface OpenAIToolCallInfo {
	id?: string;
	name?: string;
	arguments: string;
}

interface OpenAIStreamChunk {
	choices?: Array<{
		delta?: {
			content?: string | null;
			tool_calls?: Array<{
				index: number;
				id?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

interface OpenAIResponse {
	choices?: Array<{
		message?: {
			role?: string;
			content?: string | null;
			tool_calls?: Array<{
				id: string;
				type: 'function';
				function: {
					name: string;
					arguments: string;
				};
			}>;
		};
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

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
		const url = 'https://api.openai.com/v1/chat/completions';
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.apiKey}`,
		};

		const formattedMessages = formatOpenAIMessages(messages);
		const formattedTools = formatOpenAITools(options.tools);

		const payload: Record<string, unknown> = {
			model: options.model,
			messages: formattedMessages,
			temperature: options.temperature ?? 0.7,
			max_tokens: options.maxOutputTokens,
			tools: formattedTools,
			stream: !!onChunk,
		};

		if (options.stop && options.stop.length > 0) {
			payload.stop = options.stop;
		}

		if (onChunk) {
			let fullContent = '';
			const accumulatedToolCalls: OpenAIToolCallInfo[] = [];
			let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;

			const response = await window.fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
				signal: options.signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`OpenAI Error (HTTP ${response.status}): ${errText}`);
			}

			await readStreamLines(response, options.signal, (line) => {
				const cleanLine = line.trim();
				if (!cleanLine || !cleanLine.startsWith('data: ')) return;
				const dataStr = cleanLine.slice(6);
				if (dataStr === '[DONE]') return;

				try {
					const chunk = JSON.parse(dataStr) as OpenAIStreamChunk;
					const choice = chunk.choices?.[0];
					if (choice) {
						const delta = choice.delta;
						if (delta) {
							if (delta.content) {
								fullContent += delta.content;
								onChunk(delta.content);
							}
							if (delta.tool_calls) {
								for (const tc of delta.tool_calls) {
									const index = tc.index ?? 0;
									if (!accumulatedToolCalls[index]) {
										accumulatedToolCalls[index] = {
											id: tc.id || '',
											name: tc.function?.name || '',
											arguments: tc.function?.arguments || '',
										};
									} else {
										if (tc.id) accumulatedToolCalls[index].id = tc.id;
										if (tc.function?.name) accumulatedToolCalls[index].name = tc.function.name;
										if (tc.function?.arguments) accumulatedToolCalls[index].arguments += tc.function.arguments;
									}
								}
							}
						}
					}
					if (chunk.usage) {
						usage = {
							inputTokens: chunk.usage.prompt_tokens,
							outputTokens: chunk.usage.completion_tokens,
							totalTokens: chunk.usage.total_tokens,
						};
					}
				} catch {
					// Ignore json parsing errors
				}
			});

			const toolCalls: ToolCall[] = [];
			for (const tc of accumulatedToolCalls) {
				if (tc) {
					try {
						toolCalls.push({
							id: tc.id || crypto.randomUUID(),
							name: tc.name || '',
							arguments: tc.arguments ? JSON.parse(tc.arguments) as Record<string, unknown> : {},
						});
					} catch {
						console.warn('Failed to parse tool call arguments:', tc.arguments);
					}
				}
			}

			return {
				content: fullContent,
				usage,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			};
		} else {
			// non-streaming
			const res = await requestUrl({
				url,
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			});

			const data = res.json as OpenAIResponse;
			const message = data.choices?.[0]?.message;
			if (!message) {
				throw new Error(`OpenAI API returned an empty response. Response: ${res.text}`);
			}

			const toolCalls: ToolCall[] = [];
			if (message.tool_calls) {
				for (const tc of message.tool_calls) {
					try {
						toolCalls.push({
							id: tc.id || crypto.randomUUID(),
							name: tc.function.name,
							arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) as Record<string, unknown> : {},
						});
					} catch {
						console.warn('Failed to parse tool call arguments:', tc.function.arguments);
					}
				}
			}

			let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;
			if (data.usage) {
				usage = {
					inputTokens: data.usage.prompt_tokens,
					outputTokens: data.usage.completion_tokens,
					totalTokens: data.usage.total_tokens,
				};
			}

			return {
				content: message.content || '',
				usage,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			};
		}
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: import('../../../shared/types/llm.types').TokenUsage }> {
		const url = 'https://api.openai.com/v1/chat/completions';
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.apiKey}`,
		};

		const formattedMessages = formatOpenAIMessages(messages);
		const payload: Record<string, unknown> = {
			model: options.model,
			messages: formattedMessages,
			temperature: options.temperature ?? 0.7,
			max_tokens: options.maxOutputTokens,
			stream: true,
		};

		if (options.stop && options.stop.length > 0) {
			payload.stop = options.stop;
		}

		let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;

		const response = await window.fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			signal: options.signal,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`OpenAI Error (HTTP ${response.status}): ${errText}`);
		}

		await readStreamLines(response, options.signal, (line) => {
			const cleanLine = line.trim();
			if (!cleanLine || !cleanLine.startsWith('data: ')) return;
			const dataStr = cleanLine.slice(6);
			if (dataStr === '[DONE]') return;

			try {
				const chunk = JSON.parse(dataStr) as OpenAIStreamChunk;
				const choice = chunk.choices?.[0];
				if (choice) {
					const delta = choice.delta;
					if (delta && delta.content) {
						onChunk(delta.content);
					}
				}
				if (chunk.usage) {
					usage = {
						inputTokens: chunk.usage.prompt_tokens,
						outputTokens: chunk.usage.completion_tokens,
						totalTokens: chunk.usage.total_tokens,
					};
				}
			} catch {
				// Ignore JSON parse errors
			}
		});

		return { usage };
	}

	async embed(texts: string[], options: { model: string }): Promise<number[][]> {
		try {
			const res = await requestUrl({
				url: 'https://api.openai.com/v1/embeddings',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.apiKey}`,
				},
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


function formatOpenAIMessages(messages: ChatMessage[]) {
	return messages.map((m) => {
		if (m.role === 'system') {
			return { role: 'system', content: m.content };
		}
		if (m.role === 'user') {
			return { role: 'user', content: m.content };
		}
		if (m.role === 'assistant') {
			const payload: Record<string, unknown> = {
				role: 'assistant',
				content: typeof m.content === 'string' ? (m.content || null) : null,
			};
			if (m.tool_calls && m.tool_calls.length > 0) {
				payload.tool_calls = m.tool_calls.map((tc) => ({
					id: tc.id,
					type: 'function',
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments),
					},
				}));
			}
			return payload;
		}
		if (m.role === 'tool') {
			return {
				role: 'tool',
				tool_call_id: m.tool_call_id,
				content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
			};
		}
		return { role: 'user', content: String(m.content) };
	});
}

function formatOpenAITools(tools?: import('../../../shared/types/llm.types').ToolDefinition[]) {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((td) => ({
		type: 'function' as const,
		function: {
			name: td.name,
			description: td.description,
			parameters: td.inputSchema,
		},
	}));
}