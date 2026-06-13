import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, ToolCall } from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';
import { readStreamLines } from '../utils';

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
		const isStream = !!onChunk;
		const method = isStream ? 'streamGenerateContent' : 'generateContent';
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:${method}?key=${this.apiKey}`;
		
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		const formattedContents = formatGeminiMessages(messages);
		const systemInstruction = getGeminiSystemInstruction(messages);
		const formattedTools = formatGeminiTools(options.tools);

		const payload: Record<string, any> = {
			contents: formattedContents,
			generationConfig: {
				temperature: options.temperature ?? 0.7,
				maxOutputTokens: options.maxOutputTokens,
			}
		};

		if (systemInstruction) {
			payload.systemInstruction = systemInstruction;
		}

		if (formattedTools) {
			payload.tools = formattedTools;
		}

		if (isStream) {
			let fullContent = '';
			const accumulatedToolCalls: any[] = [];
			let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;

			const response = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
				signal: options.signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`Google Gemini Error (HTTP ${response.status}): ${errText}`);
			}

			await readStreamLines(response, options.signal, (line) => {
				let cleanLine = line.trim();
				if (cleanLine.startsWith('[')) cleanLine = cleanLine.slice(1).trim();
				if (cleanLine.endsWith(']')) cleanLine = cleanLine.slice(0, -1).trim();
				if (cleanLine.endsWith(',')) cleanLine = cleanLine.slice(0, -1).trim();
				if (!cleanLine) return;

				try {
					const chunk = JSON.parse(cleanLine);
					const candidate = chunk.candidates?.[0];
					if (candidate) {
						const parts = candidate.content?.parts;
						if (parts) {
							for (const part of parts) {
								if (part.text) {
									fullContent += part.text;
									onChunk(part.text);
								}
								if (part.functionCall) {
									accumulatedToolCalls.push({
										name: part.functionCall.name,
										args: part.functionCall.args,
									});
								}
							}
						}
					}
					if (chunk.usageMetadata) {
						usage = {
							inputTokens: chunk.usageMetadata.promptTokenCount || 0,
							outputTokens: chunk.usageMetadata.candidatesTokenCount || 0,
							totalTokens: chunk.usageMetadata.totalTokenCount || 0,
						};
					}
				} catch (e) {
					// Ignore line boundaries parsing errors
				}
			});

			const toolCalls: ToolCall[] = [];
			for (const tc of accumulatedToolCalls) {
				if (tc) {
					toolCalls.push({
						id: crypto.randomUUID(),
						name: tc.name,
						arguments: tc.args || {},
					});
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
			const candidate = data.candidates?.[0];
			if (!candidate) {
				throw new Error(`Google Gemini API returned an empty response. Response: ${res.text}`);
			}

			let fullContent = '';
			const toolCalls: ToolCall[] = [];
			const parts = candidate.content?.parts;

			if (parts) {
				for (const part of parts) {
					if (part.text) {
						fullContent += part.text;
					}
					if (part.functionCall) {
						toolCalls.push({
							id: crypto.randomUUID(),
							name: part.functionCall.name,
							arguments: part.functionCall.args || {},
						});
					}
				}
			}

			let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;
			if (data.usageMetadata) {
				usage = {
					inputTokens: data.usageMetadata.promptTokenCount || 0,
					outputTokens: data.usageMetadata.candidatesTokenCount || 0,
					totalTokens: data.usageMetadata.totalTokenCount || 0,
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
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:streamGenerateContent?key=${this.apiKey}`;
		
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		const formattedContents = formatGeminiMessages(messages);
		const systemInstruction = getGeminiSystemInstruction(messages);

		const payload: Record<string, any> = {
			contents: formattedContents,
			generationConfig: {
				temperature: options.temperature ?? 0.7,
				maxOutputTokens: options.maxOutputTokens,
			}
		};

		if (systemInstruction) {
			payload.systemInstruction = systemInstruction;
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
			throw new Error(`Google Gemini Error (HTTP ${response.status}): ${errText}`);
		}

		await readStreamLines(response, options.signal, (line) => {
			let cleanLine = line.trim();
			if (cleanLine.startsWith('[')) cleanLine = cleanLine.slice(1).trim();
			if (cleanLine.endsWith(']')) cleanLine = cleanLine.slice(0, -1).trim();
			if (cleanLine.endsWith(',')) cleanLine = cleanLine.slice(0, -1).trim();
			if (!cleanLine) return;

			try {
				const chunk = JSON.parse(cleanLine);
				const candidate = chunk.candidates?.[0];
				if (candidate) {
					const parts = candidate.content?.parts;
					if (parts) {
						for (const part of parts) {
							if (part.text) {
								onChunk(part.text);
							}
						}
					}
				}
				if (chunk.usageMetadata) {
					usage = {
						inputTokens: chunk.usageMetadata.promptTokenCount || 0,
						outputTokens: chunk.usageMetadata.candidatesTokenCount || 0,
						totalTokens: chunk.usageMetadata.totalTokenCount || 0,
					};
				}
			} catch (e) {
				// Ignore line boundaries parsing errors
			}
		});

		return { usage };
	}

	async embed(texts: string[], options: { model: string }): Promise<number[][]> {
		try {
			const modelName = options.model.startsWith('models/') ? options.model : `models/${options.model}`;
			const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:batchEmbedContents?key=${this.apiKey}`;
			
			const requests = texts.map((text) => ({
				model: modelName,
				content: {
					parts: [{ text }],
				},
			}));

			const res = await requestUrl({
				url,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ requests }),
			});

			const data = res.json as { embeddings: { values: number[] }[] };
			return data.embeddings.map((e) => e.values);
		} catch (error) {
			throw new Error(`Google Gemini Embedding Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGeminiSystemInstruction(messages: ChatMessage[]) {
	const systemMsgs = messages.filter(m => m.role === 'system');
	if (systemMsgs.length === 0) return undefined;
	return {
		parts: [{ text: systemMsgs.map(m => m.content).join('\n') }]
	};
}

function formatGeminiMessages(messages: ChatMessage[]) {
	const filtered = messages.filter(m => m.role !== 'system');
	return filtered.map((m) => {
		if (m.role === 'user') {
			if (Array.isArray(m.content)) {
				const parts = m.content.map(c => {
					if (c.type === 'text') {
						return { text: c.text };
					} else {
						const match = c.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
						if (match) {
							return {
								inlineData: {
									mimeType: match[1],
									data: match[2],
								}
							};
						}
						return { text: '[Image Url]' };
					}
				});
				return { role: 'user', parts };
			}
			return { role: 'user', parts: [{ text: m.content }] };
		}
		if (m.role === 'assistant') {
			const parts: any[] = [];
			if (typeof m.content === 'string' && m.content) {
				parts.push({ text: m.content });
			}
			if (m.tool_calls && m.tool_calls.length > 0) {
				parts.push({
					functionCalls: m.tool_calls.map(tc => ({
						name: tc.name,
						args: tc.arguments,
					}))
				});
			}
			return { role: 'model', parts };
		}
		if (m.role === 'tool') {
			let responseObj: any = { content: m.content };
			try {
				if (typeof m.content === 'string') {
					responseObj = JSON.parse(m.content);
					if (typeof responseObj !== 'object' || responseObj === null) {
						responseObj = { content: m.content };
					}
				}
			} catch (e) {
				// not a JSON string, keep wrapping
			}
			return {
				role: 'function',
				parts: [
					{
						functionResponse: {
							name: m.name || '',
							response: responseObj,
						}
					}
				]
			};
		}
		return { role: 'user', parts: [{ text: String(m.content) }] };
	});
}

function formatGeminiTools(tools?: import('../../../shared/types/llm.types').ToolDefinition[]) {
	if (!tools || tools.length === 0) return undefined;
	return [{
		functionDeclarations: tools.map(td => ({
			name: td.name,
			description: td.description,
			parameters: td.inputSchema,
		}))
	}];
}