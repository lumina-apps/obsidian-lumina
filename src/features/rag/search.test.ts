import { describe, it, expect, vi } from 'vitest';
import { cosineSimilarity, searchVault } from './search';
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
	describe('cosineSimilarity', () => {
		it('should return 1 for identical vectors', () => {
			const v1 = [1, 2, 3];
			const v2 = [1, 2, 3];
			expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
		});

		it('should return 0 for orthogonal vectors', () => {
			const v1 = [1, 0];
			const v2 = [0, 1];
			expect(cosineSimilarity(v1, v2)).toBe(0);
		});

		it('should return 0 for different length or empty vectors', () => {
			expect(cosineSimilarity([1], [1, 2])).toBe(0);
			expect(cosineSimilarity([], [])).toBe(0);
		});
	});

	describe('searchVault', () => {
		it('should return empty array if no parent chunks or oramaDb is null', async () => {
			const embedFn = vi.fn();
			const result = await searchVault('query', [], null, embedFn, 5);
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
	});
});
