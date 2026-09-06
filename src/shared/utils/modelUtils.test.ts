import { describe, it, expect } from 'vitest';
import {
	buildChatModelOptions,
	buildEmbeddingModelOptions,
	buildDedicatedModelOptions,
	parseProviderModelValue,
	toProviderModelValue,
} from './modelUtils';
import type { LLMProviderConfig } from '../types/settings.types';

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
});

