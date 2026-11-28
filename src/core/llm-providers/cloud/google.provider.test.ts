/**
 * google.provider.test.ts
 * Google Gemini API 통합 — 모델 목록 조회, 에러 처리 검증
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

// ── Obsidian 의존성 모킹 ──
const { mockRequestUrl, mockPlatform } = vi.hoisted(() => ({
	mockRequestUrl: vi.fn(),
	mockPlatform: { isMobile: false },
}));
vi.mock('obsidian', () => ({
	Platform: mockPlatform,
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

import { GoogleProvider } from './google.provider';
import { mapUsageMetadata } from './google.types';
import { geminiContextCacheManager } from './gemini-cache-manager';

describe('GoogleProvider', () => {
	const PROVIDER_ID = 'test-google';
	const API_KEY = 'AIza-test-key-12345';
	let provider: GoogleProvider;

	beforeEach(() => {
		mockRequestUrl.mockReset();
		provider = new GoogleProvider(PROVIDER_ID, API_KEY);
			// Mock window.fetch (Google stream 내부에서 사용)
		vi.stubGlobal('window', {
			get setTimeout() { return globalThis.setTimeout; },
			get clearTimeout() { return globalThis.clearTimeout; },
			fetch: vi.fn().mockResolvedValue({
				ok: true,
				text: vi.fn().mockResolvedValue(''),
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
			}),
		});
	});

	afterEach(() => {
		mockPlatform.isMobile = false;
		vi.unstubAllGlobals();
	});

	describe('constructor', () => {
		it('should initialize with providerId and apiKey', () => {
			expect(provider.providerId).toBe(PROVIDER_ID);
		});

		it('should have correct provider ID', () => {
			const p = new GoogleProvider('custom-id', 'key');
			expect(p.providerId).toBe('custom-id');
		});
	});

	describe('listModels', () => {
		it('should return Gemini models with generateContent method', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					models: [
						{ name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/gemini-exp', supportedGenerationMethods: ['embedContent'] }, // No generateContent
					],
				},
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models).toContain('gemini-2.0-flash');
			expect(models).toContain('gemini-1.5-pro');
			expect(models).not.toContain('gemini-exp'); // Lacks generateContent method
		});

		it('should filter embedding models by "embedding" substring', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					models: [
						{ name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
						{ name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent'] },
					],
				},
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models).toContain('text-embedding-004');
		});

		it('should call Google API with x-goog-api-key header and without key in URL', async () => {
			mockRequestUrl.mockResolvedValue({
				json: { models: [] },
			} as RequestUrlResponse);

			await provider.listModels();

			expect(mockRequestUrl).toHaveBeenCalledWith({
				url: 'https://generativelanguage.googleapis.com/v1beta/models',
				method: 'GET',
				headers: {
					'x-goog-api-key': API_KEY,
				},
			});
		});

		it('should strip "models/" prefix from returned model IDs', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					models: [
						{ name: 'models/gemini-1.0-pro-vision', supportedGenerationMethods: ['generateContent'] },
					],
				},
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models[0].startsWith('models/')).toBe(false); // Should not have "models/" prefix
		});

		it('should return fallback models when API returns empty data', async () => {
			mockRequestUrl.mockResolvedValue({
				json: { models: [] },
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models.length).toBeGreaterThan(0); // Fallback from GOOGLE_MODELS
		});

		it('should throw error when API call fails', async () => {
			mockRequestUrl.mockRejectedValue({ status: 400, message: 'Bad request' });

			await expect(provider.listModels()).rejects.toThrow('Google');
		});

		it('should throw error on network error', async () => {
			mockRequestUrl.mockRejectedValue(new Error('Network error'));

			await expect(provider.listModels()).rejects.toThrow('Google');
		});
	});

	describe('streaming', () => {
		it('should handle TTFT timeout properly within timeoutCtrl.run', async () => {
			vi.useFakeTimers();
			const fetchMock = vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
				return new Promise((_resolve, reject) => {
					init.signal.addEventListener('abort', () => {
						const err = new Error('Aborted');
						err.name = 'AbortError';
						reject(err);
					});
				});
			});
			window.fetch = fetchMock;

			const promise = provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'gemini-2.0-flash', ttftTimeoutMs: 5000 },
				() => {},
			);

			const rejection = expect(promise).rejects.toThrow();
			await vi.advanceTimersByTimeAsync(5100);
			await rejection;
			vi.useRealTimers();
		});

		it('should not duplicate tool calls when candidate has multiple parts', async () => {
			const chunkPayload = JSON.stringify({
				candidates: [
					{
						content: {
							parts: [
								{ text: 'Let me search for that.' },
								{
									functionCall: {
										name: 'searchVault',
										args: { query: 'test' },
									},
								},
							],
						},
						finishReason: 'STOP',
					},
				],
			});

			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(chunkPayload));
					controller.close();
				},
			});

			window.fetch = vi.fn().mockResolvedValue({
				ok: true,
				body: stream,
			});

			const chunksReceived: string[] = [];
			const result = await provider.chat(
				[{ role: 'user', content: 'find test' }],
				{ model: 'gemini-2.0-flash' },
				(chunk) => {
					chunksReceived.push(chunk);
				},
			);

			expect(chunksReceived).toContain('Let me search for that.');
			expect(result.toolCalls).toBeDefined();
			expect(result.toolCalls).toHaveLength(1);
			expect(result.toolCalls![0].name).toBe('searchVault');
			expect(result.toolCalls![0].arguments).toEqual({ query: 'test' });
			expect(window.fetch).toHaveBeenCalledWith(
				'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent',
				expect.objectContaining({
					headers: expect.objectContaining({
						'x-goog-api-key': API_KEY,
					}),
				}),
			);
		});

		it('모바일에서 스트리밍 fetch가 CORS TypeError로 실패하면 requestUrl 비스트리밍으로 폴백한다', async () => {
			mockPlatform.isMobile = true;
			window.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'));
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					candidates: [{
						content: { parts: [{ text: 'Fallback Gemini response' }] },
						finishReason: 'STOP',
					}],
				},
			} as RequestUrlResponse);

			const chunks: string[] = [];
			const res = await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'gemini-2.0-flash' },
				(c) => chunks.push(c),
			);

			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
			expect(chunks).toEqual(['Fallback Gemini response']);
			expect(res.content).toBe('Fallback Gemini response');
		});

		it('모바일 CORS 폴백 후 비스트리밍 응답이 ttftTimeoutMs를 넘기더라도 연장된 타임아웃 내에서는 성공한다', async () => {
			vi.useFakeTimers();
			try {
				mockPlatform.isMobile = true;
				window.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'));
				mockRequestUrl.mockImplementation(
					() => new Promise((resolve) => {
						setTimeout(() => {
							resolve({
								text: '{}',
								json: {
									candidates: [{
										content: { parts: [{ text: 'Delayed Gemini response' }] },
										finishReason: 'STOP',
									}],
								},
							} as RequestUrlResponse);
						}, 15_000);
					}),
				);

				const promise = provider.chat(
					[{ role: 'user', content: 'hello' }],
					{ model: 'gemini-2.0-flash', ttftTimeoutMs: 5000 },
					() => {},
				);
				await vi.advanceTimersByTimeAsync(15_000);
				const res = await promise;
				expect(res.content).toBe('Delayed Gemini response');
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('embed', () => {
		it('should return empty array when texts is empty', async () => {
			const res = await provider.embed([], { model: 'text-embedding-004' });
			expect(res).toEqual([]);
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('should chunk requests when texts exceed 100 items and pass x-goog-api-key header', async () => {
			const texts = Array.from({ length: 150 }, (_, i) => `chunk ${i}`);
			mockRequestUrl.mockImplementation(async (params: { url: string; headers?: Record<string, string>; body: string }) => {
				expect(params.url).not.toContain('key=');
				expect(params.headers?.['x-goog-api-key']).toBe(API_KEY);
				const body = JSON.parse(params.body) as { requests: { content: { parts: { text: string }[] } }[] };
				expect(body.requests.length).toBeLessThanOrEqual(100);
				return {
					json: {
						embeddings: body.requests.map((_, idx) => ({ values: [idx * 0.1, idx * 0.2] })),
					},
				} as RequestUrlResponse;
			});

			const results = await provider.embed(texts, { model: 'text-embedding-004' });
			expect(results).toHaveLength(150);
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});
	});

	describe('mapUsageMetadata', () => {
		it('should include thoughtsTokenCount in outputTokens and toolUsePromptTokenCount in inputTokens', () => {
			const mapped = mapUsageMetadata({
				promptTokenCount: 260,
				toolUsePromptTokenCount: 40,
				candidatesTokenCount: 50,
				thoughtsTokenCount: 150,
				cachedContentTokenCount: 100,
				totalTokenCount: 500,
			});

			expect(mapped).toEqual({
				inputTokens: 300,
				outputTokens: 200,
				totalTokens: 500,
				cacheReadTokens: 100,
			});
		});

		it('should compute totalTokens fallback when totalTokenCount is omitted', () => {
			const mapped = mapUsageMetadata({
				promptTokenCount: 100,
				candidatesTokenCount: 20,
				thoughtsTokenCount: 30,
			});

			expect(mapped).toEqual({
				inputTokens: 100,
				outputTokens: 50,
				totalTokens: 150,
			});
		});
	});

	describe('explicit context caching', () => {
		afterEach(async () => {
			await geminiContextCacheManager.destroyAll();
		});

		it('geminiExplicit 활성화 시 cachedContent를 전송하고 systemInstruction/tools를 제외한다', async () => {
			const largeSys = 'System instruction '.repeat(1500);
			mockRequestUrl
				.mockResolvedValueOnce({
					json: {
						name: 'cachedContents/explicit-1',
						expireTime: new Date(Date.now() + 300_000).toISOString(),
					},
				} as RequestUrlResponse)
				.mockResolvedValueOnce({
					text: '{}',
					json: {
						candidates: [{ content: { parts: [{ text: 'Cached reply' }] }, finishReason: 'STOP' }],
						usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 900, candidatesTokenCount: 10 },
					},
				} as RequestUrlResponse);

			const res = await provider.chat(
				[
					{ role: 'system', content: largeSys },
					{ role: 'user', content: 'Question' },
				],
				{
					model: 'gemini-2.5-pro',
					tools: [{ name: 'read_note', description: 'Read', inputSchema: { type: 'object', properties: {} } }],
					promptCaching: { enabled: true, geminiExplicit: true, cacheKey: 'sess-g1', geminiTtlSeconds: 300 },
				},
			);

			expect(res.content).toBe('Cached reply');
			expect(res.usage?.cacheReadTokens).toBe(900);
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
			const genBody = JSON.parse((mockRequestUrl.mock.calls[1][0] as { body: string }).body) as Record<string, unknown>;
			expect(genBody.cachedContent).toBe('cachedContents/explicit-1');
			expect(genBody.systemInstruction).toBeUndefined();
			expect(genBody.tools).toBeUndefined();
		});

		it('Explicit 캐시 참조가 HTTP 404로 거부되면 일반 요청으로 자동 폴백한다', async () => {
			const largeSys = 'System instruction '.repeat(1500);
			mockRequestUrl
				.mockResolvedValueOnce({
					json: {
						name: 'cachedContents/expired-1',
						expireTime: new Date(Date.now() + 300_000).toISOString(),
					},
				} as RequestUrlResponse)
				.mockRejectedValueOnce({ status: 404, message: 'CachedContent not found' })
				.mockResolvedValueOnce({
					text: '{}',
					json: {
						candidates: [{ content: { parts: [{ text: 'Fallback ok' }] }, finishReason: 'STOP' }],
					},
				} as RequestUrlResponse);

			const res = await provider.chat(
				[
					{ role: 'system', content: largeSys },
					{ role: 'user', content: 'Question' },
				],
				{
					model: 'gemini-2.5-pro',
					promptCaching: { enabled: true, geminiExplicit: true, cacheKey: 'sess-g2' },
				},
			);

			expect(res.content).toBe('Fallback ok');
			expect(mockRequestUrl).toHaveBeenCalledTimes(3);
			const fallbackBody = JSON.parse((mockRequestUrl.mock.calls[2][0] as { body: string }).body) as Record<string, unknown>;
			expect(fallbackBody.cachedContent).toBeUndefined();
			expect(fallbackBody.systemInstruction).toBeDefined();
		});
	});

	describe('thinkingConfig & thought part parsing', () => {
		it('Gemini 2.5에는 thinkingBudget, Gemini 3+에는 thinkingLevel만 주입하고 2.0에는 생략한다', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
				},
			} as RequestUrlResponse);

			await provider.chat(
				[{ role: 'user', content: 'hi' }],
				{ model: 'gemini-2.5-pro', reasoning: { effort: 'off' } },
			);
			const body25Pro = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as {
				generationConfig: { thinkingConfig?: Record<string, unknown> };
			};
			expect(body25Pro.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 128 });

			mockRequestUrl.mockClear();
			await provider.chat(
				[{ role: 'user', content: 'hi' }],
				{ model: 'gemini-3-flash-preview', reasoning: { effort: 'medium', budgetTokens: 4096 } },
			);
			const body3Flash = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as {
				generationConfig: { thinkingConfig?: Record<string, unknown> };
			};
			expect(body3Flash.generationConfig.thinkingConfig).toEqual({
				thinkingLevel: 'medium',
				includeThoughts: true,
			});

			mockRequestUrl.mockClear();
			await provider.chat(
				[{ role: 'user', content: 'hi' }],
				{ model: 'gemini-2.0-flash', reasoning: { effort: 'high' } },
			);
			const body20 = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as {
				generationConfig: { thinkingConfig?: Record<string, unknown> };
			};
			expect(body20.generationConfig.thinkingConfig).toBeUndefined();
		});

		it('스트리밍 및 논스트리밍 응답의 part.thought=true를 <think> 블록으로 래핑한다', async () => {
			const streamPayload = [
				JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Thinking 1', thought: true }] } }] }),
				JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Thinking 2', thought: true }, { text: 'Answer' }] }, finishReason: 'STOP' }] }),
			].join('\n');

			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(streamPayload));
					controller.close();
				},
			});
			window.fetch = vi.fn().mockResolvedValue({ ok: true, body: stream });

			const chunks: string[] = [];
			const streamRes = await provider.chat(
				[{ role: 'user', content: 'hi' }],
				{ model: 'gemini-2.5-flash', reasoning: { effort: 'low' } },
				(c) => chunks.push(c),
			);
			expect(streamRes.content).toBe('<think>\nThinking 1Thinking 2\n</think>\nAnswer');
			expect(chunks.join('')).toBe('<think>\nThinking 1Thinking 2\n</think>\nAnswer');

			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					candidates: [{
						content: {
							parts: [
								{ text: 'Non-stream thought', thought: true },
								{ text: 'Final text' },
							],
						},
						finishReason: 'STOP',
					}],
				},
			} as RequestUrlResponse);

			const nonStreamRes = await provider.chat(
				[{ role: 'user', content: 'hi' }],
				{ model: 'gemini-2.5-flash', reasoning: { effort: 'low' } },
			);
			expect(nonStreamRes.content).toBe('<think>\nNon-stream thought\n</think>\nFinal text');
		});
	});
});
