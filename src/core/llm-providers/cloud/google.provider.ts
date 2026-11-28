import type { ChatMessage, ChatOptions, ChatResponse, ILLMProvider, TokenUsage, ToolCall } from '../../../shared/types/llm.types';
import { requestUrl } from 'obsidian';
import { GOOGLE_MODELS, mapUsageMetadata } from './google.types';
import type { GeminiResponse } from './google.types';
import { formatGeminiMessages, formatGeminiTools, getGeminiSystemInstruction } from './google-message-formatter';
import { readGeminiStreamChunks } from './google-stream-parser';
import {
	raiseApiError,
	requestUrlWithAbort,
	IdleTimeoutController,
	isMobileStreamingCorsFallbackError,
} from '../provider-helpers';
import { debugLogger } from '../../../shared/debugLogger';
import {
	geminiContextCacheManager,
	type ResolvedExplicitCache,
} from './gemini-cache-manager';
import { resolveGeminiThinkingConfig } from '../reasoning-config';
import {
	buildGeminiResponseFormatConfig,
	isStructuredOutputRetryableError,
	structuredOutputFallbackCache,
} from '../structured-output';

type GeminiCandidate = NonNullable<GeminiResponse['candidates']>[number];

/** Explicit 캐시 참조가 만료되었거나 거부(HTTP 400/404)된 오류인지 판별합니다. */
function isExplicitCacheRetryableError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const status = (err as { status?: number }).status;
	if (status === 400 || status === 404) return true;
	const msg = err instanceof Error ? err.message : String(err);
	return /HTTP (?:400|404)\b|status (?:400|404)\b|cachedContent|CachedContent/i.test(msg);
}

export class GoogleProvider implements ILLMProvider {
	readonly providerId: string;
	private apiKey: string;

	constructor(providerId: string, apiKey: string) {
		this.providerId = providerId;
		this.apiKey = apiKey.trim();
	}

	async listModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: 'https://generativelanguage.googleapis.com/v1beta/models',
				method: 'GET',
				headers: {
					'x-goog-api-key': this.apiKey,
				},
			});
			const data = res.json as {
				models?: { name: string; supportedGenerationMethods?: string[] }[]
			};
			const list = Array.isArray(data?.models) ? data.models : [];
			const apiModels = list
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
			const { content, toolCalls, usage, finishReason } = await this.streamInternal(
				messages,
				options,
				onChunk,
				true,
			);

			return {
				content,
				usage,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				finishReason,
			};
		}

		const explicitCache = await this.tryResolveExplicitCache(options, messages, true);
		const timeoutCtrl = new IdleTimeoutController(options.signal, options.ttftTimeoutMs, options.interTokenTimeoutMs);

		return timeoutCtrl.run(async () => {
			let res;
			let activeExplicitCache = explicitCache ?? undefined;
			let activeOptions = options;
			let retriedCache = false;
			let retriedStructured = false;

			while (true) {
				const req = this.buildRequest('generateContent', activeOptions, messages, true, activeExplicitCache);
				try {
					res = await requestUrlWithAbort({ url: req.url, method: 'POST', headers: req.headers, body: JSON.stringify(req.payload) }, timeoutCtrl.signal);
					break;
				} catch (err: unknown) {
					if (activeExplicitCache && !retriedCache && isExplicitCacheRetryableError(err)) {
						debugLogger.logWarn('llm', 'Gemini explicit cache rejected; retrying with standard request');
						geminiContextCacheManager.invalidate(activeExplicitCache.cacheHash);
						activeExplicitCache = undefined;
						retriedCache = true;
						continue;
					}
					if (req.hasResponseFormat && !retriedStructured && isStructuredOutputRetryableError(err)) {
						structuredOutputFallbackCache.markUnsupported(this.providerId, activeOptions.model);
						debugLogger.logWarn(
							'llm',
							`Google structured output rejected (${activeOptions.model}); retrying without responseJsonSchema`,
						);
						activeOptions = { ...activeOptions, responseFormat: undefined };
						retriedStructured = true;
						continue;
					}
					throw err;
				}
			}

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
		});
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
		if (texts.length === 0) return [];
		try {
			const modelName = options.model.startsWith('models/') ? options.model : `models/${options.model}`;
			const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:batchEmbedContents`;
			const BATCH_SIZE = 100;
			const allEmbeddings: number[][] = [];

			for (let i = 0; i < texts.length; i += BATCH_SIZE) {
				const slice = texts.slice(i, i + BATCH_SIZE);
				const requests = slice.map((text) => ({
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
						'x-goog-api-key': this.apiKey,
					},
					body: JSON.stringify({ requests }),
				});

				const data = res.json as { embeddings?: { values: number[] }[] };
				if (!data?.embeddings || !Array.isArray(data.embeddings)) {
					throw new Error(`Invalid response from Gemini embedding API: ${res.text || 'No embeddings'}`);
				}
				allEmbeddings.push(...data.embeddings.map((e) => e.values));
			}

			return allEmbeddings;
		} catch (error) {
			throw new Error(`Google Gemini Embedding Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// ─── Private ──────────────────────────────────────────────────────────

	private async tryResolveExplicitCache(
		options: ChatOptions,
		messages: ChatMessage[],
		includeTools: boolean,
	): Promise<ResolvedExplicitCache | null> {
		if (!options.promptCaching?.enabled || !options.promptCaching.geminiExplicit) {
			return null;
		}
		const formattedContents = formatGeminiMessages(messages);
		const systemInstruction = getGeminiSystemInstruction(messages);
		const formattedTools = includeTools ? formatGeminiTools(options.tools) : undefined;
		return geminiContextCacheManager.getOrCreateCache({
			providerId: this.providerId,
			apiKey: this.apiKey,
			model: options.model,
			formattedContents,
			systemInstruction,
			formattedTools,
			ttlSeconds: options.promptCaching.geminiTtlSeconds,
			sessionKey: options.promptCaching.cacheKey,
			signal: options.signal,
		});
	}

	private buildRequest(
		method: 'generateContent' | 'streamGenerateContent',
		options: ChatOptions,
		messages: ChatMessage[],
		includeTools: boolean,
		explicitCache?: ResolvedExplicitCache,
	): { url: string; headers: Record<string, string>; payload: Record<string, unknown>; hasResponseFormat: boolean } {
		const cleanModel = options.model.replace(/^models\//, '');
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:${method}`;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'x-goog-api-key': this.apiKey,
		};

		const thinkingConfig = resolveGeminiThinkingConfig(options.model, options.reasoning);
		const responseFormatConfig = !structuredOutputFallbackCache.isUnsupported(this.providerId, options.model)
			? buildGeminiResponseFormatConfig(options.model, options.responseFormat)
			: undefined;
		const generationConfig: Record<string, unknown> = {
			temperature: options.temperature ?? 0.7,
			maxOutputTokens: options.maxOutputTokens,
			...(options.stop?.length ? { stopSequences: options.stop } : {}),
			...(thinkingConfig ? { thinkingConfig } : {}),
			...(responseFormatConfig ?? {}),
		};

		if (explicitCache) {
			// Gemini REST API 제약: cachedContent 지정 시 systemInstruction 및 tools 중복 전송 시 HTTP 400 발생
			const payload: Record<string, unknown> = {
				cachedContent: explicitCache.cacheName,
				contents: explicitCache.tailContents,
				generationConfig,
			};
			return { url, headers, payload, hasResponseFormat: Boolean(responseFormatConfig) };
		}

		const formattedContents = formatGeminiMessages(messages);
		const systemInstruction = getGeminiSystemInstruction(messages);

		const payload: Record<string, unknown> = {
			contents: formattedContents,
			generationConfig,
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

		return { url, headers, payload, hasResponseFormat: Boolean(responseFormatConfig) };
	}

	private async streamInternal(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk?: (text: string) => void,
		includeTools = true,
	): Promise<{ content: string; toolCalls: ToolCall[]; usage?: TokenUsage; finishReason?: string }> {
		const explicitCache = await this.tryResolveExplicitCache(options, messages, includeTools);
		const timeoutCtrl = new IdleTimeoutController(options.signal, options.ttftTimeoutMs, options.interTokenTimeoutMs);

		return timeoutCtrl.run(async () => {
			try {
				return await this.executeStreamAttempt(
					messages,
					options,
					onChunk,
					includeTools,
					timeoutCtrl,
					explicitCache ?? undefined,
				);
			} catch (err: unknown) {
				if (explicitCache && isExplicitCacheRetryableError(err)) {
					debugLogger.logWarn('llm', 'Gemini explicit cache stream rejected; retrying with standard request');
					geminiContextCacheManager.invalidate(explicitCache.cacheHash);
					return await this.executeStreamAttempt(
						messages,
						options,
						onChunk,
						includeTools,
						timeoutCtrl,
						undefined,
					);
				}
				throw err;
			}
		});
	}

	private async executeStreamAttempt(
		messages: ChatMessage[],
		options: ChatOptions,
		onChunk: ((text: string) => void) | undefined,
		includeTools: boolean,
		timeoutCtrl: IdleTimeoutController,
		explicitCache: ResolvedExplicitCache | undefined,
	): Promise<{ content: string; toolCalls: ToolCall[]; usage?: TokenUsage; finishReason?: string }> {
		const { url, headers, payload } = this.buildRequest('streamGenerateContent', options, messages, includeTools, explicitCache);

		let fullContent = '';
		let isThinking = false;
		const accumulatedToolCalls: ToolCall[] = [];
		let usage: TokenUsage | undefined;
		let finishReason: string | undefined;

		let response: Response;
		try {
			response = await window.fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
				signal: timeoutCtrl.signal,
			});
		} catch (err: unknown) {
			if (isMobileStreamingCorsFallbackError(err)) {
				debugLogger.logWarn('llm', `Google streaming fetch blocked on mobile, falling back to requestUrl: ${err.message}`);
				timeoutCtrl.switchToNonStreamingFallback();
				const fallback = this.buildRequest('generateContent', options, messages, includeTools, explicitCache);
				const res = await requestUrlWithAbort({
					url: fallback.url,
					method: 'POST',
					headers: fallback.headers,
					body: JSON.stringify(fallback.payload),
				}, timeoutCtrl.signal);
				const data = res.json as GeminiResponse;
				const candidate = data.candidates?.[0];
				if (!candidate) {
					throw new Error(`Google Gemini API returned an empty response. Response: ${res.text}`);
				}
				const parsed = parseNonStreamingResponse(candidate);
				const fallbackUsage = data.usageMetadata ? mapUsageMetadata(data.usageMetadata) : undefined;
				if (parsed.fullContent) {
					onChunk?.(parsed.fullContent);
				}
				return {
					content: parsed.fullContent,
					toolCalls: parsed.toolCalls,
					usage: fallbackUsage,
					finishReason: candidate.finishReason || undefined,
				};
			}
			throw err;
		}

		if (!response.ok) {
			const errText = await response.text();
			const httpErr = Object.assign(
				new Error(`Google Gemini Error (HTTP ${response.status}): ${errText}`),
				{ status: response.status },
			);
			throw httpErr;
		}

		await readGeminiStreamChunks(response, timeoutCtrl.signal, (chunk) => {
			timeoutCtrl.onChunkReceived();
			const candidate = chunk.candidates?.[0];
			if (candidate) {
				if (candidate.finishReason) {
					finishReason = candidate.finishReason;
				}
				const parts = candidate.content?.parts;
				if (parts) {
					for (const part of parts) {
						if (part.text) {
							if (part.thought) {
								if (!isThinking) {
									isThinking = true;
									const openTag = '<think>\n';
									fullContent += openTag;
									onChunk?.(openTag);
								}
							} else if (isThinking) {
								isThinking = false;
								const closeTag = '\n</think>\n';
								fullContent += closeTag;
								onChunk?.(closeTag);
							}
							fullContent += part.text;
							onChunk?.(part.text);
						}
						if (part.functionCall) {
							if (isThinking) {
								isThinking = false;
								const closeTag = '\n</think>\n';
								fullContent += closeTag;
								onChunk?.(closeTag);
							}
							accumulatedToolCalls.push({
								id: crypto.randomUUID(),
								name: part.functionCall.name,
								arguments: part.functionCall.args || {},
								thoughtSignature: part.thoughtSignature,
							});
						}
					}
				}
			}
			if (chunk.usageMetadata) {
				const mapped = mapUsageMetadata(chunk.usageMetadata);
				const prevCacheRead = usage?.cacheReadTokens ?? 0;
				const nextCacheRead = Math.max(prevCacheRead, mapped.cacheReadTokens ?? 0);
				usage = {
					...mapped,
					...(nextCacheRead > 0 ? { cacheReadTokens: nextCacheRead } : {}),
				};
			}
		});

		if (isThinking) {
			isThinking = false;
			const closeTag = '\n</think>\n';
			fullContent += closeTag;
			onChunk?.(closeTag);
		}

		return { content: fullContent, toolCalls: accumulatedToolCalls, usage, finishReason };
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNonStreamingResponse(candidate: GeminiCandidate): {
	fullContent: string;
	toolCalls: ToolCall[];
} {
	let fullContent = '';
	let isThinking = false;
	const toolCalls: ToolCall[] = [];
	const parts = candidate?.content?.parts;

	if (parts) {
		for (const part of parts) {
			if (part.text) {
				if (part.thought) {
					if (!isThinking) {
						isThinking = true;
						fullContent += '<think>\n';
					}
				} else if (isThinking) {
					isThinking = false;
					fullContent += '\n</think>\n';
				}
				fullContent += part.text;
			}
			if (part.functionCall) {
				if (isThinking) {
					isThinking = false;
					fullContent += '\n</think>\n';
				}
				toolCalls.push({
					id: crypto.randomUUID(),
					name: part.functionCall.name,
					arguments: part.functionCall.args || {},
					thoughtSignature: part.thoughtSignature,
				});
			}
		}
	}

	if (isThinking) {
		fullContent += '\n</think>\n';
	}

	return { fullContent, toolCalls };
}