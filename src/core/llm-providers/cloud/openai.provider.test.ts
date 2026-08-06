/**
 * openai.provider.test.ts
 * OpenAI API 통합 — 모델 목록 조회, 에러 처리 검증
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

// ── Obsidian 의존성 모킹 ──
const mockRequestUrl = vi.fn();
vi.mock('obsidian', () => ({
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

	describe('constructor', () => {
		it('should initialize with providerId and apiKey', () => {
			expect(provider.providerId).toBe(PROVIDER_ID);
				});

		it('should have correct provider ID prefix', () => {
			const p = new OpenAIProvider('custom-id', 'key');
			expect(p.providerId).toBe('custom-id');
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
	});
