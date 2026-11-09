import { describe, it, expect, beforeEach } from 'vitest';
import { OramaStore } from './oramaStore';
import type { ChildChunk } from '../../shared/types/rag.types';

describe('OramaStore - Vector & Full-text Hybrid Search', () => {
	let store: OramaStore;
	const dimension = 3;

	beforeEach(async () => {
		store = new OramaStore(dimension);
		await store.init();
	});

	it('초기화되지 않은 상태에서 검색 호출 시 에러를 던진다', async () => {
		const uninitStore = new OramaStore(dimension);
		await expect(uninitStore.search([1, 0, 0], 5)).rejects.toThrow('OramaStore not initialized');
		await expect(uninitStore.searchFulltext('test', 5)).rejects.toThrow('OramaStore not initialized');
	});

	it('CJK 및 영문 텍스트의 바이그램 토큰화를 거쳐 청크를 삽입하고 전문 검색(Full-text)을 수행한다', async () => {
		const chunks: ChildChunk[] = [
			{
				id: 'c1',
				parentId: 'p1',
				path: 'Notes/Korean.md',
				text: '옵시디언 루미나 인덱싱 테스트입니다.',
				chunkIndex: 0,
				embedding: [1, 0, 0],
			},
			{
				id: 'c2',
				parentId: 'p2',
				path: 'Notes/English.md',
				text: 'Advanced agentic coding with Antigravity engine.',
				chunkIndex: 0,
				embedding: [0, 1, 0],
			},
		];

		await store.insertChunks(chunks);

		// 한글 키워드 부분 검색
		const koResults = await store.searchFulltext('루미나', 5);
		expect(koResults.length).toBeGreaterThan(0);
		expect(koResults[0].id).toBe('c1');
		expect(koResults[0].parentId).toBe('p1');

		// 영문 키워드 검색
		const enResults = await store.searchFulltext('Antigravity', 5);
		expect(enResults.length).toBeGreaterThan(0);
		expect(enResults[0].id).toBe('c2');
	});

	it('벡터 유사도 검색을 수행하고 allowedPaths 필터를 올바르게 적용한다', async () => {
		const chunks: ChildChunk[] = [
			{
				id: 'vec1',
				parentId: 'p1',
				path: 'Allowed/DocA.md',
				text: 'Document A about neural networks',
				chunkIndex: 0,
				embedding: [0.99, 0.01, 0.0],
			},
			{
				id: 'vec2',
				parentId: 'p2',
				path: 'Allowed/DocB.md',
				text: 'Document B about neural networks',
				chunkIndex: 0,
				embedding: [0.95, 0.05, 0.0],
			},
			{
				id: 'vec3',
				parentId: 'p3',
				path: 'Blocked/DocC.md',
				text: 'Document C also very similar to neural networks',
				chunkIndex: 0,
				embedding: [0.98, 0.02, 0.0],
			},
		];

		await store.insertChunks(chunks);

		// 1. 경로 필터 없이 검색: 유사도 높은 순서로 정렬
		const allResults = await store.search([1.0, 0.0, 0.0], 5);
		expect(allResults.length).toBe(3);
		expect(allResults[0].id).toBe('vec1');

		// 2. 단일 경로 필터(string) 적용: Allowed/DocA.md만 나와야 함
		const singleFilterResults = await store.search([1.0, 0.0, 0.0], 5, 'Allowed/DocA.md');
		expect(singleFilterResults.length).toBe(1);
		expect(singleFilterResults[0].id).toBe('vec1');

		// 3. 다중 경로 필터(string[]) 적용: Allowed 경로들만 포함
		const multiFilterResults = await store.search(
			[1.0, 0.0, 0.0],
			5,
			['Allowed/DocA.md', 'Allowed/DocB.md'],
		);
		expect(multiFilterResults.length).toBe(2);
		expect(multiFilterResults.map(r => r.id)).toEqual(['vec1', 'vec2']);
		expect(multiFilterResults.some(r => r.id === 'vec3')).toBe(false);

		// 4. 빈 경로 필터([]) 전달 시 빈 배열 즉시 반환
		const emptyFilterResults = await store.search([1.0, 0.0, 0.0], 5, []);
		expect(emptyFilterResults).toEqual([]);
	});

	it('deleteByIds로 청크를 삭제하면 검색 결과에서 제외된다', async () => {
		const chunks: ChildChunk[] = [
			{
				id: 'del1',
				parentId: 'p1',
				path: 'note.md',
				text: 'Temporary item',
				chunkIndex: 0,
				embedding: [1, 0, 0],
			},
			{
				id: 'keep1',
				parentId: 'p2',
				path: 'note.md',
				text: 'Keep item',
				chunkIndex: 1,
				embedding: [0, 1, 0],
			},
		];

		await store.insertChunks(chunks);
		expect((await store.search([1, 0, 0], 5)).length).toBe(2);

		await store.deleteByIds(['del1']);

		const afterDelete = await store.search([1, 0, 0], 5);
		expect(afterDelete.length).toBe(1);
		expect(afterDelete[0].id).toBe('keep1');
	});

	it('clear() 호출 시 모든 인덱스가 초기화된다', async () => {
		await store.insertChunks([
			{
				id: 'c_clear',
				parentId: 'p1',
				path: 'note.md',
				text: 'text',
				chunkIndex: 0,
				embedding: [1, 0, 0],
			},
		]);

		expect((await store.search([1, 0, 0], 5)).length).toBe(1);

		await store.clear();

		expect((await store.search([1, 0, 0], 5)).length).toBe(0);
	});
});
