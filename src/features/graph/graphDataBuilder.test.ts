import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	buildGraphData,
	getLocalSubgraphNodes,
	extractBasename,
	getTopLevelFolder,
	invalidateEdgeCache,
	type GraphEdge,
} from './graphDataBuilder';
import type { ChildChunk, ParentChunk } from '../../shared/types/rag.types';

describe('graphDataBuilder', () => {
	beforeEach(() => {
		invalidateEdgeCache();
		vi.clearAllMocks();
	});

	describe('extractBasename', () => {
		it('should extract basename without .md extension', () => {
			expect(extractBasename('folder/note.md')).toBe('note');
			expect(extractBasename('folder/sub/my-note.md')).toBe('my-note');
			expect(extractBasename('rootNote.md')).toBe('rootNote');
		});

		it('should handle case-insensitive .MD extension', () => {
			expect(extractBasename('note.MD')).toBe('note');
		});

		it('should return filename as is if not ending in .md', () => {
			expect(extractBasename('folder/data.json')).toBe('data.json');
		});

		it('should handle Windows backslash paths', () => {
			expect(extractBasename('folder\\note.md')).toBe('note');
			expect(extractBasename('folder\\sub\\my-note.md')).toBe('my-note');
		});
	});

	describe('getTopLevelFolder', () => {
		it('should return "/" for files in root', () => {
			expect(getTopLevelFolder('rootNote.md')).toBe('/');
		});

		it('should return top-level folder name for nested files', () => {
			expect(getTopLevelFolder('Docs/guide.md')).toBe('Docs');
			expect(getTopLevelFolder('Projects/2026/plan.md')).toBe('Projects');
		});

		it('should handle Windows backslash paths', () => {
			expect(getTopLevelFolder('Docs\\guide.md')).toBe('Docs');
			expect(getTopLevelFolder('Projects\\2026\\plan.md')).toBe('Projects');
		});
	});

	describe('getLocalSubgraphNodes (BFS traversal)', () => {
		const edges: GraphEdge[] = [
			{ source: 'A.md', target: 'B.md', weight: 0.8 },
			{ source: 'B.md', target: 'C.md', weight: 0.7 },
			{ source: 'C.md', target: 'D.md', weight: 0.6 },
			{ source: 'E.md', target: 'F.md', weight: 0.9 }, // disjoint component
		];

		it('should return only the start node when depth is 0', () => {
			const nodes = getLocalSubgraphNodes('A.md', edges, 0);
			expect(nodes).toEqual(new Set(['A.md']));
		});

		it('should return only 1-hop neighbors when depth is 1 (off-by-one verification)', () => {
			const nodes = getLocalSubgraphNodes('A.md', edges, 1);
			// 1-hop from A is only B
			expect(nodes).toEqual(new Set(['A.md', 'B.md']));
			expect(nodes.has('C.md')).toBe(false);
		});

		it('should return 2-hop neighbors when depth is 2', () => {
			const nodes = getLocalSubgraphNodes('A.md', edges, 2);
			// 2-hop from A is B and C
			expect(nodes).toEqual(new Set(['A.md', 'B.md', 'C.md']));
			expect(nodes.has('D.md')).toBe(false);
		});

		it('should return all reachable nodes up to depth 3', () => {
			const nodes = getLocalSubgraphNodes('A.md', edges, 3);
			expect(nodes).toEqual(new Set(['A.md', 'B.md', 'C.md', 'D.md']));
			expect(nodes.has('E.md')).toBe(false);
		});

		it('should handle cyclic graph without infinite loop', () => {
			const cyclicEdges: GraphEdge[] = [
				{ source: 'A.md', target: 'B.md', weight: 0.8 },
				{ source: 'B.md', target: 'C.md', weight: 0.8 },
				{ source: 'C.md', target: 'A.md', weight: 0.8 },
			];
			const nodes = getLocalSubgraphNodes('A.md', cyclicEdges, 5);
			expect(nodes).toEqual(new Set(['A.md', 'B.md', 'C.md']));
		});

		it('should return only start node if isolated (no edges)', () => {
			const nodes = getLocalSubgraphNodes('Isolated.md', edges, 2);
			expect(nodes).toEqual(new Set(['Isolated.md']));
		});
	});

	describe('buildGraphData with Web Worker', () => {
		let createdUrls: string[] = [];
		let mockWorkerInstance: {
			postMessage: ReturnType<typeof vi.fn>;
			onmessage: ((e: MessageEvent) => void) | null;
			onerror: ((err: ErrorEvent) => void) | null;
			terminate: ReturnType<typeof vi.fn>;
		};

		beforeEach(() => {
			createdUrls = [];
			vi.stubGlobal('URL', {
				createObjectURL: vi.fn(() => {
					const url = `blob:test-worker-${createdUrls.length}`;
					createdUrls.push(url);
					return url;
				}),
				revokeObjectURL: vi.fn(),
			});

			mockWorkerInstance = {
				postMessage: vi.fn(function (data: { chunks: Array<{ path: string; embedding: number[] }>; minSimilarity: number }) {
					// Simulate worker computing pairwise similarity
					const { chunks, minSimilarity } = data;
					const edges: GraphEdge[] = [];
					for (let i = 0; i < chunks.length; i++) {
						for (let j = i + 1; j < chunks.length; j++) {
							let dot = 0;
							for (let k = 0; k < chunks[i].embedding.length; k++) {
								dot += chunks[i].embedding[k] * chunks[j].embedding[k];
							}
							if (dot >= minSimilarity) {
								edges.push({
									source: chunks[i].path,
									target: chunks[j].path,
									weight: dot,
								});
							}
						}
					}
					// Asynchronously post result back
					setTimeout(() => {
						mockWorkerInstance.onmessage?.({ data: { edges } } as MessageEvent);
					}, 0);
				}),
				onmessage: null,
				onerror: null,
				terminate: vi.fn(),
			};

			vi.stubGlobal('Worker', vi.fn(function () {
				return mockWorkerInstance;
			}));
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it('should return empty graph if parent chunks are empty', async () => {
			const result = await buildGraphData([], []);
			expect(result.nodes).toEqual([]);
			expect(result.links).toEqual([]);
			expect(mockWorkerInstance.postMessage).not.toHaveBeenCalled();
		});

		it('should return isolated nodes without links if child chunks have no embeddings', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'A.md', text: 'hello', chunkIndex: 0 },
			];
			const childChunks: ChildChunk[] = [
				{ id: 'c1', parentId: 'p1', path: 'A.md', text: 'hello', chunkIndex: 0 }, // no embedding
			];

			const result = await buildGraphData(parentChunks, childChunks);
			expect(result.nodes).toEqual([
				{
					id: 'A.md',
					name: 'A',
					group: '/',
					degree: 0,
				},
			]);
			expect(result.links).toEqual([]);
			expect(mockWorkerInstance.postMessage).not.toHaveBeenCalled();
		});

		it('should calculate edges and build global graph', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'folder1/A.md', text: 'note A', chunkIndex: 0 },
				{ id: 'p2', path: 'folder2/B.md', text: 'note B', chunkIndex: 0 },
			];
			const childChunks: ChildChunk[] = [
				{ id: 'c1', parentId: 'p1', path: 'folder1/A.md', text: 'note A', chunkIndex: 0, embedding: [1, 0] },
				{ id: 'c2', parentId: 'p2', path: 'folder2/B.md', text: 'note B', chunkIndex: 0, embedding: [1, 0] }, // similarity = 1.0
			];

			const result = await buildGraphData(parentChunks, childChunks, 0.5, 5, 'global');

			expect(result.nodes).toHaveLength(2);
			expect(result.nodes).toContainEqual({
				id: 'folder1/A.md',
				name: 'A',
				group: 'folder1',
				degree: 1,
			});
			expect(result.nodes).toContainEqual({
				id: 'folder2/B.md',
				name: 'B',
				group: 'folder2',
				degree: 1,
			});
			expect(result.links).toHaveLength(1);
			expect(result.links[0].weight).toBeCloseTo(1.0);
		});

		it('should respect minSimilarity threshold', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'A.md', text: 'note A', chunkIndex: 0 },
				{ id: 'p2', path: 'B.md', text: 'note B', chunkIndex: 0 },
			];
			const childChunks: ChildChunk[] = [
				{ id: 'c1', parentId: 'p1', path: 'A.md', text: 'note A', chunkIndex: 0, embedding: [0.6, 0] },
				{ id: 'c2', parentId: 'p2', path: 'B.md', text: 'note B', chunkIndex: 0, embedding: [1.0, 0] }, // similarity = 0.6
			];

			// If minSimilarity is 0.7, edge with 0.6 similarity should be excluded
			const result = await buildGraphData(parentChunks, childChunks, 0.7, 5, 'global');
			expect(result.links).toHaveLength(0);
		});

		it('should cache edges and avoid recomputation on repeated calls with same chunks', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'A.md', text: 'A', chunkIndex: 0 },
				{ id: 'p2', path: 'B.md', text: 'B', chunkIndex: 0 },
			];
			const childChunks: ChildChunk[] = [
				{ id: 'c1', parentId: 'p1', path: 'A.md', text: 'A', chunkIndex: 0, embedding: [1, 0] },
				{ id: 'c2', parentId: 'p2', path: 'B.md', text: 'B', chunkIndex: 0, embedding: [1, 0] },
			];

			await buildGraphData(parentChunks, childChunks);
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);

			// Second call with same chunks should hit cache
			await buildGraphData(parentChunks, childChunks);
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
		});

		it('should invalidate cache when invalidateEdgeCache is called', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'A.md', text: 'A', chunkIndex: 0 },
				{ id: 'p2', path: 'B.md', text: 'B', chunkIndex: 0 },
			];
			const childChunks: ChildChunk[] = [
				{ id: 'c1', parentId: 'p1', path: 'A.md', text: 'A', chunkIndex: 0, embedding: [1, 0] },
				{ id: 'c2', parentId: 'p2', path: 'B.md', text: 'B', chunkIndex: 0, embedding: [1, 0] },
			];

			await buildGraphData(parentChunks, childChunks);
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);

			invalidateEdgeCache();

			await buildGraphData(parentChunks, childChunks);
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(2);
		});

		it('should recalculate when chunks change (fingerprint difference)', async () => {
			const parentChunks1: ParentChunk[] = [
				{ id: 'p1', path: 'A.md', text: 'A', chunkIndex: 0 },
				{ id: 'p2', path: 'B.md', text: 'B', chunkIndex: 0 },
			];
			const childChunks1: ChildChunk[] = [
				{ id: 'c1', parentId: 'p1', path: 'A.md', text: 'A', chunkIndex: 0, embedding: [1, 0] },
				{ id: 'c2', parentId: 'p2', path: 'B.md', text: 'B', chunkIndex: 0, embedding: [1, 0] },
			];

			await buildGraphData(parentChunks1, childChunks1);
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);

			// Different chunk added
			const parentChunks2: ParentChunk[] = [
				...parentChunks1,
				{ id: 'p3', path: 'C.md', text: 'C', chunkIndex: 0 },
			];
			const childChunks2: ChildChunk[] = [
				...childChunks1,
				{ id: 'c3', parentId: 'p3', path: 'C.md', text: 'C', chunkIndex: 0, embedding: [1, 0] },
			];

			await buildGraphData(parentChunks2, childChunks2);
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(2);
		});

		it('should filter subgraph in local mode based on focusPath and depth', async () => {
			const parentChunks: ParentChunk[] = [
				{ id: 'p1', path: 'A.md', text: 'A', chunkIndex: 0 },
				{ id: 'p2', path: 'B.md', text: 'B', chunkIndex: 0 },
				{ id: 'p3', path: 'C.md', text: 'C', chunkIndex: 0 },
			];
			// A and B are similar, but C is orthogonal
			const childChunks: ChildChunk[] = [
				{ id: 'c1', parentId: 'p1', path: 'A.md', text: 'A', chunkIndex: 0, embedding: [1, 0] },
				{ id: 'c2', parentId: 'p2', path: 'B.md', text: 'B', chunkIndex: 0, embedding: [1, 0] },
				{ id: 'c3', parentId: 'p3', path: 'C.md', text: 'C', chunkIndex: 0, embedding: [0, 1] },
			];

			const result = await buildGraphData(parentChunks, childChunks, 0.5, 5, 'local', 'A.md', 1);

			// Only A and its 1-hop neighbor B should be included, C should be excluded
			const nodeIds = result.nodes.map(n => n.id);
			expect(nodeIds).toContain('A.md');
			expect(nodeIds).toContain('B.md');
			expect(nodeIds).not.toContain('C.md');
		});
	});
});
