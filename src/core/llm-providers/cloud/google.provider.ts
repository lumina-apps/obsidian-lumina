import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, TokenUsage, ToolCall } from '../../../shared/types/llm.types';
import { requestUrl } from 'obsidian';
import { GOOGLE_MODELS, mapUsageMetadata } from './google.types';
import type { GeminiResponse, GeminiStreamChunk, GeminiToolCallInfo } from './google.types';
import { formatGeminiMessages, formatGeminiTools, getGeminiSystemInstruction } from './google-message-formatter';
import { readGeminiStreamChunks } from './google-stream-parser';
import { raiseApiError } from '../utils';

type GeminiCandidate = NonNullable<GeminiResponse['candidates']>[number];

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
			raiseApiError(error, 'Google');
		}
	}

	async chat(messages: ChatMessage[], options: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResponse> {
		if (onChunk) {
			const accumulatedToolCalls: GeminiToolCallInfo[] = [];

			const { content, usage, finishReason } = await this.streamInternal(
				messages,
				options,
				(chunk, chunkData) => {
					onChunk(chunk);
					if (!chunkData) return;
					const candidate = chunkData.candidates?.[0];
					const parts = candidate?.content?.parts;
					if (parts) {
						for (const part of parts) {
							if (part.functionCall) {
								accumulatedToolCalls.push({
									name: part.functionCall.name,
									args: part.functionCall.args || {},
									thoughtSignature: part.thoughtSignature,
								});
							}
						}
					}
				},
				true,
			);

			const toolCalls: ToolCall[] = accumulatedToolCalls.map(tc => ({
				id: crypto.randomUUID(),
				name: tc.name,
				arguments: tc.args || {},
				thoughtSignature: tc.thoughtSignature,
			}));

			return {
				content,
				usage,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				finishReason,
			};
		}

		// 비스트리밍
		const { url, headers, payload } = this.buildRequest('generateContent', options, messages, true);
		const res = await requestUrl({ url, method: 'POST', headers, body: JSON.stringify(payload) });

		const data = res.json as GeminiResponse;
		const candidate = data.candidates?.[0];
		if (!candidate) {
			throw new Error(`Google Gemini API returned an empty response. Response: ${res.text}`);
		}

		const { fullContent, toolCalls } = parseNonStreamingResponse(candidate);
		const usage = data.usageMetadata ? mapUsageMetadata(data.usageMetadata) : undefined;

		return {
			content: fullContent,
			usage,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			finishReason: candidate.finishReason || undefined,
		};
	}

	async stream(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (chunk: string) => void,
	): Promise<{ usage?: TokenUsage; finishReason?: string }> {
		const { usage, finishReason } = await this.streamInternal(messages, options, (text) => onChunk(text), true);
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

	// ─── Private ──────────────────────────────────────────────────────────

	private buildRequest(
		method: 'generateContent' | 'streamGenerateContent',
		options: ChatOptions,
		messages: ChatMessage[],
		includeTools: boolean,
	): { url: string; headers: Record<string, string>; payload: Record<string, unknown> } {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:${method}?key=${this.apiKey}`;

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

		if (includeTools) {
			const formattedTools = formatGeminiTools(options.tools);
			if (formattedTools) {
				payload.tools = formattedTools;
			}
		}

		return { url, headers, payload };
	}

	private async streamInternal(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: (text: string, chunkData?: GeminiStreamChunk) => void,
		includeTools: boolean,
	): Promise<{ content: string; usage?: TokenUsage; finishReason?: string }> {
		const { url, headers, payload } = this.buildRequest('streamGenerateContent', options, messages, includeTools);

		let fullContent = '';
		let usage: TokenUsage | undefined;
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
							onChunk(part.text, chunk);
						}
					}
				}
			}
			if (chunk.usageMetadata) {
				usage = mapUsageMetadata(chunk.usageMetadata);
			}
		});

		return { content: fullContent, usage, finishReason };
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNonStreamingResponse(candidate: GeminiCandidate): {
	fullContent: string;
	toolCalls: ToolCall[];
} {
	let fullContent = '';
	const toolCalls: ToolCall[] = [];
	const parts = candidate?.content?.parts;

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

	return { fullContent, toolCalls };
}