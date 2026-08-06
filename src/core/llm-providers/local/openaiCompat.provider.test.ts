/**
 * openaiCompat.provider.test.ts
 * OpenAI 호환 로컬 API (Ollama 등) — 모델 목록 조회, Rerank 검증
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

// ── Obsidian 의존성 모킹 ──
const mockRequestUrl = vi.fn();
vi.mock('obsidian', () => ({
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

import { OpenAICompatProvider } from './openaiCompat.provider';

describe('OpenAICompatProvider', () => {
	const PROVIDER_ID = 'test-ollama';
	let provider: OpenAICompatProvider;

	beforeEach(() => {
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
});
