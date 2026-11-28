import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { searchVault, formatRagContext } from './search';
import type { ParentChunk } from '../../shared/types/rag.types';
import type { OramaStore } from './oramaStore';

// Mock helpers
vi.mock('../../shared/locales/helpers', () => ({
	t: (key: string) => key
}));
vi.mock('../../shared/debugLogger', () => ({
	debugLogger: {
		logDebug: vi.fn(),
		logWarn: vi.fn(),
		logError: vi.fn(),
	}
}));

describe('search module', () => {
	describe('searchVault', () => {
		it('should return empty array if no parent chunks or oramaDb is null', async () => {
			const embedFn = vi.fn();
			const result = await searchVault('query', [], null, embedFn, 5);
			expect(result).toEqual([]);
		});

		it('should return empty array if embedFn returns empty or null vector', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'file1.md', text: 'Some text', chunkIndex: 0 }
			];
			const mockOramaStore = { search: vi.fn(), searchFulltext: vi.fn() } as unknown as OramaStore;
			const embedFn = vi.fn().mockResolvedValue([]);
			const result = await searchVault('query', parentChunks, mockOramaStore, embedFn, 5);
			expect(result).toEqual([]);
		});

		it('should combine vector scores and BM25 scores correctly', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'file1.md', text: 'This is a test document about testing.', chunkIndex: 0 },
				{ id: 'p2', path: 'file2.md', text: 'Another unrelated document.', chunkIndex: 0 }
			];

			const mockOramaStore = {
				search: vi.fn().mockResolvedValue([
					{ id: 'c1', score: 0.9, activeDocument: { parentId: 'p1', text: 'This is a test' } }
				]),
				searchFulltext: vi.fn().mockResolvedValue([
					{ id: 'c1', parentId: 'p1' }
				])
			} as unknown as OramaStore;

			const embedFn = vi.fn().mockResolvedValue([[0.1, 0.2]]);

			const results = await searchVault(
				'test', 
				parentChunks, 
				mockOramaStore, 
				embedFn, 
				5, 
				0.5, 
				0.5
			);

			// p1 should be ranked first due to both BM25 and vector score
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].chunk.id).toBe('p1');
			expect(results[0].vectorScore).toBeGreaterThan(0);
			expect(results[0].bm25Score).toBeGreaterThan(0);
		});

		it('should filter out results whose rawVectorScore is below minSimilarity', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'file1.md', text: 'Some text', chunkIndex: 0 }
			];

			// Two child chunks matching to produce a bonus in vectorScore
			const mockOramaStore = {
				search: vi.fn().mockResolvedValue([
					{ id: 'c1', score: 0.60, activeDocument: { parentId: 'p1', text: 'Some text 1' } },
					{ id: 'c2', score: 0.58, activeDocument: { parentId: 'p1', text: 'Some text 2' } }
				]),
				searchFulltext: vi.fn().mockResolvedValue([])
			} as unknown as OramaStore;

			const embedFn = vi.fn().mockResolvedValue([[0.1, 0.2]]);

			// rawVectorScore is maxScore = 0.60
			// vectorScore with bonus = 0.60 + (2 - 1) * 0.05 = 0.65
			// minSimilarity is 0.62 -> rawVectorScore (0.60) < 0.62, so it should be filtered out
			const results = await searchVault(
				'query',
				parentChunks,
				mockOramaStore,
				embedFn,
				5,
				0.62, // minSimilarity
				0.5
			);

			expect(results).toHaveLength(0);
		});

		it('should pass allowedPaths to oramaStore search and searchFulltext', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'folderA/file1.md', text: 'Text in folder A', chunkIndex: 0 },
			];

			const mockOramaStore = {
				search: vi.fn().mockResolvedValue([]),
				searchFulltext: vi.fn().mockResolvedValue([]),
			} as unknown as OramaStore;

			const embedFn = vi.fn().mockResolvedValue([[0.1, 0.2]]);
			const allowedPaths = ['folderA/file1.md'];

			await searchVault(
				'query',
				parentChunks,
				mockOramaStore,
				embedFn,
				5,
				0.0,
				0.5,
				allowedPaths
			);

			expect(mockOramaStore.search).toHaveBeenCalledWith(expect.anything(), expect.any(Number), allowedPaths);
			expect(mockOramaStore.searchFulltext).toHaveBeenCalledWith('query', expect.any(Number), allowedPaths);
		});

		it('should return empty array immediately when allowedPaths is an empty array', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'folderA/file1.md', text: 'Text in folder A', chunkIndex: 0 },
			];
			const mockOramaStore = {
				search: vi.fn(),
				searchFulltext: vi.fn(),
			} as unknown as OramaStore;
			const embedFn = vi.fn();

			const results = await searchVault('query', parentChunks, mockOramaStore, embedFn, 5, 0.0, 0.5, []);
			expect(results).toEqual([]);
			expect(embedFn).not.toHaveBeenCalled();
			expect(mockOramaStore.search).not.toHaveBeenCalled();
		});

		it('extraQueries가 전달되면 배치 임베딩 후 가중 RRF로 새 관련 청크를 발굴해 병합한다', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'note1.md', text: 'Original match document', chunkIndex: 0 },
				{ id: 'p2', path: 'note2.md', text: 'Expanded synonym match document', chunkIndex: 0 },
			];

			const mockOramaStore = {
				search: vi.fn()
					.mockResolvedValueOnce([
						{ id: 'c1', score: 0.9, activeDocument: { parentId: 'p1', text: 'Original match' } },
					])
					.mockResolvedValueOnce([
						{ id: 'c2', score: 0.88, activeDocument: { parentId: 'p2', text: 'Expanded synonym' } },
					]),
				searchFulltext: vi.fn().mockResolvedValue([]),
			} as unknown as OramaStore;

			const embedFn = vi.fn().mockResolvedValue([
				[1, 0],
				[0, 1],
			]);

			const results = await searchVault(
				'그거 설명해줘',
				parentChunks,
				mockOramaStore,
				embedFn,
				5,
				0.0,
				0.5,
				null,
				{ extraQueries: [{ query: 'Expanded synonym match', weight: 0.85 }] },
			);

			expect(embedFn).toHaveBeenCalledWith(['그거 설명해줘', 'Expanded synonym match']);
			expect(results.map(r => r.chunk.id)).toContain('p1');
			expect(results.map(r => r.chunk.id)).toContain('p2');
		});

		it('enableLinkExpansion 활성화 시 Seed 노트의 1-hop 위키링크 이웃 청크를 추가로 발굴한다', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'seed.md', text: 'Seed note about project alpha', chunkIndex: 0 },
				{ id: 'p2', path: 'linked.md', text: 'Architecture decision linked from seed', chunkIndex: 0 },
			];

			const mockOramaStore = {
				search: vi.fn()
					.mockResolvedValueOnce([
						{ id: 'c1', score: 0.85, activeDocument: { parentId: 'p1', path: 'seed.md', text: 'Seed note' } },
					])
					.mockResolvedValueOnce([
						{ id: 'c2', score: 0.55, activeDocument: { parentId: 'p2', path: 'linked.md', text: 'Architecture decision' } },
					]),
				searchFulltext: vi.fn().mockResolvedValue([]),
			} as unknown as OramaStore;

			const embedFn = vi.fn().mockResolvedValue([[1, 0]]);
			const mockApp = {
				metadataCache: {
					resolvedLinks: {
						'seed.md': { 'linked.md': 1 },
					},
				},
			} as unknown as App;

			const results = await searchVault(
				'project alpha architecture',
				parentChunks,
				mockOramaStore,
				embedFn,
				5,
				0.0,
				0.5,
				null,
				{ app: mockApp, enableLinkExpansion: true },
			);

			const linkedResult = results.find(r => r.chunk.id === 'p2');
			expect(linkedResult).toBeDefined();
			expect(linkedResult?.expandedViaLink).toBe(true);
			expect(linkedResult?.linkedFromPath).toBe('seed.md');
		});

		it('1차 후보(topK 밖 하위 순위)에 이미 존재하던 1-hop 위키링크 이웃도 링크 부스트로 topK에 승격된다', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'seed.md', text: 'Seed alpha note', chunkIndex: 0 },
				{ id: 'p2', path: 'other1.md', text: 'Other note 1', chunkIndex: 0 },
				{ id: 'p3', path: 'other2.md', text: 'Other note 2', chunkIndex: 0 },
				{ id: 'p4', path: 'linked.md', text: 'Linked detail note', chunkIndex: 0 },
			];

			const mockOramaStore = {
				search: vi.fn().mockResolvedValue([
					{ id: 'c1', score: 0.90, activeDocument: { parentId: 'p1', path: 'seed.md', text: 'Seed alpha' } },
					{ id: 'c2', score: 0.70, activeDocument: { parentId: 'p2', path: 'other1.md', text: 'Other 1' } },
					{ id: 'c3', score: 0.65, activeDocument: { parentId: 'p3', path: 'other2.md', text: 'Other 2' } },
					{ id: 'c4', score: 0.45, activeDocument: { parentId: 'p4', path: 'linked.md', text: 'Linked detail' } },
				]),
				searchFulltext: vi.fn().mockResolvedValue([]),
			} as unknown as OramaStore;

			const embedFn = vi.fn().mockResolvedValue([[1, 0]]);
			const mockApp = {
				metadataCache: {
					resolvedLinks: {
						'seed.md': { 'linked.md': 1 },
					},
				},
			} as unknown as App;

			// topK = 2일 때 p4(linked.md)는 원래 4위로 탈락하지만, seed.md의 1-hop 이웃이므로 topK에 승격되어야 함
			const results = await searchVault(
				'alpha',
				parentChunks,
				mockOramaStore,
				embedFn,
				2,
				0.0,
				0.5,
				null,
				{ app: mockApp, enableLinkExpansion: true },
			);

			expect(results).toHaveLength(2);
			expect(results[0].chunk.id).toBe('p1');
			expect(results[1].chunk.id).toBe('p4');
			expect(results[1].expandedViaLink).toBe(true);
			expect(results[1].linkedFromPath).toBe('seed.md');
		});

		it('연결된 노트에 청크가 여러 개 있어도 경로당 최고 1개만 승격하고 maxLinkPromotions 상한으로 topK 도배를 방지한다', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p_seed', path: 'seed.md', text: 'Seed alpha note', chunkIndex: 0 },
				{ id: 'p_direct', path: 'direct.md', text: 'Direct match note', chunkIndex: 0 },
				{ id: 'p_link1_a', path: 'linked1.md', text: 'Linked1 chunk A', chunkIndex: 0 },
				{ id: 'p_link1_b', path: 'linked1.md', text: 'Linked1 chunk B', chunkIndex: 1 },
				{ id: 'p_link2', path: 'linked2.md', text: 'Linked2 chunk', chunkIndex: 0 },
				{ id: 'p_link3', path: 'linked3.md', text: 'Linked3 chunk', chunkIndex: 0 },
			];

			const mockOramaStore = {
				search: vi.fn()
					.mockResolvedValueOnce([
						{ id: 'c_seed', score: 0.92, activeDocument: { parentId: 'p_seed', path: 'seed.md', text: 'Seed' } },
						{ id: 'c_direct', score: 0.85, activeDocument: { parentId: 'p_direct', path: 'direct.md', text: 'Direct' } },
					])
					.mockResolvedValueOnce([
						{ id: 'c_l1a', score: 0.60, activeDocument: { parentId: 'p_link1_a', path: 'linked1.md', text: 'L1A' } },
						{ id: 'c_l1b', score: 0.58, activeDocument: { parentId: 'p_link1_b', path: 'linked1.md', text: 'L1B' } },
						{ id: 'c_l2', score: 0.55, activeDocument: { parentId: 'p_link2', path: 'linked2.md', text: 'L2' } },
						{ id: 'c_l3', score: 0.50, activeDocument: { parentId: 'p_link3', path: 'linked3.md', text: 'L3' } },
					]),
				searchFulltext: vi.fn().mockResolvedValue([]),
			} as unknown as OramaStore;

			const embedFn = vi.fn().mockResolvedValue([[1, 0]]);
			const mockApp = {
				metadataCache: {
					resolvedLinks: {
						'seed.md': { 'linked1.md': 1, 'linked2.md': 1, 'linked3.md': 1 },
					},
				},
			} as unknown as App;

			const results = await searchVault(
				'alpha',
				parentChunks,
				mockOramaStore,
				embedFn,
				4,
				0.0,
				0.5,
				null,
				{ app: mockApp, enableLinkExpansion: true },
			);

			const linkExpanded = results.filter(r => r.expandedViaLink);
			// topK=4 -> maxLinkPromotions=2, 그리고 linked1.md에서는 1개만 승격
			expect(linkExpanded).toHaveLength(2);
			expect(linkExpanded.filter(r => r.chunk.path === 'linked1.md')).toHaveLength(1);
			// 직접 매칭된 seed.md는 항상 1위로 보존됨
			expect(results[0].chunk.id).toBe('p_seed');
		});

		it('minSimilarity > 0 설정 시에도 minLinkScore를 통과해 승격된 1-hop 위키링크 결과는 최종 필터에서 탈락하지 않는다', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p_seed', path: 'seed.md', text: 'Seed alpha note', chunkIndex: 0 },
				{ id: 'p_linked', path: 'linked.md', text: 'Linked detail note', chunkIndex: 0 },
			];

			const mockOramaStore = {
				search: vi.fn()
					.mockResolvedValueOnce([
						{ id: 'c_seed', score: 0.85, activeDocument: { parentId: 'p_seed', path: 'seed.md', text: 'Seed alpha' } },
					])
					.mockResolvedValueOnce([
						// minSimilarity=0.5 보다 낮지만 minLinkScore(0.35) 이상인 0.40
						{ id: 'c_linked', score: 0.40, activeDocument: { parentId: 'p_linked', path: 'linked.md', text: 'Linked detail' } },
					]),
				searchFulltext: vi.fn().mockResolvedValue([]),
			} as unknown as OramaStore;

			const embedFn = vi.fn().mockResolvedValue([[1, 0]]);
			const mockApp = {
				metadataCache: {
					resolvedLinks: {
						'seed.md': { 'linked.md': 1 },
					},
				},
			} as unknown as App;

			const results = await searchVault(
				'alpha',
				parentChunks,
				mockOramaStore,
				embedFn,
				5,
				0.5,
				0.5,
				null,
				{ app: mockApp, enableLinkExpansion: true },
			);

			const linked = results.find(r => r.chunk.id === 'p_linked');
			expect(linked).toBeDefined();
			expect(linked?.expandedViaLink).toBe(true);
		});

		it('빈 쿼리(Centroid 검색)에서는 extraQueries 및 링크 확장을 실행하지 않는다', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'seed.md', text: 'Seed note', chunkIndex: 0 },
			];
			const mockOramaStore = {
				search: vi.fn().mockResolvedValue([
					{ id: 'c1', score: 0.9, activeDocument: { parentId: 'p1', path: 'seed.md', text: 'Seed note' } },
				]),
				searchFulltext: vi.fn().mockResolvedValue([]),
			} as unknown as OramaStore;
			const embedFn = vi.fn().mockResolvedValue([[1, 0]]);
			const mockApp = {
				metadataCache: { resolvedLinks: { 'seed.md': { 'linked.md': 1 } } },
			} as unknown as App;

			await searchVault('', parentChunks, mockOramaStore, embedFn, 5, 0.0, 0.5, null, {
				app: mockApp,
				enableLinkExpansion: true,
				extraQueries: [{ query: 'ignored', weight: 0.8 }],
			});

			expect(embedFn).toHaveBeenCalledWith(['']);
			expect(mockOramaStore.search).toHaveBeenCalledTimes(1);
		});
	});

	describe('formatRagContext', () => {
		it('headingPath가 존재하면 출처 헤더에 섹션 계층을 함께 표시한다', () => {
			const formatted = formatRagContext([
				{
					chunk: {
						id: 'p1',
						path: 'docs/guide.md',
						text: '세부 내용',
						chunkIndex: 0,
						headingPath: ['개요', '세부 설계'],
					},
					score: 0.9,
				},
			]);
			expect(formatted).toContain('docs/guide.md > 개요 > 세부 설계');
			expect(formatted).toContain('세부 내용');
		});
	});
});
