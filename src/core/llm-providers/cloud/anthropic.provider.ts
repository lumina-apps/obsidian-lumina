import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, ToolCall } from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';
import { readStreamLines } from '../utils';

/** Anthropic 공식 지원 모델 목록 (최신순) */
const ANTHROPIC_MODELS = [
	'claude-opus-4-5',
	'claude-sonnet-4-5',
	'claude-haiku-3-5',
	'claude-3-opus-latest',
	'claude-3-5-sonnet-latest',
	'claude-3-5-haiku-latest',
	'claude-3-haiku-20240307',
];

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

			return apiModels.length > 0 ? apiModels : ANTHROPIC_MODELS;
		} catch (error) {
			const err = error as { status?: string | number; message?: string };
			const status = err.status ? String(err.status) : 'unknown';
			const text = err.message || '';
			throw new Error(t('settings.providerErrors.apiError', { provider: 'Anthropic', status, text }));
		}
	}

	async chat(messages: ChatMessage[], options: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResponse> {
		const url = 'https://api.anthropic.com/v1/messages';
		const headers: Record<string, string> = {
			'content-type': 'application/json',
			'x-api-key': this.apiKey,
			'anthropic-version': '2023-06-01',
		};

		const system = getSystemPrompt(messages);
		const formattedMessages = formatAnthropicMessages(messages);
		const formattedTools = formatAnthropicTools(options.tools);

		const payload: Record<string, any> = {
			model: options.model,
			messages: formattedMessages,
			temperature: options.temperature ?? 0.7,
			max_tokens: options.maxOutputTokens ?? 4096,
			tools: formattedTools,
			stream: !!onChunk,
		};

		if (system) {
			payload.system = system;
		}

		if (onChunk) {
			let fullContent = '';
			const accumulatedBlocks: any[] = [];
			let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;

			const response = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
				signal: options.signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`Anthropic Error (HTTP ${response.status}): ${errText}`);
			}

			await readStreamLines(response, options.signal, (line) => {
				const cleanLine = line.trim();
				if (!cleanLine) return;

				if (cleanLine.startsWith('data: ')) {
					const dataStr = cleanLine.slice(6);
					try {
						const chunk = JSON.parse(dataStr);
						if (chunk.type === 'message_start' && chunk.message?.usage) {
							usage = {
								inputTokens: chunk.message.usage.input_tokens || 0,
								outputTokens: chunk.message.usage.output_tokens || 0,
								totalTokens: (chunk.message.usage.input_tokens || 0) + (chunk.message.usage.output_tokens || 0),
							};
						}
						else if (chunk.type === 'content_block_start') {
							const index = chunk.index ?? 0;
							accumulatedBlocks[index] = {
								type: chunk.content_block?.type,
								id: chunk.content_block?.id || '',
								name: chunk.content_block?.name || '',
								input: '',
								text: '',
							};
						}
						else if (chunk.type === 'content_block_delta') {
							const index = chunk.index ?? 0;
							const block = accumulatedBlocks[index];
							if (block) {
								if (chunk.delta?.type === 'text_delta' && chunk.delta.text) {
									block.text += chunk.delta.text;
									fullContent += chunk.delta.text;
									onChunk(chunk.delta.text);
								}
								else if (chunk.delta?.type === 'input_json_delta' && chunk.delta.partial_json) {
									block.input += chunk.delta.partial_json;
								}
							}
						}
						else if (chunk.type === 'message_delta') {
							if (chunk.usage && usage) {
								usage.outputTokens = chunk.usage.output_tokens || usage.outputTokens;
								usage.totalTokens = usage.inputTokens + usage.outputTokens;
							}
						}
					} catch (e) {
						// ignore parse errors
					}
				}
			});

			const toolCalls: ToolCall[] = [];
			for (const block of accumulatedBlocks) {
				if (block && block.type === 'tool_use') {
					try {
						toolCalls.push({
							id: block.id || crypto.randomUUID(),
							name: block.name,
							arguments: block.input ? JSON.parse(block.input) : {},
						});
					} catch (e) {
						console.warn('Failed to parse Anthropic tool arguments:', block.input);
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

			const data = res.json as any;
			if (!data.content) {
				throw new Error(`Anthropic API returned an empty response. Response: ${res.text}`);
			}

			let fullContent = '';
			const toolCalls: ToolCall[] = [];

			for (const block of data.content) {
				if (block.type === 'text') {
					fullContent += block.text || '';
				} else if (block.type === 'tool_use') {
					toolCalls.push({
						id: block.id || crypto.randomUUID(),
						name: block.name,
						arguments: block.input || {},
					});
				}
			}

			let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;
			if (data.usage) {
				usage = {
					inputTokens: data.usage.input_tokens || 0,
					outputTokens: data.usage.output_tokens || 0,
					totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
				};
			}

			return {
				content: fullContent,
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
		const url = 'https://api.anthropic.com/v1/messages';
		const headers: Record<string, string> = {
			'content-type': 'application/json',
			'x-api-key': this.apiKey,
			'anthropic-version': '2023-06-01',
		};

		const system = getSystemPrompt(messages);
		const formattedMessages = formatAnthropicMessages(messages);

		const payload: Record<string, any> = {
			model: options.model,
			messages: formattedMessages,
			temperature: options.temperature ?? 0.7,
			max_tokens: options.maxOutputTokens ?? 4096,
			stream: true,
		};

		if (system) {
			payload.system = system;
		}

		let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			signal: options.signal,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`Anthropic Error (HTTP ${response.status}): ${errText}`);
		}

		await readStreamLines(response, options.signal, (line) => {
			const cleanLine = line.trim();
			if (!cleanLine) return;

			if (cleanLine.startsWith('data: ')) {
				const dataStr = cleanLine.slice(6);
				try {
					const chunk = JSON.parse(dataStr);
					if (chunk.type === 'message_start' && chunk.message?.usage) {
						usage = {
							inputTokens: chunk.message.usage.input_tokens || 0,
							outputTokens: chunk.message.usage.output_tokens || 0,
							totalTokens: (chunk.message.usage.input_tokens || 0) + (chunk.message.usage.output_tokens || 0),
						};
					}
					else if (chunk.type === 'content_block_delta') {
						if (chunk.delta?.type === 'text_delta' && chunk.delta.text) {
							onChunk(chunk.delta.text);
						}
					}
					else if (chunk.type === 'message_delta') {
						if (chunk.usage && usage) {
							usage.outputTokens = chunk.usage.output_tokens || usage.outputTokens;
							usage.totalTokens = usage.inputTokens + usage.outputTokens;
						}
					}
				} catch (e) {
					// ignore json parse errors
				}
			}
		});

		return { usage };
	}

	async embed(texts: string[], options: { model: string }): Promise<number[][]> {
		throw new Error(t('settings.providerErrors.anthropicNoEmbed'));
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSystemPrompt(messages: ChatMessage[]): string | undefined {
	const systemMsgs = messages.filter(m => m.role === 'system');
	if (systemMsgs.length === 0) return undefined;
	return systemMsgs.map(m => m.content).join('\n');
}

function formatAnthropicMessages(messages: ChatMessage[]) {
	// Filter out system messages
	const filtered = messages.filter(m => m.role !== 'system');
	return filtered.map((m) => {
		if (m.role === 'user') {
			return { role: 'user', content: m.content };
		}
		if (m.role === 'assistant') {
			const contentArray: any[] = [];
			if (typeof m.content === 'string' && m.content) {
				contentArray.push({ type: 'text', text: m.content });
			}
			if (m.tool_calls && m.tool_calls.length > 0) {
				for (const tc of m.tool_calls) {
					contentArray.push({
						type: 'tool_use',
						id: tc.id,
						name: tc.name,
						input: tc.arguments,
					});
				}
			}
			return { role: 'assistant', content: contentArray };
		}
		if (m.role === 'tool') {
			return {
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: m.tool_call_id,
						content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
					}
				]
			};
		}
		return { role: 'user', content: String(m.content) };
	});
}

function formatAnthropicTools(tools?: import('../../../shared/types/llm.types').ToolDefinition[]) {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((td) => ({
		name: td.name,
		description: td.description,
		input_schema: {
			type: 'object',
			properties: td.inputSchema.properties,
			required: td.inputSchema.required || [],
		},
	}));
}