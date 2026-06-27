/**
 * canvasBuilder.ts
 *
 * 위키링크([[...]]) 파싱 기반으로 Canvas 노드/엣지를 구성하고,
 * 방사형(Radial) 또는 계층형(Tree) 레이아웃으로 좌표를 계산합니다.
 */

import type { App, TFile } from 'obsidian';
import type {
	CanvasData,
	CanvasTextNode,
	CanvasEdge,
	CanvasGroupNode,
	CanvasBuildOptions,
} from './canvasTypes';

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const NODE_WIDTH = 240;
const NODE_HEIGHT = 60;
const RADIAL_LAYER_GAP = 260; // 방사형: 레이어 간 반지름 간격 (px)
const TREE_X_GAP = 300;       // 계층형: 노드 간 X 간격
const TREE_Y_GAP = 100;       // 계층형: 노드 간 Y 간격

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function generateId(index: number): string {
	return `node-${index.toString().padStart(4, '0')}`;
}

function generateEdgeId(fromId: string, toId: string): string {
	return `edge-${fromId}-${toId}`;
}

import type { CanvasSide } from './canvasTypes';

export function getEdgeSides(fromPos: {x: number, y: number}, toPos: {x: number, y: number}): {fromSide: CanvasSide, toSide: CanvasSide} {
	const dx = toPos.x - fromPos.x;
	const dy = toPos.y - fromPos.y;
	if (Math.abs(dx) > Math.abs(dy)) {
		return dx > 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
	} else {
		return dy > 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
	}
}

// ─── 링크 수집 ────────────────────────────────────────────────────────────────

/**
 * 단일 파일에서 아웃링크(outgoing) 파일 목록을 반환합니다.
 */
function getOutlinks(app: App, file: TFile): TFile[] {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache?.links) return [];

	const result: TFile[] = [];
	for (const link of cache.links) {
		const resolved = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
		if (resolved) result.push(resolved);
	}
	// 임베드 링크도 포함 (![[...]])
	if (cache.embeds) {
		for (const embed of cache.embeds) {
			const resolved = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
			if (resolved && !result.some((f) => f.path === resolved.path)) {
				result.push(resolved);
			}
		}
	}
	return result;
}

/**
 * 단일 파일로의 백링크(incoming) 파일 목록을 반환합니다.
 */
function getBacklinks(app: App, file: TFile): TFile[] {
	const resolvedLinks = app.metadataCache.resolvedLinks;
	const result: TFile[] = [];
	for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
		if (links[file.path] !== undefined) {
			const sourceFile = app.vault.getFileByPath(sourcePath);
			if (sourceFile && !result.some((f) => f.path === sourceFile.path)) {
				result.push(sourceFile);
			}
		}
	}
	return result;
}

// ─── BFS 기반 노드/엣지 수집 ──────────────────────────────────────────────────

interface CollectedGraph {
	/** path → TFile */
	nodeMap: Map<string, TFile>;
	/** 방향 있는 엣지: [from path, to path] */
	edges: Array<[string, string]>;
}

/**
 * 루트 파일들에서 BFS로 depth 깊이까지 탐색하여 노드/엣지를 수집합니다.
 */
export function collectGraph(
	app: App,
	roots: TFile[],
	opts: CanvasBuildOptions,
): CollectedGraph {
	const { depth, bidirectional, includeAttachments, maxNodes } = opts;

	const nodeMap = new Map<string, TFile>();
	const edgeSet = new Set<string>(); // "from|to" dedup
	const edges: Array<[string, string]> = [];

	// 루트 노드 추가
	for (const root of roots) {
		nodeMap.set(root.path, root);
	}

	let frontier = [...roots];
	let truncated = false;

	for (let d = 0; d < depth; d++) {
		if (truncated) break;
		const nextFrontier: TFile[] = [];

		for (const file of frontier) {
			if (truncated) break;

			// 아웃링크
			const outlinks = getOutlinks(app, file);
			for (const target of outlinks) {
				// 첨부파일 필터
				if (!includeAttachments && target.extension !== 'md') continue;

				const edgeKey = `${file.path}|${target.path}`;
				if (!edgeSet.has(edgeKey)) {
					edgeSet.add(edgeKey);
					edges.push([file.path, target.path]);
				}

				if (!nodeMap.has(target.path)) {
					nodeMap.set(target.path, target);
					nextFrontier.push(target);
					if (nodeMap.size >= maxNodes) { truncated = true; break; }
				}
			}

			// 백링크 (양방향 모드)
			if (bidirectional && !truncated) {
				const backlinks = getBacklinks(app, file);
				for (const source of backlinks) {
					if (!includeAttachments && source.extension !== 'md') continue;

					const edgeKey = `${source.path}|${file.path}`;
					if (!edgeSet.has(edgeKey)) {
						edgeSet.add(edgeKey);
						edges.push([source.path, file.path]);
					}

					if (!nodeMap.has(source.path)) {
						nodeMap.set(source.path, source);
						nextFrontier.push(source);
						if (nodeMap.size >= maxNodes) { truncated = true; break; }
					}
				}
			}
		}

		frontier = nextFrontier;
	}

	return { nodeMap, edges };
}

// ─── 레이아웃 계산: 방사형 ────────────────────────────────────────────────────

/**
 * 루트 기준으로 BFS 레이어를 계산하고,
 * 각 레이어별로 원형으로 노드 좌표를 배치합니다.
 */
function computeRadialPositions(
	roots: string[],
	edges: Array<[string, string]>,
	allPaths: string[],
): Map<string, { x: number; y: number }> {
	// adjacency (양방향)
	const adj = new Map<string, Set<string>>();
	for (const path of allPaths) adj.set(path, new Set());
	for (const [from, to] of edges) {
		adj.get(from)?.add(to);
		adj.get(to)?.add(from);
	}

	// BFS 레이어링
	const layerMap = new Map<string, number>();
	const queue: string[] = [];
	for (const r of roots) {
		if (!layerMap.has(r)) {
			layerMap.set(r, 0);
			queue.push(r);
		}
	}
	let qi = 0;
	while (qi < queue.length) {
		const cur = queue[qi++];
		const curLayer = layerMap.get(cur)!;
		for (const neighbor of (adj.get(cur) ?? [])) {
			if (!layerMap.has(neighbor)) {
				layerMap.set(neighbor, curLayer + 1);
				queue.push(neighbor);
			}
		}
	}

	// 레이어별 노드 수집
	const layers = new Map<number, string[]>();
	for (const path of allPaths) {
		const layer = layerMap.get(path) ?? 0;
		if (!layers.has(layer)) layers.set(layer, []);
		layers.get(layer)!.push(path);
	}

	// 좌표 할당
	const positions = new Map<string, { x: number; y: number }>();

	for (const [layer, nodes] of layers) {
		if (layer === 0) {
			// 루트가 여러 개면 가로 배치
			const totalW = nodes.length * (NODE_WIDTH + 40);
			nodes.forEach((path, i) => {
				positions.set(path, {
					x: i * (NODE_WIDTH + 40) - totalW / 2,
					y: 0,
				});
			});
		} else {
			const radius = layer * RADIAL_LAYER_GAP;
			const angleStep = (2 * Math.PI) / nodes.length;
			nodes.forEach((path, i) => {
				const angle = i * angleStep - Math.PI / 2;
				positions.set(path, {
					x: Math.round(Math.cos(angle) * radius),
					y: Math.round(Math.sin(angle) * radius),
				});
			});
		}
	}

	return positions;
}

// ─── 레이아웃 계산: 계층형 (LR Tree) ────────────────────────────────────────

function computeTreePositions(
	roots: string[],
	edges: Array<[string, string]>,
	allPaths: string[],
): Map<string, { x: number; y: number }> {
	// outgoing adjacency
	const children = new Map<string, string[]>();
	const parentSet = new Set<string>();
	for (const path of allPaths) children.set(path, []);
	for (const [from, to] of edges) {
		children.get(from)?.push(to);
		parentSet.add(to);
	}

	// 루트 결정: 부모가 없는 노드 (or 사용자 지정 루트)
	const treeRoots = roots.filter((r) => allPaths.includes(r));

	const positions = new Map<string, { x: number; y: number }>();
	const visited = new Set<string>();

	let currentY = 0;

	// DFS로 트리 레이아웃
	function dfs(path: string, depth: number): number {
		if (visited.has(path)) return currentY;
		visited.add(path);

		const x = depth * TREE_X_GAP;
		const y = currentY;
		positions.set(path, { x, y });
		currentY += NODE_HEIGHT + TREE_Y_GAP;

		for (const child of (children.get(path) ?? [])) {
			dfs(child, depth + 1);
		}
		return y;
	}

	for (const root of treeRoots) {
		dfs(root, 0);
	}

	// 방문 안 된 노드 (고립 노드 등)
	for (const path of allPaths) {
		if (!positions.has(path)) {
			positions.set(path, { x: 0, y: currentY });
			currentY += NODE_HEIGHT + TREE_Y_GAP;
		}
	}

	return positions;
}

// ─── 캔버스 데이터 빌드 ───────────────────────────────────────────────────────

/**
 * 수집된 노드/엣지 정보와 레이아웃을 결합하여 CanvasData를 생성합니다.
 */
export function buildCanvasData(
	collected: CollectedGraph,
	roots: TFile[],
	opts: CanvasBuildOptions,
): CanvasData {
	const { nodeMap, edges } = collected;
	const rootPaths = roots.map((r) => r.path);
	const allPaths = Array.from(nodeMap.keys());

	// 독립 노드 (엣지가 전혀 없는 노드) 분리
	const connectedNodes = new Set<string>();
	for (const [from, to] of edges) {
		connectedNodes.add(from);
		connectedNodes.add(to);
	}

	const isolatedNodes = allPaths.filter((p) => !connectedNodes.has(p));
	const connectedPaths = allPaths.filter((p) => connectedNodes.has(p));
	const connectedRoots = rootPaths.filter((p) => connectedNodes.has(p));

	// 1. 연결된 노드들만 레이아웃 계산
	const positions =
		opts.layout === 'radial'
			? computeRadialPositions(connectedRoots, edges, connectedPaths)
			: computeTreePositions(connectedRoots, edges, connectedPaths);

	// 2. 독립 노드들은 하단에 그리드 형태로 배치
	let gridStartY = 0;
	if (positions.size > 0) {
		let maxY = -Infinity;
		for (const pos of positions.values()) {
			if (pos.y > maxY) maxY = pos.y;
		}
		gridStartY = maxY + NODE_HEIGHT + 200; // 기존 그래프 밑에 배치
	}

	if (isolatedNodes.length > 0) {
		const cols = Math.max(1, Math.ceil(Math.sqrt(isolatedNodes.length)));
		const totalW = cols * (NODE_WIDTH + 40) - 40;
		const gridStartX = -totalW / 2;

		isolatedNodes.forEach((path, i) => {
			const r = Math.floor(i / cols);
			const c = i % cols;
			positions.set(path, {
				x: Math.round(gridStartX + c * (NODE_WIDTH + 40)),
				y: Math.round(gridStartY + r * (NODE_HEIGHT + 40)),
			});
		});
	}

	// 노드 빌드
	const idMap = new Map<string, string>(); // path → canvasId
	const canvasNodes: CanvasTextNode[] = [];
	let idCounter = 0;

	for (const path of allPaths) {
		const id = generateId(idCounter++);
		idMap.set(path, id);
		const pos = positions.get(path) ?? { x: 0, y: 0 };
		const isRoot = rootPaths.includes(path);

		const fileObj = collected.nodeMap.get(path);
		const baseName = fileObj ? fileObj.basename : path.split('/').pop()?.replace(/\.md$/, '') ?? path;

		canvasNodes.push({
			type: 'text',
			id,
			text: `[[${path}|${baseName}]]`,
			x: pos.x,
			y: pos.y,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
			color: isRoot && roots.length === 1 ? '5' : undefined, // 단일 루트일 때만 파란색 계열로 강조
		});
	}

	// 엣지 빌드 (중복 제거 및 양방향 처리)
	const canvasEdges: CanvasEdge[] = [];
	const edgeIdSet = new Set<string>();

	for (const [fromPath, toPath] of edges) {
		const fromId = idMap.get(fromPath);
		const toId = idMap.get(toPath);
		if (!fromId || !toId) continue;

		const forwardId = generateEdgeId(fromId, toId);
		const backwardId = generateEdgeId(toId, fromId);

		if (edgeIdSet.has(backwardId)) {
			// 이미 B->A 가 그려져 있다면 양방향 화살표로 만들어 줌
			const existingEdge = canvasEdges.find(e => e.id === backwardId);
			if (existingEdge) {
				existingEdge.fromEnd = 'arrow';
			}
			continue;
		}

		if (edgeIdSet.has(forwardId)) continue;
		edgeIdSet.add(forwardId);

		const fromPos = positions.get(fromPath) ?? { x: 0, y: 0 };
		const toPos = positions.get(toPath) ?? { x: 0, y: 0 };
		const sides = getEdgeSides(fromPos, toPos);

		canvasEdges.push({
			id: forwardId,
			fromNode: fromId,
			fromSide: sides.fromSide,
			toNode: toId,
			toSide: sides.toSide,
			toEnd: 'arrow',
		});
	}

	return { nodes: canvasNodes, edges: canvasEdges };
}

// ─── 폴더 모드: 그룹 노드 생성 ───────────────────────────────────────────────

/**
 * 폴더별로 그룹 노드를 추가하고, 해당 파일 노드들의 좌표를 기반으로 그룹 범위를 계산합니다.
 */
export function addFolderGroups(
	canvasData: CanvasData,
	nodeMap: Map<string, TFile>,
): CanvasData {
	const GROUP_PADDING = 40;

	// 폴더별 노드 수집
	const folderNodes = new Map<string, CanvasTextNode[]>();
	for (const node of canvasData.nodes) {
		if (node.type !== 'text') continue;
		const textNode = node as CanvasTextNode;
		
		const match = textNode.text.match(/^\[\[(.*?)(?:\|.*)?\]\]$/);
		if (!match) continue;
		const path = match[1];

		const file = nodeMap.get(path);
		if (!file) continue;
		const folder = file.parent?.path ?? '/';
		if (!folderNodes.has(folder)) folderNodes.set(folder, []);
		folderNodes.get(folder)!.push(textNode);
	}

	const groupNodes: CanvasGroupNode[] = [];
	let groupCounter = 0;

	for (const [folder, nodes] of folderNodes) {
		if (nodes.length === 0) continue;

		const minX = Math.min(...nodes.map((n) => n.x)) - GROUP_PADDING;
		const minY = Math.min(...nodes.map((n) => n.y)) - GROUP_PADDING;
		const maxX = Math.max(...nodes.map((n) => n.x + n.width)) + GROUP_PADDING;
		const maxY = Math.max(...nodes.map((n) => n.y + n.height)) + GROUP_PADDING;

		groupNodes.push({
			type: 'group',
			id: `group-${groupCounter++}`,
			x: minX,
			y: minY,
			width: maxX - minX,
			height: maxY - minY,
			label: folder === '/' ? '(Root)' : folder,
			color: '6', // 보라색 그룹
		});
	}

	return {
		nodes: [...groupNodes, ...canvasData.nodes],
		edges: canvasData.edges,
	};
}
