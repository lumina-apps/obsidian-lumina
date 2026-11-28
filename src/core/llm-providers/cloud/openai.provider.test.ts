/**
 * openai.provider.test.ts
 * OpenAI API 통합 — 모델 목록 조회, 에러 처리 검증
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
	request: vi.fn(),
	Notice: vi.fn(),
}));

import { OpenAIProvider } from './openai.provider';

describe('OpenAIProvider', () => {
	const PROVIDER_ID = 'test-openai';
	const API_KEY = 'sk-test-key-12345';
	let provider: OpenAIProvider;

	beforeEach(() => {
		mockRequestUrl.mockReset();
		provider = new OpenAIProvider(PROVIDER_ID, API_KEY);
	});

	afterEach(() => {
		mockPlatform.isMobile = false;
		vi.unstubAllGlobals();
	});

	describe('constructor', () => {
		it('should initialize with providerId and apiKey', () => {
			expect(provider.providerId).toBe(PROVIDER_ID);
				});

		it('should have correct provider ID prefix', () => {
			const p = new OpenAIProvider('custom-id', 'key');
			expect(p.providerId).toBe('custom-id');
		});

		it('should enable reasoning mode for o-series models', () => {
			expect((provider as unknown as { enableReasoning: boolean }).enableReasoning).toBe(true);
		});
	});

	describe('listModels', () => {
		it('should return GPT model IDs from API response', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					data: [
						{ id: 'gpt-4o', created: 1700000000 },
						{ id: 'gpt-4', created: 1690000000 },
						{ id: 'chatgpt-4o-latest', created: 1680000000 },
						{ id: 'dall-e-3', created: 1670000000 }, // Should be filtered out
					],
				},
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models).toContain('gpt-4o');
			expect(models).toContain('gpt-4');
			expect(models).toContain('chatgpt-4o-latest');
			expect(models).not.toContain('dall-e-3');
				});

		it('should filter embedding models by "embedding" substring', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					data: [
						{ id: 'text-embedding-3-large', created: 1700000000 },
						{ id: 'text-embedding-3-small', created: 1690000000 },
						{ id: 'gpt-4o-mini', created: 1680000000 },
					],
				},
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models).toContain('text-embedding-3-large');
			expect(models).toContain('text-embedding-3-small');
				});

		it('should sort models by created date descending', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					data: [
						{ id: 'gpt-3.5-turbo', created: 1680000000 },
						{ id: 'gpt-4o', created: 1700000000 },
						{ id: 'gpt-4', created: 1690000000 },
					],
				},
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models[0]).toBe('gpt-4o');
			expect(models[1]).toBe('gpt-4');
			expect(models[2]).toBe('gpt-3.5-turbo');
				});

		it('should call OpenAI API with correct headers', async () => {
			mockRequestUrl.mockResolvedValue({ json: { data: [] } } as RequestUrlResponse);

			await provider.listModels();

			expect(mockRequestUrl).toHaveBeenCalledWith({
				url: 'https://api.openai.com/v1/models',
				method: 'GET',
				headers: { Authorization: 'Bearer sk-test-key-12345' },
				});
				});

		it('should throw error when API returns failure', async () => {
			mockRequestUrl.mockRejectedValue({ status: 401, message: 'Invalid API key' });

			await expect(provider.listModels()).rejects.toThrow('OpenAI');
				});

		it('should include o-series models (o1, o3)', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					data: [
						{ id: 'o1-preview', created: 1700000000 },
						{ id: 'o3-mini', created: 1690000000 },
					],
				},
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models).toContain('o1-preview');
			expect(models).toContain('o3-mini');
				});
		});

	describe('chat payload compatibility', () => {
		it('should use max_completion_tokens and omit temperature for gpt-5 and o-series models', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
				},
			} as RequestUrlResponse);

			await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'gpt-5', maxOutputTokens: 2048, temperature: 0.7 },
			);

			const callArg = mockRequestUrl.mock.calls[0][0] as { body: string };
			const parsedBody = JSON.parse(callArg.body) as Record<string, unknown>;
			expect(parsedBody.max_completion_tokens).toBe(2048);
			expect(parsedBody.max_tokens).toBeUndefined();
			expect(parsedBody.temperature).toBeUndefined();
			expect(parsedBody.stop).toBeUndefined();
		});

		it('should omit empty assistant messages and orphan tool messages in payload', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }],
				},
			} as RequestUrlResponse);

			await provider.chat(
				[
					{ role: 'user', content: 'hi' },
					{ role: 'assistant', content: '   ' },
					{ role: 'tool', content: 'orphan output', tool_call_id: 'call_orphan' },
					{ role: 'user', content: 'next question' },
				],
				{ model: 'gpt-4o' },
			);

			const callArg = mockRequestUrl.mock.calls[0][0] as { body: string };
			const parsedBody = JSON.parse(callArg.body) as { messages: Array<{ role: string; content: unknown }> };
			expect(parsedBody.messages).toEqual([
				{ role: 'user', content: 'hi' },
				{ role: 'user', content: 'next question' },
			]);
		});

		it('모바일에서 스트리밍 fetch가 CORS TypeError로 실패하면 requestUrl 비스트리밍으로 폴백한다', async () => {
			mockPlatform.isMobile = true;
			vi.stubGlobal('window', {
				get setTimeout() { return globalThis.setTimeout; },
				get clearTimeout() { return globalThis.clearTimeout; },
				fetch: vi.fn().mockRejectedValue(new TypeError('Load failed')),
			});
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					choices: [{ message: { content: 'Fallback OpenAI response' }, finish_reason: 'stop' }],
				},
			} as RequestUrlResponse);

			const chunks: string[] = [];
			const res = await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'gpt-4o' },
				(c) => chunks.push(c),
			);

			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
			const callArg = mockRequestUrl.mock.calls[0][0] as { body: string };
			const parsedBody = JSON.parse(callArg.body) as Record<string, unknown>;
			expect(parsedBody.stream).toBe(false);
			expect(parsedBody.stream_options).toBeUndefined();
			expect(chunks).toEqual(['Fallback OpenAI response']);
			expect(res.content).toBe('Fallback OpenAI response');
		});

		it('모바일에서도 AbortError 발생 시 requestUrl로 폴백하지 않고 그대로 중단한다', async () => {
			mockPlatform.isMobile = true;
			const abortErr = new Error('Aborted');
			abortErr.name = 'AbortError';
			vi.stubGlobal('window', {
				get setTimeout() { return globalThis.setTimeout; },
				get clearTimeout() { return globalThis.clearTimeout; },
				fetch: vi.fn().mockRejectedValue(abortErr),
			});

			await expect(
				provider.chat(
					[{ role: 'user', content: 'hello' }],
					{ model: 'gpt-4o' },
					() => {},
				),
			).rejects.toThrow('Aborted');
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('모바일에서도 HTTP 오류 응답(400 등) 시 requestUrl로 폴백하지 않는다', async () => {
			mockPlatform.isMobile = true;
			vi.stubGlobal('window', {
				get setTimeout() { return globalThis.setTimeout; },
				get clearTimeout() { return globalThis.clearTimeout; },
				fetch: vi.fn().mockResolvedValue({
					ok: false,
					status: 400,
					text: vi.fn().mockResolvedValue('Bad Request'),
				}),
			});

			await expect(
				provider.chat(
					[{ role: 'user', content: 'hello' }],
					{ model: 'gpt-4o' },
					() => {},
				),
			).rejects.toThrow('HTTP 400');
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('모바일 CORS 폴백 후 비스트리밍 응답이 ttftTimeoutMs를 넘기더라도 연장된 타임아웃 내에서는 성공한다', async () => {
			vi.useFakeTimers();
			try {
				mockPlatform.isMobile = true;
				vi.stubGlobal('window', {
					get setTimeout() { return globalThis.setTimeout; },
					get clearTimeout() { return globalThis.clearTimeout; },
					fetch: vi.fn().mockRejectedValue(new TypeError('Load failed')),
				});
				mockRequestUrl.mockImplementation(
					() => new Promise((resolve) => {
						setTimeout(() => {
							resolve({
								text: '{}',
								json: {
									choices: [{ message: { content: 'Delayed OpenAI response' }, finish_reason: 'stop' }],
								},
							} as RequestUrlResponse);
						}, 15_000);
					}),
				);

				const promise = provider.chat(
					[{ role: 'user', content: 'hello' }],
					{ model: 'gpt-4o', ttftTimeoutMs: 5000 },
					() => {},
				);
				await vi.advanceTimersByTimeAsync(15_000);
				const res = await promise;
				expect(res.content).toBe('Delayed OpenAI response');
			} finally {
				vi.useRealTimers();
			}
		});

		it('promptCaching.cacheKey가 전달되면 prompt_cache_key를 포함하고, 없으면 생략한다', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					choices: [{ message: { content: 'Cached' }, finish_reason: 'stop' }],
					usage: {
						prompt_tokens: 2000,
						completion_tokens: 20,
						total_tokens: 2020,
						prompt_tokens_details: { cached_tokens: 1500 },
					},
				},
			} as RequestUrlResponse);

			const res = await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'gpt-4o', promptCaching: { enabled: true, cacheKey: 'sess-openai-1' } },
			);

			const cachedBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(cachedBody.prompt_cache_key).toBe('sess-openai-1');
			expect(res.usage?.cacheReadTokens).toBe(1500);

			mockRequestUrl.mockClear();

			await provider.chat([{ role: 'user', content: 'hello' }], { model: 'gpt-4o' });
			const plainBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(plainBody.prompt_cache_key).toBeUndefined();
		});
	});
});
