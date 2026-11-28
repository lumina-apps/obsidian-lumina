/**
 * openaiCompat.provider.test.ts
 * OpenAI 호환 로컬 API (Ollama 등) — 모델 목록 조회, Rerank 검증
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

import { OpenAICompatProvider } from './openaiCompat.provider';
import { structuredOutputFallbackCache } from '../structured-output';

describe('OpenAICompatProvider', () => {
	const PROVIDER_ID = 'test-ollama';
	let provider: OpenAICompatProvider;

	beforeEach(() => {
		structuredOutputFallbackCache.clear();
		mockRequestUrl.mockReset();
		provider = new OpenAICompatProvider(PROVIDER_ID, 'ollama', 'http://localhost:11434');
				// Mock window.fetch (stream에서 사용)
		vi.stubGlobal('window', {
			fetch: vi.fn().mockResolvedValue({
				ok: true,
				text: vi.fn().mockResolvedValue(''),
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
			}),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('constructor', () => {
		it('should initialize with providerId, type and baseUrl', () => {
			expect(provider.providerId).toBe(PROVIDER_ID);
			expect((provider as any).type).toBe('ollama');
			expect((provider as any).baseUrl).toBe('http://localhost:11434');
		});

		it('should remove trailing slash from baseUrl', () => {
			const p = new OpenAICompatProvider('test', 'ollama', 'http://localhost:11434/');
			expect((p as any).baseUrl).toBe('http://localhost:11434');
		});

		it('should normalize baseUrl by removing redundant /v1 and /v1/', () => {
			const p1 = new OpenAICompatProvider('test', 'custom', 'http://localhost:1234/v1');
			expect((p1 as any).baseUrl).toBe('http://localhost:1234');

			const p2 = new OpenAICompatProvider('test', 'custom', 'http://localhost:1234/v1/');
			expect((p2 as any).baseUrl).toBe('http://localhost:1234');

			const p3 = new OpenAICompatProvider('test', 'ollama', '  http://localhost:11434/v1/  ');
			expect((p3 as any).baseUrl).toBe('http://localhost:11434');
		});

		it('should set enableReasoning to true', () => {
			const p = new OpenAICompatProvider('test', 'ollama', 'http://localhost:11434');
			expect((p as any).enableReasoning).toBe(true);
		});
	});

	describe('listModels (Ollama)', () => {
		it('should call Ollama API with correct URL and return model names', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					models: [
						{ name: 'llama3.1' },
						{ name: 'mistral' },
						{ name: 'gemma2' },
					],
				},
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models).toContain('llama3.1');
			expect(models).toContain('mistral');
			expect(models).toContain('gemma2');
			expect(mockRequestUrl).toHaveBeenCalledWith({
				url: 'http://localhost:11434/api/tags',
				method: 'GET',
			});
		});

		it('should throw error when no models are found', async () => {
			mockRequestUrl.mockResolvedValue({
				json: { models: [] },
			} as RequestUrlResponse);

			await expect(provider.listModels()).rejects.toThrow('ollama');
		});

		it('should throw error on API failure', async () => {
			mockRequestUrl.mockRejectedValue({ status: 500, message: 'Server Error' });

			await expect(provider.listModels()).rejects.toThrow('Ollama');
		});
	});

	describe('listModels (OpenAI Compat)', () => {
		let compatProvider: OpenAICompatProvider;

		beforeEach(() => {
			compatProvider = new OpenAICompatProvider(
				'openai-compat-test',
				'custom',
				'http://my-api.example.com',
				'Bearer-token-xyz'
			);
		});

		it('should call OpenAI-compatible API with correct URL and Bearer header', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					data: [
						{ id: 'gpt-4-turbo' },
						{ id: 'llama3-70b' },
					],
				},
			} as RequestUrlResponse);

			const models = await compatProvider.listModels();

			expect(models).toContain('gpt-4-turbo');
			expect(models).toContain('llama3-70b');

			expect(mockRequestUrl).toHaveBeenCalledWith({
				url: 'http://my-api.example.com/v1/models',
				method: 'GET',
				headers: { Authorization: 'Bearer Bearer-token-xyz' },
			});
		});

		it('should support various response shapes like { models: [] } or raw array', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: {
					models: [{ id: 'qwen2.5' }],
				},
			} as RequestUrlResponse);

			const models1 = await compatProvider.listModels();
			expect(models1).toEqual(['qwen2.5']);

			mockRequestUrl.mockResolvedValueOnce({
				json: [{ id: 'deepseek-r1' }],
			} as RequestUrlResponse);

			const models2 = await compatProvider.listModels();
			expect(models2).toEqual(['deepseek-r1']);
		});

		it('should throw error on OpenAI Compat API failure', async () => {
			mockRequestUrl.mockRejectedValue({ status: 401, message: 'Unauthorized' });

			await expect(compatProvider.listModels()).rejects.toThrow('custom');
		});
	});

	describe('rerank', () => {
		let compatProvider: OpenAICompatProvider;

		beforeEach(() => {
			compatProvider = new OpenAICompatProvider(
				'openai-compat-test',
				'custom',
				'http://my-api.example.com/rerank'
			);
		});

		it('should call rerank API with correct parameters', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					results: [
						{ index: 0, relevance_score: 0.95 },
						{ index: 1, relevance_score: 0.80 },
					],
				},
			} as RequestUrlResponse);

			const result = await compatProvider.rerank(
				'test query',
				['document one', 'document two'],
				{ model: 'reranker-v1' }
			);

			expect(result).toHaveLength(2);
			expect(result[0].score).toBeGreaterThan(result[1].score);
		});

		it('should throw error when rerank API fails', async () => {
			mockRequestUrl.mockRejectedValue({ status: 503, message: 'Service Unavailable' });

			await expect(
				compatProvider.rerank('query', ['doc'], { model: 'reranker-v1' })
			).rejects.toThrow(/custom/);
		});
	});

	describe('stop sequences and reasoning compatibility', () => {
		it('should include local stop sequences for local custom endpoints but omit them for remote HTTPS custom endpoints', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
				},
			} as RequestUrlResponse);

			const localCustom = new OpenAICompatProvider('local-c', 'custom', 'http://localhost:8000');
			await localCustom.chat([{ role: 'user', content: 'hi' }], { model: 'qwen2.5' });
			const localBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(Array.isArray(localBody.stop)).toBe(true);

			mockRequestUrl.mockClear();

			const remoteCustom = new OpenAICompatProvider('remote-c', 'custom', 'https://api.together.xyz');
			await remoteCustom.chat([{ role: 'user', content: 'hi' }], { model: 'meta-llama/Llama-3-70b' });
			const remoteBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(remoteBody.stop).toBeUndefined();
		});

		it('should detect provider-prefixed reasoning models (e.g. openai/gpt-5) and omit stop/temperature', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
				},
			} as RequestUrlResponse);

			const localCustom = new OpenAICompatProvider('local-c', 'custom', 'http://localhost:8000');
			await localCustom.chat([{ role: 'user', content: 'hi' }], { model: 'openai/gpt-5', temperature: 0.7, maxOutputTokens: 4096 });
			const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(body.max_completion_tokens).toBe(4096);
			expect(body.max_tokens).toBeUndefined();
			expect(body.temperature).toBeUndefined();
			expect(body.stop).toBeUndefined();
		});

		it('모바일에서 custom 원격 엔드포인트의 스트리밍 fetch가 CORS TypeError로 실패하면 requestUrl 비스트리밍으로 폴백한다', async () => {
			mockPlatform.isMobile = true;
			try {
				vi.stubGlobal('window', {
					get setTimeout() { return globalThis.setTimeout; },
					get clearTimeout() { return globalThis.clearTimeout; },
					fetch: vi.fn().mockRejectedValue(new TypeError('Load failed')),
				});
				mockRequestUrl.mockResolvedValue({
					text: '{}',
					json: {
						choices: [{ message: { content: 'Fallback custom remote response' }, finish_reason: 'stop' }],
					},
				} as RequestUrlResponse);

				const remoteCustom = new OpenAICompatProvider('remote-c', 'custom', 'https://api.together.xyz', 'sk-remote');
				const chunks: string[] = [];
				const res = await remoteCustom.chat(
					[{ role: 'user', content: 'hello' }],
					{ model: 'meta-llama/Llama-3-70b' },
					(c) => chunks.push(c),
				);

				expect(mockRequestUrl).toHaveBeenCalledTimes(1);
				expect(chunks).toEqual(['Fallback custom remote response']);
				expect(res.content).toBe('Fallback custom remote response');
			} finally {
				mockPlatform.isMobile = false;
			}
		});

		it('데스크탑에서 LM Studio 스트리밍(stream/chat)이 CORS TypeError로 실패하면 requestUrl 비스트리밍으로 폴백한다', async () => {
			mockPlatform.isMobile = false;
			vi.stubGlobal('window', {
				get setTimeout() { return globalThis.setTimeout; },
				get clearTimeout() { return globalThis.clearTimeout; },
				fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
			});
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					choices: [{ message: { content: 'LM Studio fallback response' }, finish_reason: 'stop' }],
					usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				},
			} as RequestUrlResponse);

			const lmStudio = new OpenAICompatProvider('lms-1', 'lmstudio', 'http://localhost:1234/');
			const streamChunks: string[] = [];
			const streamRes = await lmStudio.stream(
				[{ role: 'user', content: 'hello' }],
				{ model: 'qwen3.8-27b@iq2_s' },
				(c) => streamChunks.push(c),
			);

			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
			const callArg = mockRequestUrl.mock.calls[0][0] as { url: string; body: string };
			expect(callArg.url).toBe('http://localhost:1234/v1/chat/completions');
			const parsedBody = JSON.parse(callArg.body) as Record<string, unknown>;
			expect(parsedBody.stream).toBe(false);
			expect(parsedBody.stream_options).toBeUndefined();
			expect(streamChunks).toEqual(['LM Studio fallback response']);
			expect(streamRes.finishReason).toBe('stop');
		});

		it('데스크탑에서 원격 custom 엔드포인트는 fetch TypeError 시 requestUrl 폴백을 수행하지 않는다', async () => {
			mockPlatform.isMobile = false;
			vi.stubGlobal('window', {
				get setTimeout() { return globalThis.setTimeout; },
				get clearTimeout() { return globalThis.clearTimeout; },
				fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
			});

			const remoteCustom = new OpenAICompatProvider('remote-c', 'custom', 'https://api.together.xyz', 'sk-remote');
			await expect(
				remoteCustom.chat(
					[{ role: 'user', content: 'hello' }],
					{ model: 'meta-llama/Llama-3-70b' },
					() => {},
				),
			).rejects.toThrow('Failed to fetch');
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('데스크탑 로컬 서버라도 요청이 이미 중단(Abort)된 경우 requestUrl로 폴백하지 않는다', async () => {
			mockPlatform.isMobile = false;
			const controller = new AbortController();
			vi.stubGlobal('window', {
				get setTimeout() { return globalThis.setTimeout; },
				get clearTimeout() { return globalThis.clearTimeout; },
				fetch: vi.fn().mockImplementation(() => {
					controller.abort();
					return Promise.reject(new TypeError('Failed to fetch'));
				}),
			});

			const lmStudio = new OpenAICompatProvider('lms-1', 'lmstudio', 'http://localhost:1234');
			await expect(
				lmStudio.stream(
					[{ role: 'user', content: 'hello' }],
					{ model: 'qwen2.5', signal: controller.signal },
					() => {},
				),
			).rejects.toThrow('Failed to fetch');
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('OpenRouter Claude 모델에 promptCaching 활성 시 cache_control을 포함하고, 그 외 모델/프로바이더에는 생략한다', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
				},
			} as RequestUrlResponse);

			const openrouter = new OpenAICompatProvider('or-1', 'openrouter', 'https://openrouter.ai/api', 'sk-or');
			await openrouter.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'anthropic/claude-sonnet-4-5', promptCaching: { enabled: true } },
			);
			const claudeBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(claudeBody.cache_control).toEqual({ type: 'ephemeral' });

			mockRequestUrl.mockClear();

			await openrouter.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'openai/gpt-4o', promptCaching: { enabled: true } },
			);
			const gptBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(gptBody.cache_control).toBeUndefined();

			mockRequestUrl.mockClear();

			await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'claude-like-local', promptCaching: { enabled: true } },
			);
			const ollamaBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(ollamaBody.cache_control).toBeUndefined();
		});

		it('ollama·lmstudio·xai는 response_format을 주입하고 400 시 폴백하며, deepseek·groq·openrouter·custom은 생략한다', async () => {
			const responseFormat = {
				type: 'json_schema' as const,
				jsonSchema: {
					name: 'route_schema',
					schema: {
						type: 'object',
						properties: { folder: { type: 'string' } },
						required: ['folder'],
						additionalProperties: false,
					},
					strict: true,
				},
			};

			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: { choices: [{ message: { content: '{"folder":"Notes"}' }, finish_reason: 'stop' }] },
			} as RequestUrlResponse);

			// 1단계 지원 3종: ollama, lmstudio, xai
			const supportedTargets = [
				new OpenAICompatProvider('ol-1', 'ollama', 'http://localhost:11434'),
				new OpenAICompatProvider('lms-1', 'lmstudio', 'http://localhost:1234'),
				new OpenAICompatProvider('xai-1', 'xai', 'https://api.x.ai', 'sk-xai'),
			];
			for (const p of supportedTargets) {
				mockRequestUrl.mockClear();
				await p.chat([{ role: 'user', content: 'hi' }], { model: 'test-model', responseFormat });
				const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
				expect(body.response_format).toBeDefined();
			}

			// 1단계 제외 4종: deepseek, groq, openrouter, custom
			const excludedTargets = [
				new OpenAICompatProvider('ds-1', 'deepseek', 'https://api.deepseek.com', 'sk-ds'),
				new OpenAICompatProvider('gq-1', 'groq', 'https://api.groq.com/openai', 'sk-gq'),
				new OpenAICompatProvider('or-1', 'openrouter', 'https://openrouter.ai/api', 'sk-or'),
				new OpenAICompatProvider('cu-1', 'custom', 'https://custom.example.com', 'sk-cu'),
			];
			for (const p of excludedTargets) {
				mockRequestUrl.mockClear();
				await p.chat([{ role: 'user', content: 'hi' }], { model: 'test-model', responseFormat });
				const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
				expect(body.response_format).toBeUndefined();
			}

			// Ollama 구버전/비호환 모델 HTTP 400 거부 시 response_format 제거 후 1회 폴백 재시도
			mockRequestUrl.mockReset();
			mockRequestUrl
				.mockRejectedValueOnce({ status: 400, message: 'invalid response_format' })
				.mockResolvedValueOnce({
					text: '{}',
					json: { choices: [{ message: { content: '{"folder":"Notes"}' }, finish_reason: 'stop' }] },
				} as RequestUrlResponse);

			const res = await provider.chat(
				[{ role: 'user', content: 'hi' }],
				{ model: 'legacy-llama', responseFormat },
			);
			expect(res.content).toBe('{"folder":"Notes"}');
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
			const retryBody = JSON.parse((mockRequestUrl.mock.calls[1][0] as { body: string }).body) as Record<string, unknown>;
			expect(retryBody.response_format).toBeUndefined();
		});
	});
});
