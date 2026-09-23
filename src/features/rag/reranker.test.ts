import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rerankChunks } from './reranker';
import type { SearchResult } from '../../shared/types/rag.types';
import type { LLMProviderConfig } from '../../shared/types/settings.types';
import { createProvider } from '../../core/llm-providers';

vi.mock('../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

describe('reranker', () => {
	const mockChunks: SearchResult[] = [
		{ chunk: { id: 'c0', path: 'a.md', text: 'Text about Alpha', chunkIndex: 0 }, score: 0.5 },
		{ chunk: { id: 'c1', path: 'b.md', text: 'Text about Beta', chunkIndex: 1 }, score: 0.6 },
		{ chunk: { id: 'c2', path: 'c.md', text: 'Text about Gamma', chunkIndex: 2 }, score: 0.7 },
	];

	const mockConfig: LLMProviderConfig = {
		id: 'test-rerank-provider',
		type: 'openai',
		credential: 'test',
		availableModels: ['gpt-4o'],
		isVerified: true,
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('빈 청크 배열 전달 시 LLM 호출 없이 빈 배열을 즉시 반환한다', async () => {
		const res = await rerankChunks('query', [], mockConfig, 'gpt-4o', 3);
		expect(res).toEqual([]);
		expect(createProvider).not.toHaveBeenCalled();
	});

	it('네이티브 rerank API를 지원하는 프로바이더인 경우 API 결과를 우선 적용한다', async () => {
		const mockProvider = {
			rerank: vi.fn().mockResolvedValue([
				{ index: 2, score: 0.95 },
				{ index: 0, score: 0.85 },
			]),
			chat: vi.fn(),
		};
		vi.mocked(createProvider).mockReturnValue(mockProvider as any);

		const res = await rerankChunks('query', mockChunks, mockConfig, 'rerank-model', 2);
		expect(res).toHaveLength(2);
		expect(res[0].chunk.id).toBe('c2');
		expect(res[0].score).toBe(0.95);
		expect(res[1].chunk.id).toBe('c0');
		expect(res[1].score).toBe(0.85);
		expect(mockProvider.rerank).toHaveBeenCalledTimes(1);
		expect(mockProvider.chat).not.toHaveBeenCalled();
	});

	it('네이티브 rerank가 없는 경우 프롬프트 기반 Listwise Reranking을 수행한다', async () => {
		const mockProvider = {
			chat: vi.fn().mockResolvedValue({
				content: '2, 0, 1',
			}),
		};
		vi.mocked(createProvider).mockReturnValue(mockProvider as any);

		const res = await rerankChunks('query about Gamma', mockChunks, mockConfig, 'gpt-4o', 2);
		expect(res).toHaveLength(2);
		expect(res[0].chunk.id).toBe('c2');
		expect(res[1].chunk.id).toBe('c0');
		expect(mockProvider.chat).toHaveBeenCalledTimes(1);
	});

	it('네이티브 rerank API 호출 중 오류 발생 시 프롬프트 기반으로 Fallback한다', async () => {
		const mockProvider = {
			rerank: vi.fn().mockRejectedValue(new Error('Model not supported')),
			chat: vi.fn().mockResolvedValue({
				content: '1, 2, 0',
			}),
		};
		vi.mocked(createProvider).mockReturnValue(mockProvider as any);

		const res = await rerankChunks('query', mockChunks, mockConfig, 'gpt-4o', 3);
		expect(res).toHaveLength(3);
		expect(res[0].chunk.id).toBe('c1');
		expect(res[1].chunk.id).toBe('c2');
		expect(res[2].chunk.id).toBe('c0');
	});

	it('프롬프트 응답이 파싱 불가능한 엉뚱한 문자열인 경우 원본 순서로 안전하게 Fallback한다', async () => {
		const mockProvider = {
			chat: vi.fn().mockResolvedValue({
				content: 'I am sorry, I cannot rank these documents.',
			}),
		};
		vi.mocked(createProvider).mockReturnValue(mockProvider as any);

		const res = await rerankChunks('query', mockChunks, mockConfig, 'gpt-4o', 2);
		expect(res).toHaveLength(2);
		// 원본 chunks의 상위 2개가 그대로 반환되어야 함
		expect(res[0].chunk.id).toBe('c0');
		expect(res[1].chunk.id).toBe('c1');
	});
});
