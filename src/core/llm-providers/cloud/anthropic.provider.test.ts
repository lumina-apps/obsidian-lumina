/**
 * anthropic.provider.test.ts
 * Anthropic Claude API 통합 — 모델 목록 조회, API 호출 헤더 검증
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

// ── Obsidian 의존성 모킹 ──
const mockRequestUrl = vi.fn();
vi.mock('obsidian', () => ({
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
		});
