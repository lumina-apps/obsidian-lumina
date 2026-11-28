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

	it('LLM이 번호 매기기 목록(1. Chunk 2)으로 응답해도 인덱스를 정상 추출한다', async () => {
		const mockProvider = {
			chat: vi.fn().mockResolvedValue({
				content: '1. Chunk 2\n2. Chunk 0\n3. Chunk 1',
			}),
		};
		vi.mocked(createProvider).mockReturnValue(mockProvider as any);

		const res = await rerankChunks('query', mockChunks, mockConfig, 'gpt-4o', 3);
		expect(res).toHaveLength(3);
		expect(res[0].chunk.id).toBe('c2');
		expect(res[1].chunk.id).toBe('c0');
		expect(res[2].chunk.id).toBe('c1');
	});

	it('LLM이 설명과 쉼표가 포함된 번호 매기기 목록으로 응답해도 인덱스를 정상 추출한다', async () => {
		const mockProvider = {
			chat: vi.fn().mockResolvedValue({
				content: '1. Chunk 2, highly relevant\n2. Chunk 0, moderately relevant\n3. Chunk 1, least relevant',
			}),
		};
		vi.mocked(createProvider).mockReturnValue(mockProvider as any);

		const res = await rerankChunks('query', mockChunks, mockConfig, 'gpt-4o', 3);
		expect(res).toHaveLength(3);
		expect(res[0].chunk.id).toBe('c2');
		expect(res[1].chunk.id).toBe('c0');
		expect(res[2].chunk.id).toBe('c1');
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

	it('프롬프트 기반 리랭킹 시 bestChildText와 headingPath를 우선 포함해 평가한다', async () => {
		const richChunks = [
			{
				chunk: {
					id: 'p0',
					path: 'notes/a.md',
					text: 'A'.repeat(400) + ' TARGET_KEYWORD_HERE',
					chunkIndex: 0,
					headingPath: ['아키텍처', '검색'],
				},
				bestChildText: 'TARGET_KEYWORD_HERE relevant snippet',
				score: 0.5,
			},
		];
		const mockProvider = {
			chat: vi.fn().mockResolvedValue({ content: '0' }),
		};
		vi.mocked(createProvider).mockReturnValue(mockProvider as any);

		await rerankChunks('keyword', richChunks, mockConfig, 'gpt-4o', 1);
		const sentPrompt = vi.mocked(mockProvider.chat).mock.calls[0][0][0].content as string;
		expect(sentPrompt).toContain('notes/a.md > 아키텍처 > 검색');
		expect(sentPrompt).toContain('TARGET_KEYWORD_HERE relevant snippet');
	});

	it('네이티브 rerank에서 minNativeScore 미만 청크를 필터링하되 preserveAtLeastOne으로 1개는 보존한다', async () => {
		const mockProvider = {
			rerank: vi.fn().mockResolvedValue([
				{ index: 2, score: 0.85 },
				{ index: 0, score: 0.05 },
			]),
		};
		vi.mocked(createProvider).mockReturnValue(mockProvider as any);

		const filtered = await rerankChunks('query', mockChunks, mockConfig, 'rerank-model', 2, undefined, {
			minNativeScore: 0.15,
		});
		expect(filtered).toHaveLength(1);
		expect(filtered[0].chunk.id).toBe('c2');

		// 모두 임계값 미만이어도 기본 preserveAtLeastOne=true면 최상위 1개 보존
		mockProvider.rerank.mockResolvedValueOnce([
			{ index: 1, score: 0.08 },
			{ index: 0, score: 0.02 },
		]);
		const preserved = await rerankChunks('query', mockChunks, mockConfig, 'rerank-model', 2, undefined, {
			minNativeScore: 0.15,
		});
		expect(preserved).toHaveLength(1);
		expect(preserved[0].chunk.id).toBe('c1');
	});

	it('Structured Output JSON({"ranked_indices":[...]}) 응답과 <think> 포함 응답을 우선 파싱하고 responseFormat을 전달한다', async () => {
		const chatSpy = vi.fn().mockResolvedValue({
			content: '<think>0보다 2가 더 관련 있음</think>\n{"ranked_indices":[2, 0, 1]}',
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		const res = await rerankChunks('query about Gamma', mockChunks, mockConfig, 'gpt-4o', 2);
		expect(res).toHaveLength(2);
		expect(res[0].chunk.id).toBe('c2');
		expect(res[1].chunk.id).toBe('c0');
		expect(chatSpy).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				maxOutputTokens: 256,
				reasoning: { effort: 'off' },
				responseFormat: expect.objectContaining({
					type: 'json_schema',
					jsonSchema: expect.objectContaining({ name: 'rerank_indices' }),
				}),
			}),
		);
	});
});
