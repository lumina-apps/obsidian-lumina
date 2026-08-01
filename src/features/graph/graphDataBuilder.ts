import type { ChildChunk, ParentChunk } from '../../shared/types/rag.types';
import { updateGraphState } from './graphStore';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';

export interface GraphNode {
	id: string; // path
	name: string; // basename
	group: string; // top-level folder
	degree: number; // number of connections
}

export interface GraphEdge {
	source: string; // path
	target: string; // path
	weight: number; // cosine similarity score
}

export interface GraphData {
	nodes: GraphNode[];
	links: GraphEdge[];
}

let edgeCache: GraphEdge[] | null = null;
let lastChunkCount = -1;

const workerCode = `
self.onmessage = function(e) {
	const { chunks, minSimilarity } = e.data;
	const n = chunks.length;

	const maxK = 20;
	// 각 노드별 상위 K개의 이웃만 유지
	const topNeighbors = new Array(n);
	for (let i = 0; i < n; i++) topNeighbors[i] = [];

	function insertTopK(list, neighborIndex, weight) {
		if (list.length < maxK || weight > list[list.length - 1].weight) {
			let i = 0;
			while (i < list.length && list[i].weight > weight) i++;
			list.splice(i, 0, { index: neighborIndex, weight });
			if (list.length > maxK) list.pop();
		}
	}

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const a = chunks[i];
			const b = chunks[j];
			
			// Dot product (임베딩이 이미 정규화되어 있으므로 코사인 유사도와 동일)
			let dot = 0;
			for (let k = 0; k < a.embedding.length; k++) {
				dot += a.embedding[k] * b.embedding[k];
			}

			if (dot >= minSimilarity) {
				insertTopK(topNeighbors[i], j, dot);
				insertTopK(topNeighbors[j], i, dot);
			}
		}
	}

	const edges = [];
	for (let i = 0; i < n; i++) {
		for (const neighbor of topNeighbors[i]) {
			// 중복 엣지 제거를 위해 i < neighbor.index 인 경우만 push
			if (i < neighbor.index) {
				edges.push({
					source: chunks[i].path,
					target: chunks[neighbor.index].path,
					weight: neighbor.weight
				});
			}
		}
	}
	self.postMessage({ edges });
};
`;

function getTopLevelFolder(path: string): string {
	const parts = path.split('/');
	if (parts.length <= 1) return '/'; // root
	return parts[0];
}

function extractBasename(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1].replace(/\.md$/i, '');
}

/**
 * Parses vault data into a graph structure. Uses a Web Worker for heavy similarity calculations.
 */
export async function buildGraphData(
	parentChunks: ParentChunk[],
	childChunks: ChildChunk[],
	minSimilarity: number = 0.5,
	maxK: number = 5,
	mode: 'local' | 'global' = 'global',
	focusPath: string | null = null,
	localDepth: number = 2
): Promise<GraphData> {
	debugLogger.logSystem(
		'graph',
		`buildGraphData started (parentChunks=${parentChunks.length}, childChunks=${childChunks.length}, minSimilarity=${minSimilarity}, maxK=${maxK}, mode=${mode}, focusPath=${focusPath ?? 'null'})`,
	);

	// If chunks changed, we must rebuild the cache
	if (lastChunkCount !== parentChunks.length || edgeCache === null) {
		updateGraphState({ isCalculating: true, errorMessage: null });
		debugLogger.logSystem('graph', `buildGraphData: cache miss (lastChunkCount=${lastChunkCount}, newChunkCount=${parentChunks.length}). Recalculating edges...`);
		
		try {
			edgeCache = await calculateEdgesInWorker(childChunks, 0.4); // Calculate down to 0.4 for caching
			lastChunkCount = parentChunks.length;
			debugLogger.logSystem('graph', `buildGraphData: edge calculation completed (edges=${edgeCache.length})`);
		} catch (e) {
			debugLogger.logError('graph', new Error(`워커 엣지 계산 실패: ${e instanceof Error ? e.message : String(e)}`));
			console.error('[Lumina Graph] Worker calculation failed:', e);
			updateGraphState({ isCalculating: false, errorMessage: t('graph.calcError') });
			return { nodes: [], links: [] };
		}
	} else {
		debugLogger.logSystem('graph', `buildGraphData: cache hit (edges=${edgeCache.length})`);
	}

	updateGraphState({ isCalculating: false });

	// 1. Filter edges by similarity
	let filteredEdges = edgeCache.filter(e => e.weight >= minSimilarity);

	debugLogger.logSystem('graph', `buildGraphData: filtered edges (>=${minSimilarity}) = ${filteredEdges.length}`);

	// 2. Filter edges by maxK (keep top K edges per node)
	const edgeMap = new Map<string, GraphEdge[]>();
	for (const e of filteredEdges) {
		if (!edgeMap.has(e.source)) edgeMap.set(e.source, []);
		if (!edgeMap.has(e.target)) edgeMap.set(e.target, []);
		edgeMap.get(e.source)!.push(e);
		edgeMap.get(e.target)!.push(e);
	}

	const finalEdges: GraphEdge[] = [];
	const addedEdges = new Set<string>();

	for (const edges of edgeMap.values()) {
		// Sort by weight desc, keep top maxK
		edges.sort((a, b) => b.weight - a.weight);
		const topK = edges.slice(0, maxK);
		for (const e of topK) {
			const id = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
			if (!addedEdges.has(id)) {
				addedEdges.add(id);
				finalEdges.push(e);
			}
		}
	}

	// 3. Local mode filtering (BFS from focusPath)
	let validNodePaths = new Set<string>(parentChunks.map(p => p.path));

	if (mode === 'local' && focusPath) {
		validNodePaths = getLocalSubgraphNodes(focusPath, finalEdges, localDepth);
	}

	// 4. Build node objects
	const nodes: GraphNode[] = [];
	const degreeMap = new Map<string, number>();
	for (const e of finalEdges) {
		if (validNodePaths.has(e.source) && validNodePaths.has(e.target)) {
			degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
			degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
		}
	}

	const existingPaths = new Set<string>();
	for (const p of parentChunks) {
		if (validNodePaths.has(p.path) && !existingPaths.has(p.path)) {
			existingPaths.add(p.path);
			nodes.push({
				id: p.path,
				name: extractBasename(p.path),
				group: getTopLevelFolder(p.path),
				degree: degreeMap.get(p.path) || 0
			});
		}
	}

	// 5. Final edges filtered by valid nodes (in case of local mode)
	const actualLinks = finalEdges.filter(e => validNodePaths.has(e.source) && validNodePaths.has(e.target));

	debugLogger.logSystem('graph', `buildGraphData completed (nodes=${nodes.length}, links=${actualLinks.length})`);

	return { nodes, links: actualLinks };
}

function calculateEdgesInWorker(childChunks: ChildChunk[], baseMinSimilarity: number): Promise<GraphEdge[]> {
	return new Promise((resolve, reject) => {
		// We only want 1 chunk per file to avoid dense self-loops and redundant computation
		const firstChunks = new Map<string, ChildChunk>();
		for (const c of childChunks) {
			if (!firstChunks.has(c.path) && c.embedding) {
				firstChunks.set(c.path, c);
			}
		}
		
		const chunksData = Array.from(firstChunks.values()).map(c => ({
			path: c.path,
			embedding: c.embedding
		}));

		if (chunksData.length === 0) {
			debugLogger.logSystem('graph', 'calculateEdgesInWorker: no chunks with embeddings, skipping worker.');
			resolve([]);
			return;
		}

		const blob = new Blob([workerCode], { type: 'application/javascript' });
		const url = URL.createObjectURL(blob);
		const worker = new Worker(url);

		worker.onmessage = (e: MessageEvent) => {
			URL.revokeObjectURL(url);
			worker.terminate();
			const data = e.data as { edges: GraphEdge[] };
			resolve(data.edges);
		};

		worker.onerror = (err: ErrorEvent) => {
			URL.revokeObjectURL(url);
			worker.terminate();
			reject(new Error(err.message || 'Worker calculation failed'));
		};

		worker.postMessage({ chunks: chunksData, minSimilarity: baseMinSimilarity });
	});
}

function getLocalSubgraphNodes(startPath: string, edges: GraphEdge[], depth: number): Set<string> {
	const graph = new Map<string, string[]>();
	for (const e of edges) {
		if (!graph.has(e.source)) graph.set(e.source, []);
		if (!graph.has(e.target)) graph.set(e.target, []);
		graph.get(e.source)!.push(e.target);
		graph.get(e.target)!.push(e.source);
	}

	const visited = new Set<string>();
	let queue: string[] = [startPath];
	visited.add(startPath);

	let currentDepth = 0;
	while (queue.length > 0 && currentDepth <= depth) {
		const nextQueue: string[] = [];
		for (const node of queue) {
			const neighbors = graph.get(node) || [];
			for (const n of neighbors) {
				if (!visited.has(n)) {
					visited.add(n);
					nextQueue.push(n);
				}
			}
		}
		queue = nextQueue;
		currentDepth++;
	}

	return visited;
}
