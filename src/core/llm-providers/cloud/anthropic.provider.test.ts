/**
 * anthropic.provider.test.ts
 * Anthropic Claude API 통합 — 모델 목록 조회, API 호출 헤더 검증
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

import { AnthropicProvider } from './anthropic.provider';

describe('AnthropicProvider', () => {
	const PROVIDER_ID = 'test-anthropic';
	const API_KEY = 'sk-ant-test-key';
	let provider: AnthropicProvider;

	beforeEach(() => {
		mockRequestUrl.mockReset();
		provider = new AnthropicProvider(PROVIDER_ID, API_KEY);
			// Mock window.fetch (Anthropic stream 내부에서 사용)
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
			const p = new AnthropicProvider('custom-provider', 'key');
			expect(p.providerId).toBe('custom-provider');
					});
				});

	describe('listModels', () => {
		it('should return claude models from API response', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					data: [
							{ id: 'claude-4-opus', type: 'model' },
							{ id: 'claude-3-5-sonnet', type: 'model' },
							{ id: 'embedding-model', type: 'other' }, // Not claude- prefixed
						],
					},
				} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models).toContain('claude-4-opus');
			expect(models).toContain('claude-3-5-sonnet');
					});

		it('should filter non-claude models', async () => {
			mockRequestUrl.mockResolvedValue({
				json: {
					data: [
							{ id: 'claude-3-haiku', type: 'model' },
							{ id: 'other-model-v1', type: 'model' },
						],
					},
				} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models).toContain('claude-3-haiku');
			expect(models).not.toContain('other-model-v1');
					});

		it('should call Anthropic API with correct headers', async () => {
			mockRequestUrl.mockResolvedValue({
				json: { data: [] },
			} as RequestUrlResponse);

			await provider.listModels();

			expect(mockRequestUrl).toHaveBeenCalledWith({
				url: 'https://api.anthropic.com/v1/models',
				method: 'GET',
				headers: {
					'x-api-key': 'sk-ant-test-key',
					'anthropic-version': '2023-06-01',
						},
					});
					});

		it('should return fallback models when API returns empty data', async () => {
			mockRequestUrl.mockResolvedValue({
				json: { data: [] },
			} as RequestUrlResponse);

			const models = await provider.listModels();

			expect(models.length).toBeGreaterThan(0); // Fallback from ANTHROPIC_MODELS
					});

		it('should throw error when API call fails', async () => {
			mockRequestUrl.mockRejectedValue({ status: 403, message: 'Forbidden' });

			await expect(provider.listModels()).rejects.toThrow('Anthropic');
					});

		it('should throw error on network error', async () => {
			mockRequestUrl.mockRejectedValue(new Error('Network disconnected'));

			await expect(provider.listModels()).rejects.toThrow('Anthropic');
					});
			});

	describe('embed', () => {
		it('should throw error indicating no embedding support', async () => {
			await expect(provider.embed(['test text'], { model: 'embedding-1' }))
				.rejects.toThrow();
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
				{ model: 'claude-3-5-sonnet', ttftTimeoutMs: 5000 },
				() => {},
			);

			const rejection = expect(promise).rejects.toThrow();
			await vi.advanceTimersByTimeAsync(5100);
			await rejection;
			vi.useRealTimers();
		});

		it('should wrap thinking_delta in <think> tags during streaming', async () => {
			const events = [
				'data: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
				'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Analyzing the request...' } }),
				'data: ' + JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
				'data: ' + JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Here is the answer.' } }),
			];

			const stream = new ReadableStream({
				start(controller) {
					for (const ev of events) {
						controller.enqueue(new TextEncoder().encode(ev + '\n'));
					}
					controller.close();
				},
			});

			window.fetch = vi.fn().mockResolvedValue({
				ok: true,
				body: stream,
			});

			const chunks: string[] = [];
			const result = await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'claude-3-7-sonnet' },
				(chunk) => {
					chunks.push(chunk);
				},
			);

			expect(result.content).toContain('<think>\nAnalyzing the request...\n</think>\nHere is the answer.');
			expect(chunks.join('')).toBe('<think>\nAnalyzing the request...\n</think>\nHere is the answer.');
		});

		it('스트리밍 fetch 요청에 모바일 WebView CORS 허용 헤더를 포함한다', async () => {
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }) + '\n'));
					controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }) + '\n'));
					controller.close();
				},
			});

			const fetchSpy = vi.fn().mockResolvedValue({
				ok: true,
				body: stream,
			});
			window.fetch = fetchSpy;

			await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'claude-3-5-sonnet' },
				() => {},
			);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
			expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
		});

		it('should omit deprecated temperature parameter for Claude 4.7+ and Claude 5+ models', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					content: [{ type: 'text', text: 'Hello' }],
					stop_reason: 'end_turn',
				},
			} as RequestUrlResponse);

			await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'claude-opus-4-7', temperature: 0.7 },
			);

			const callArg = mockRequestUrl.mock.calls[0][0] as { body: string };
			const parsedBody = JSON.parse(callArg.body) as Record<string, unknown>;
			expect(parsedBody.temperature).toBeUndefined();
		});

		it('should include cache_creation_input_tokens and cache_read_input_tokens in inputTokens', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					content: [{ type: 'text', text: 'Cached response' }],
					stop_reason: 'end_turn',
					usage: {
						input_tokens: 12,
						cache_creation_input_tokens: 100,
						cache_read_input_tokens: 2000,
						output_tokens: 45,
					},
				},
			} as RequestUrlResponse);

			const res = await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'claude-sonnet-4-5' },
			);

			expect(res.usage).toEqual({
				inputTokens: 2112,
				outputTokens: 45,
				totalTokens: 2157,
				cacheReadTokens: 2000,
				cacheCreationTokens: 100,
			});
		});

		it('should preserve cached inputTokens across message_start and message_delta in streaming', async () => {
			const events = [
				'data: ' + JSON.stringify({
					type: 'message_start',
					message: {
						usage: {
							input_tokens: 10,
							cache_creation_input_tokens: 50,
							cache_read_input_tokens: 400,
							output_tokens: 1,
						},
					},
				}),
				'data: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
				'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }),
				'data: ' + JSON.stringify({
					type: 'message_delta',
					delta: { stop_reason: 'end_turn' },
					usage: { output_tokens: 25 },
				}),
			];

			const stream = new ReadableStream({
				start(controller) {
					for (const ev of events) {
						controller.enqueue(new TextEncoder().encode(ev + '\n'));
					}
					controller.close();
				},
			});

			window.fetch = vi.fn().mockResolvedValue({
				ok: true,
				body: stream,
			});

			const res = await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'claude-sonnet-4-5' },
				() => {},
			);

			expect(res.usage).toEqual({
				inputTokens: 460,
				outputTokens: 25,
				totalTokens: 485,
				cacheReadTokens: 400,
				cacheCreationTokens: 50,
			});
		});

		it('promptCaching.enabled가 true일 때 tools, system, messages에 cache_control을 주입하고 비활성 시 생략한다', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					content: [{ type: 'text', text: 'OK' }],
					stop_reason: 'end_turn',
				},
			} as RequestUrlResponse);

			await provider.chat(
				[
					{ role: 'system', content: 'System prompt' },
					{ role: 'user', content: 'Hello' },
				],
				{
					model: 'claude-sonnet-4-5',
					tools: [{ name: 'read_note', description: 'Read', inputSchema: { type: 'object', properties: {} } }],
					promptCaching: { enabled: true },
				},
			);

			const cachedBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as {
				system: Array<{ cache_control?: unknown }>;
				tools: Array<{ cache_control?: unknown }>;
				messages: Array<{ content: Array<{ cache_control?: unknown }> }>;
			};
			expect(cachedBody.system[0].cache_control).toEqual({ type: 'ephemeral' });
			expect(cachedBody.tools[0].cache_control).toEqual({ type: 'ephemeral' });
			expect(cachedBody.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });

			mockRequestUrl.mockClear();

			await provider.chat(
				[
					{ role: 'system', content: 'System prompt' },
					{ role: 'user', content: 'Hello' },
				],
				{
					model: 'claude-sonnet-4-5',
					tools: [{ name: 'read_note', description: 'Read', inputSchema: { type: 'object', properties: {} } }],
				},
			);

			const plainBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as {
				system: unknown;
				tools: Array<{ cache_control?: unknown }>;
				messages: Array<{ content: unknown }>;
			};
			expect(plainBody.system).toBe('System prompt');
			expect(plainBody.tools[0].cache_control).toBeUndefined();
			expect(plainBody.messages[0].content).toBe('Hello');
		});

		it('모바일에서 스트리밍 fetch가 CORS TypeError로 실패하면 requestUrl 비스트리밍으로 폴백한다', async () => {
			mockPlatform.isMobile = true;
			window.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'));
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					content: [{ type: 'text', text: 'Fallback Claude response' }],
					stop_reason: 'end_turn',
				},
			} as RequestUrlResponse);

			const chunks: string[] = [];
			const res = await provider.chat(
				[{ role: 'user', content: 'hello' }],
				{ model: 'claude-sonnet-4-5' },
				(c) => chunks.push(c),
			);

			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
			expect(chunks).toEqual(['Fallback Claude response']);
			expect(res.content).toBe('Fallback Claude response');
		});

		it('데스크탑에서는 스트리밍 fetch TypeError 시 requestUrl로 폴백하지 않는다', async () => {
			mockPlatform.isMobile = false;
			window.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

			await expect(
				provider.chat(
					[{ role: 'user', content: 'hello' }],
					{ model: 'claude-sonnet-4-5' },
					() => {},
				),
			).rejects.toThrow('Failed to fetch');
			expect(mockRequestUrl).not.toHaveBeenCalled();
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
									content: [{ type: 'text', text: 'Delayed Claude response' }],
									stop_reason: 'end_turn',
								},
							} as RequestUrlResponse);
						}, 15_000);
					}),
				);

				const promise = provider.chat(
					[{ role: 'user', content: 'hello' }],
					{ model: 'claude-sonnet-4-5', ttftTimeoutMs: 5000 },
					() => {},
				);
				await vi.advanceTimersByTimeAsync(15_000);
				const res = await promise;
				expect(res.content).toBe('Delayed Claude response');
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('reasoning / thinking control', () => {
		it('Claude 4.5에서 manual thinking 활성 시 budget_tokens를 설정하고 max_tokens 상향 및 temperature 생략을 적용한다', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					content: [
						{ type: 'thinking', thinking: 'Step 1', signature: 'sig-123' },
						{ type: 'text', text: 'Final answer' },
					],
					stop_reason: 'end_turn',
				},
			} as RequestUrlResponse);

			const res = await provider.chat(
				[{ role: 'user', content: 'reason' }],
				{ model: 'claude-sonnet-4-5', maxOutputTokens: 4000, temperature: 0.7, reasoning: { effort: 'medium' } },
			);

			const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
			expect(body.max_tokens).toBe(12192);
			expect(body.temperature).toBeUndefined();
			expect(res.content).toBe('<think>\nStep 1\n</think>\nFinal answer');
			expect(res.thinkingBlocks).toEqual([{ type: 'thinking', thinking: 'Step 1', signature: 'sig-123' }]);
		});

		it('Claude 4.7+에서는 adaptive + display:summarized와 output_config.effort를 전송하고 budget_tokens를 무시한다', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					content: [{ type: 'text', text: 'OK' }],
					stop_reason: 'end_turn',
				},
			} as RequestUrlResponse);

			await provider.chat(
				[{ role: 'user', content: 'reason' }],
				{
					model: 'claude-opus-4-7',
					maxOutputTokens: 4000,
					reasoning: { effort: 'high', budgetTokens: 16000 },
				},
			);

			const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
			expect(body.output_config).toEqual({ effort: 'high' });
			expect(body.max_tokens).toBe(4000);
			expect(body.temperature).toBeUndefined();
		});

		it('effort=off 시 thinking.type=disabled를 전송하고 미지원(3.5) 모델에는 생략한다', async () => {
			mockRequestUrl.mockResolvedValue({
				text: '{}',
				json: {
					content: [{ type: 'text', text: 'OK' }],
					stop_reason: 'end_turn',
				},
			} as RequestUrlResponse);

			await provider.chat(
				[{ role: 'user', content: 'fast' }],
				{ model: 'claude-opus-4-7', reasoning: { effort: 'off' } },
			);
			const body47 = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(body47.thinking).toEqual({ type: 'disabled' });

			mockRequestUrl.mockClear();
			await provider.chat(
				[{ role: 'user', content: 'fast' }],
				{ model: 'claude-3-5-sonnet-latest', reasoning: { effort: 'high' } },
			);
			const body35 = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as Record<string, unknown>;
			expect(body35.thinking).toBeUndefined();
		});

		it('스트리밍 시 signature_delta와 redacted_thinking 블록을 수집하여 반환한다', async () => {
			const events = [
				'data: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
				'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Deep thought' } }),
				'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-part-1' } }),
				'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: '-part-2' } }),
				'data: ' + JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'enc-blob' } }),
				'data: ' + JSON.stringify({ type: 'content_block_start', index: 2, content_block: { type: 'text' } }),
				'data: ' + JSON.stringify({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Done' } }),
			];
			const stream = new ReadableStream({
				start(controller) {
					for (const ev of events) {
						controller.enqueue(new TextEncoder().encode(ev + '\n'));
					}
					controller.close();
				},
			});
			window.fetch = vi.fn().mockResolvedValue({ ok: true, body: stream });

			const res = await provider.chat(
				[{ role: 'user', content: 'hi' }],
				{ model: 'claude-sonnet-4-5', reasoning: { effort: 'low' } },
				() => {},
			);

			expect(res.content).toBe('<think>\nDeep thought\n</think>\nDone');
			expect(res.thinkingBlocks).toEqual([
				{ type: 'thinking', thinking: 'Deep thought', signature: 'sig-part-1-part-2' },
				{ type: 'redacted_thinking', data: 'enc-blob' },
			]);
		});
	});
});

