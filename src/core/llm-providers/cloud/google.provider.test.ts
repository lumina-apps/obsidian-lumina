/**
 * google.provider.test.ts
 * Google Gemini API 통합 — 모델 목록 조회, 에러 처리 검증
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

// ── Obsidian 의존성 모킹 ──
const mockRequestUrl = vi.fn();
vi.mock('obsidian', () => ({
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

import { GoogleProvider } from './google.provider';

describe('GoogleProvider', () => {
	const PROVIDER_ID = 'test-google';
	const API_KEY = 'AIza-test-key-12345';
	let provider: GoogleProvider;

	beforeEach(() => {
		mockRequestUrl.mockReset();
		provider = new GoogleProvider(PROVIDER_ID, API_KEY);
			// Mock window.fetch (Google stream 내부에서 사용)
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

		it('should call Google API with correct URL and key parameter', async () => {
			mockRequestUrl.mockResolvedValue({
				json: { models: [] },
			} as RequestUrlResponse);

			await provider.listModels();

			expect(mockRequestUrl).toHaveBeenCalledWith({
				url: `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`,
				method: 'GET',
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
});
