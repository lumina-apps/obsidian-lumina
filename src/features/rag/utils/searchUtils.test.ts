import { describe, it, expect, vi } from 'vitest';
import { filterParentChunks, getAdaptiveMinSimilarity, computeCentroidEmbedding } from './searchUtils';
import type { App } from 'obsidian';
import type { ParentChunk, ChildChunk } from '../../../shared/types/rag.types';

describe('searchUtils - filterParentChunks', () => {
	const chunks: ParentChunk[] = [
		{ id: '1', path: 'projects/ai/nlp.md', text: 'chunk 1', chunkIndex: 0 },
		{ id: '2', path: 'projects/web/svelte.md', text: 'chunk 2', chunkIndex: 0 },
		{ id: '3', path: 'daily/2026-10-08.md', text: 'chunk 3', chunkIndex: 0 },
	];

	it('필터 쿼리가 비어있으면 모든 청크를 반환한다', () => {
		const mockApp = {} as unknown as App;
		expect(filterParentChunks(mockApp, chunks, '')).toEqual(chunks);
		expect(filterParentChunks(mockApp, chunks, '   ')).toEqual(chunks);
	});

	it('일반 텍스트 쿼리는 경로(대소문자 무시)를 기준으로 필터링한다', () => {
		const mockApp = {} as unknown as App;
		const res = filterParentChunks(mockApp, chunks, 'Projects');
		expect(res).toHaveLength(2);
		expect(res.map(c => c.id)).toEqual(['1', '2']);
	});

	it('#태그 쿼리는 대소문자를 구분하지 않고 중첩 태그까지 매칭한다', () => {
		const mockApp = {
			metadataCache: {
				getCache: vi.fn((path: string) => {
					if (path === 'projects/ai/nlp.md') {
						return { tags: [{ tag: '#AI/DeepLearning' }] };
					}
					if (path === 'projects/web/svelte.md') {
						return { tags: [{ tag: '#frontend' }] };
					}
					return null;
				}),
			},
		} as unknown as App;

		// 부모 태그 #ai 검색 시 #AI/DeepLearning 매칭
		const matched = filterParentChunks(mockApp, chunks, '#ai');
		expect(matched).toHaveLength(1);
		expect(matched[0].id).toBe('1');

		// 대소문자 혼합 검색
		const matchedFrontend = filterParentChunks(mockApp, chunks, '#FRONTEND');
		expect(matchedFrontend).toHaveLength(1);
		expect(matchedFrontend[0].id).toBe('2');
	});
});

describe('searchUtils - getAdaptiveMinSimilarity & computeCentroidEmbedding', () => {
	it('getAdaptiveMinSimilarity adjusts threshold for OpenAI and custom models while respecting explicit overrides', () => {
		expect(getAdaptiveMinSimilarity(0.55, 'text-embedding-3-small')).toBe(0.3);
		expect(getAdaptiveMinSimilarity(0.68, 'text-embedding-3-small')).toBe(0.37);
		expect(getAdaptiveMinSimilarity(0.55, 'ibm-granite/granite-embedding-97m-multilingual-r2')).toBe(0.55);
		expect(getAdaptiveMinSimilarity(0.55, 'text-embedding-3-small', 0.45)).toBe(0.45);
	});

	it('computeCentroidEmbedding returns L2-normalized mean vector across child chunks', () => {
		const children: ChildChunk[] = [
			{ id: 'c1', parentId: 'p1', path: 'a.md', text: '1', chunkIndex: 0, embedding: [1, 0] },
			{ id: 'c2', parentId: 'p1', path: 'a.md', text: '2', chunkIndex: 1, embedding: [0, 1] },
		];
		const centroid = computeCentroidEmbedding(children);
		expect(centroid).not.toBeNull();
		expect(centroid?.[0]).toBeCloseTo(Math.SQRT1_2, 5);
		expect(centroid?.[1]).toBeCloseTo(Math.SQRT1_2, 5);
	});
});
