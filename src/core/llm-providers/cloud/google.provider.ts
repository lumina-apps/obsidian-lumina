import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, ToolCall } from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';
import { readStreamLines } from '../utils';
import { debugLogger } from '../../../shared/debugLogger';

interface GeminiToolCallInfo {
	name: string;
	args: Record<string, unknown>;
	thoughtSignature?: string;
}

interface GeminiStreamChunk {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
				functionCall?: {
					name: string;
					args?: Record<string, unknown>;
				};
				thoughtSignature?: string;
			}>;
		};
		finishReason?: string;
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
}

interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
				functionCall?: {
					name: string;
					args?: Record<string, unknown>;
				};
				thoughtSignature?: string;
			}>;
		};
		finishReason?: string;
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
}

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

		const payload: Record<string, unknown> = {
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
			const accumulatedToolCalls: GeminiToolCallInfo[] = [];
			let usage: import('../../../shared/types/llm.types').TokenUsage | undefined;
			let finishReason: string | undefined;

			const response = await window.fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
				signal: options.signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`Google Gemini Error (HTTP ${response.status}): ${errText}`);
			}

			await readGeminiStreamChunks(response, options.signal, (chunk) => {
				const candidate = chunk.candidates?.[0];
				if (candidate) {
					if (candidate.finishReason) {
						finishReason = candidate.finishReason;
					}
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
									args: part.functionCall.args || {},
									thoughtSignature: part.thoughtSignature,
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
			});

			const toolCalls: ToolCall[] = [];
			for (const tc of accumulatedToolCalls) {
				if (tc) {
					toolCalls.push({
						id: crypto.randomUUID(),
						name: tc.name,
						arguments: tc.args || {},
						thoughtSignature: tc.thoughtSignature,
					});
				}
			}

			return {
				content: fullContent,
				usage,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				finishReason,
			};
		} else {
			// non-streaming
			const res = await requestUrl({
				url,
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			});

			const data = res.json as GeminiResponse;
			const candidate = data.candidates?.[0];
			if (!candidate) {
				throw new Error(`Google Gemini API returned an empty response. Response: ${res.text}`);
			}
			const finishReason = candidate.finishReason || undefined;

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
							thoughtSignature: part.thoughtSignature,
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
				finishReason,
			};
		}
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: import('../../../shared/types/llm.types').TokenUsage; finishReason?: string }> {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:streamGenerateContent?key=${this.apiKey}`;
		
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		const formattedContents = formatGeminiMessages(messages);
		const systemInstruction = getGeminiSystemInstruction(messages);

		const payload: Record<string, unknown> = {
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
		let finishReason: string | undefined;

		const response = await window.fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			signal: options.signal,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`Google Gemini Error (HTTP ${response.status}): ${errText}`);
		}

		await readGeminiStreamChunks(response, options.signal, (chunk) => {
			const candidate = chunk.candidates?.[0];
			if (candidate) {
				if (candidate.finishReason) {
					finishReason = candidate.finishReason;
				}
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
		});

		return { usage, finishReason };
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

async function readGeminiStreamChunks(
	response: Response,
	signal: AbortSignal | undefined,
	onChunk: (chunk: GeminiStreamChunk) => void
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('Response body is not readable');
	}
	const decoder = new TextDecoder('utf-8');
	let buffer = '';
	let braceCount = 0;
	let inString = false;
	let escape = false;
	let objectStart = -1;

	try {
		while (true) {
			if (signal?.aborted) {
				await reader.cancel();
				break;
			}
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			let i = 0;
			while (i < buffer.length) {
				const char = buffer[i];

				if (inString) {
					if (escape) {
						escape = false;
					} else if (char === '\\') {
						escape = true;
					} else if (char === '"') {
						inString = false;
					}
				} else {
					if (char === '"') {
						inString = true;
					} else if (char === '{') {
						if (braceCount === 0) {
							objectStart = i;
						}
						braceCount++;
					} else if (char === '}') {
						braceCount--;
						if (braceCount === 0 && objectStart !== -1) {
							const objStr = buffer.substring(objectStart, i + 1);
							try {
								const chunk = JSON.parse(objStr) as GeminiStreamChunk;
								onChunk(chunk);
							} catch (e) {
								debugLogger.logError('Gemini Stream Parse', `Failed to parse chunk: "${objStr}". Error: ${e instanceof Error ? e.message : String(e)}`);
							}
							buffer = buffer.substring(i + 1);
							i = -1;
							objectStart = -1;
						}
					}
				}
				i++;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

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
			const parts: Array<
				| { text: string }
				| { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
			> = [];
			const contentText = typeof m.content === 'string' ? m.content : '';
			const isMockToolText = contentText.startsWith('Calling tool');
			if (contentText && !isMockToolText) {
				parts.push({ text: contentText });
			}
			if (m.tool_calls && m.tool_calls.length > 0) {
				for (const tc of m.tool_calls) {
					parts.push({
						functionCall: {
							name: tc.name,
							args: tc.arguments,
						},
						...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {})
					});
				}
			}
			return { role: 'model', parts };
		}
		if (m.role === 'tool') {
			let responseObj: Record<string, unknown> = { content: m.content };
			try {
				if (typeof m.content === 'string') {
					const parsed = JSON.parse(m.content) as unknown;
					if (typeof parsed === 'object' && parsed !== null) {
						responseObj = parsed as Record<string, unknown>;
					}
				}
			} catch {
				// not a JSON string, keep wrapping
			}
			return {
				role: 'function',
				parts: [
					{
						functionResponse: {
							name: m.name || '',
							response: responseObj,
						},
						...(m.thoughtSignature ? { thoughtSignature: m.thoughtSignature } : {})
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