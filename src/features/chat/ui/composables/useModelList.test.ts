import { describe, it, expect } from 'vitest';
import { getAllModels, filterModels, findSelectedModel } from './useModelList';
import type { LLMProviderConfig, FavoriteModel } from '../../../../shared/types/settings.types';

describe('useModelList utils', () => {
	const mockProviders: LLMProviderConfig[] = [
		{
			id: 'openai-1',
			type: 'openai',
			credential: 'test-key',
			baseUrl: '',
			availableModels: ['gpt-4o', 'gpt-4o-mini'],
			isVerified: true,
		},
		{
			id: 'anthropic-1',
			type: 'anthropic',
			credential: 'test-key-2',
			baseUrl: '',
			availableModels: ['claude-3-5-sonnet'],
			isVerified: true,
		},
	];

	const mockFavorites: FavoriteModel[] = [
		{ providerId: 'openai-1', modelId: 'gpt-4o-mini' },
	];

	it('getAllModels flattens and marks favorite models correctly', () => {
		const allModels = getAllModels(mockProviders, mockFavorites);

		expect(allModels.length).toBe(3);
		expect(allModels.some((m) => m.isFavorite)).toBe(true);

		// Favorites are sorted to top
		expect(allModels[0].modelId).toBe('gpt-4o-mini');
		expect(allModels[0].isFavorite).toBe(true);
	});

	it('filterModels filters models based on searchQuery (case-insensitive)', () => {
		const allModels = getAllModels(mockProviders, mockFavorites);

		const claudeResults = filterModels(allModels, 'claude');
		expect(claudeResults.length).toBe(1);
		expect(claudeResults[0].modelId).toBe('claude-3-5-sonnet');

		const gptResults = filterModels(allModels, 'GPT');
		expect(gptResults.length).toBe(2);

		const emptyResults = filterModels(allModels, 'non-existent-query');
		expect(emptyResults.length).toBe(0);

		// Empty query returns all
		expect(filterModels(allModels, '').length).toBe(3);
	});

	it('findSelectedModel finds matching model correctly', () => {
		const allModels = getAllModels(mockProviders, mockFavorites);

		const found = findSelectedModel(allModels, 'anthropic-1', 'claude-3-5-sonnet');
		expect(found).toBeDefined();
		expect(found?.modelId).toBe('claude-3-5-sonnet');
		expect(found?.providerId).toBe('anthropic-1');

		const notFound = findSelectedModel(allModels, 'non-existent', 'unknown');
		expect(notFound).toBeUndefined();
	});
});
