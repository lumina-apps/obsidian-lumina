import { describe, it, expect, vi } from 'vitest';
import { filterParentChunks } from './searchUtils';
import type { App } from 'obsidian';
import type { ParentChunk } from '../../../shared/types/rag.types';

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
