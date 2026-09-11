import { describe, it, expect } from 'vitest';
import {
	buildChatModelOptions,
	buildEmbeddingModelOptions,
	buildDedicatedModelOptions,
	parseProviderModelValue,
	toProviderModelValue,
	flattenProviderModels,
	isFavoriteModel,
	toggleFavoriteModel,
	sortWithFavorites,
	sortModelOptionsWithFavorites,
} from './modelUtils';
import type { LLMProviderConfig, FavoriteModel } from '../types/settings.types';

describe('modelUtils', () => {
	const mockProviders: LLMProviderConfig[] = [
		{
			id: 'openai-1',
			type: 'openai',
			credential: 'key',
			availableModels: ['gpt-4o', 'text-embedding-3-small'],
			isVerified: true,
		},
		{
			id: 'anthropic-1',
			type: 'anthropic',
			credential: 'key',
			availableModels: ['claude-3-7-sonnet'],
			isVerified: true,
		},
		{
			id: 'claude-cli-1',
			type: 'cli-claude-code',
			credential: '',
			availableModels: ['claude-3-7-sonnet', 'claude-3-5-haiku'],
			isVerified: true,
		},
		{
			id: 'antigravity-cli-1',
			type: 'cli-antigravity',
			credential: '',
			availableModels: ['gemini-2.5-pro'],
			isVerified: true,
		},
		{
			id: 'ollama-1',
			type: 'ollama',
			credential: '',
			availableModels: ['llama3:latest', 'nomic-embed-text:latest'],
			isVerified: true,
		},
	];

	describe('buildChatModelOptions', () => {
		it('채팅용 모델 목록에는 CLI 프로바이더와 일반 LLM이 모두 포함된다', () => {
			const options = buildChatModelOptions(mockProviders);
			const values = options.map(o => o.value);
			expect(values).toContain('openai-1::gpt-4o');
			expect(values).toContain('anthropic-1::claude-3-7-sonnet');
			expect(values).toContain('claude-cli-1::claude-3-7-sonnet');
			expect(values).toContain('antigravity-cli-1::gemini-2.5-pro');
			expect(values).toContain('ollama-1::llama3:latest');
			// 임베딩 전용 모델은 제외됨
			expect(values).not.toContain('openai-1::text-embedding-3-small');
		});
	});

	describe('buildEmbeddingModelOptions', () => {
		it('임베딩 모델 목록에서는 CLI 프로바이더가 무조건 제외된다', () => {
			const options = buildEmbeddingModelOptions(mockProviders);
			const values = options.map(o => o.value);
			expect(values).toContain('openai-1::text-embedding-3-small');
			expect(values).not.toContain('claude-cli-1::claude-3-7-sonnet');
			expect(values).not.toContain('antigravity-cli-1::gemini-2.5-pro');
		});
	});

	describe('buildDedicatedModelOptions (퀵액션, 태스크, 리랭커)', () => {
		it('보조 태스크 전용 모델 목록에서는 CLI 프로바이더가 제외된다', () => {
			const options = buildDedicatedModelOptions(mockProviders);
			const values = options.map(o => o.value);
			expect(values).toContain('openai-1::gpt-4o');
			expect(values).toContain('anthropic-1::claude-3-7-sonnet');
			expect(values).toContain('ollama-1::llama3:latest');
			// CLI 프로바이더는 완전히 제외됨
			expect(values).not.toContain('claude-cli-1::claude-3-7-sonnet');
			expect(values).not.toContain('claude-cli-1::claude-3-5-haiku');
			expect(values).not.toContain('antigravity-cli-1::gemini-2.5-pro');
			// 임베딩 모델도 제외됨
			expect(values).not.toContain('openai-1::text-embedding-3-small');
		});
	});

	describe('parseProviderModelValue & toProviderModelValue', () => {
		it('providerId와 modelId를 조합하고 파싱한다', () => {
			const val = toProviderModelValue('test-p', 'gpt-4o');
			expect(val).toBe('test-p::gpt-4o');

			const parsed = parseProviderModelValue(val);
			expect(parsed).toEqual({ providerId: 'test-p', modelId: 'gpt-4o' });
		});

		it('유효하지 않은 문자열은 null을 반환한다', () => {
			expect(parseProviderModelValue('invalid-value')).toBeNull();
		});
	});

	describe('favorite models utilities', () => {
		const favorites: FavoriteModel[] = [
			{ providerId: 'openai-1', modelId: 'gpt-4o' },
			{ providerId: 'anthropic-1', modelId: 'claude-3-7-sonnet' },
		];

		it('isFavoriteModel이 올바르게 즐겨찾기 여부를 판정한다', () => {
			expect(isFavoriteModel(favorites, 'openai-1', 'gpt-4o')).toBe(true);
			expect(isFavoriteModel(favorites, 'openai-1', 'other-model')).toBe(false);
			expect(isFavoriteModel(favorites, 'other-provider', 'gpt-4o')).toBe(false);
			expect(isFavoriteModel(undefined, 'openai-1', 'gpt-4o')).toBe(false);
			expect(isFavoriteModel([], 'openai-1', 'gpt-4o')).toBe(false);
		});

		it('toggleFavoriteModel이 즐겨찾기를 추가하거나 삭제한다', () => {
			// 추가
			const added = toggleFavoriteModel(favorites, 'ollama-1', 'llama3:latest');
			expect(added).toHaveLength(3);
			expect(added.some(f => f.providerId === 'ollama-1' && f.modelId === 'llama3:latest')).toBe(true);

			// 삭제
			const removed = toggleFavoriteModel(added, 'openai-1', 'gpt-4o');
			expect(removed).toHaveLength(2);
			expect(removed.some(f => f.providerId === 'openai-1' && f.modelId === 'gpt-4o')).toBe(false);

			// undefined에서 시작
			const fromEmpty = toggleFavoriteModel(undefined, 'openai-1', 'gpt-4o');
			expect(fromEmpty).toEqual([{ providerId: 'openai-1', modelId: 'gpt-4o' }]);
		});

		it('flattenProviderModels가 favoriteModels를 받아 isFavorite를 올바르게 설정한다', () => {
			const models = flattenProviderModels(mockProviders, favorites);
			const gpt4o = models.find(m => m.providerId === 'openai-1' && m.modelId === 'gpt-4o');
			const embedding = models.find(m => m.providerId === 'openai-1' && m.modelId === 'text-embedding-3-small');

			expect(gpt4o?.isFavorite).toBe(true);
			expect(embedding?.isFavorite).toBe(false);
		});

		it('sortWithFavorites가 즐겨찾기 모델을 맨 앞으로 정렬한다', () => {
			const models = flattenProviderModels(mockProviders, favorites);
			const sorted = sortWithFavorites(models);

			// 상위 2개가 즐겨찾기 모델이어야 함
			expect(sorted[0].isFavorite).toBe(true);
			expect(sorted[1].isFavorite).toBe(true);
			// 3번째부터는 일반 모델
			expect(sorted[2].isFavorite).toBe(false);
		});

		it('sortModelOptionsWithFavorites가 ModelOption 목록에서 즐겨찾기를 상단으로 정렬하고 별 표시를 추가한다', () => {
			const options = buildChatModelOptions(mockProviders);
			const sorted = sortModelOptionsWithFavorites(options, favorites);

			expect(sorted[0].value).toBe('openai-1::gpt-4o');
			expect(sorted[0].label).toContain('★');
			expect(sorted[1].value).toBe('anthropic-1::claude-3-7-sonnet');
			expect(sorted[1].label).toContain('★');
			expect(sorted[2].label).not.toContain('★');
		});
	});
});

