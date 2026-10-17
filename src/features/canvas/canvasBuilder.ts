/**
 * canvasBuilder.ts
 *
 * 위키링크([[...]]) 파싱 기반으로 Canvas 노드/엣지를 구성하고,
 * 방사형(Radial) 또는 계층형(Tree) 레이아웃으로 좌표를 계산합니다.
 */

import { normalizePath, type App, type TFile } from 'obsidian';
import type {
	CanvasData,
	CanvasTextNode,
	CanvasEdge,
	CanvasGroupNode,
	CanvasBuildOptions,
	CanvasSide,
} from './canvasTypes';
import { t } from '../../shared/locales/helpers';

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

function cleanLinkpath(link: string): string {
	return link.split('#')[0].split('^')[0].trim();
}

/**
 * 단일 파일에서 아웃링크(outgoing) 파일 목록을 반환합니다.
 */
function getOutlinks(app: App, file: TFile): TFile[] {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return [];

	const result: TFile[] = [];
	const seen = new Set<string>();

	const addDest = (rawLink: string) => {
		const cleanPath = cleanLinkpath(rawLink);
		if (!cleanPath) return;
		const resolved = app.metadataCache.getFirstLinkpathDest(cleanPath, file.path);
		if (resolved && resolved.path !== file.path && !seen.has(resolved.path)) {
			seen.add(resolved.path);
			result.push(resolved);
		}
	};

	if (cache.links) {
		for (const link of cache.links) {
			addDest(link.link);
		}
	}
	if (cache.embeds) {
		for (const embed of cache.embeds) {
			addDest(embed.link);
		}
	}
	return result;
}

// ─── BFS 기반 노드/엣지 수집 ──────────────────────────────────────────────────

export interface CollectedGraph {
	/** path → TFile */
	nodeMap: Map<string, TFile>;
	/** 방향 있는 엣지: [from path, to path] */
	edges: Array<[string, string]>;
	/** maxNodes 제한으로 인해 일부 노드가 제외되었는지 여부 */
	truncated?: boolean;
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
	let truncated = false;

	// bidirectional 모드일 때 역방향 인덱스 1회 구축 (O(V + E))
	let backlinkMap: Map<string, TFile[]> | null = null;
	if (bidirectional) {
		backlinkMap = new Map();
		const resolvedLinks = app.metadataCache.resolvedLinks || {};
		for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
			const sourceFile = app.vault.getFileByPath(sourcePath);
			if (!sourceFile) continue;
			for (const targetPath of Object.keys(links)) {
				if (targetPath === sourcePath) continue; // self-loop 제외
				if (!backlinkMap.has(targetPath)) backlinkMap.set(targetPath, []);
				backlinkMap.get(targetPath)!.push(sourceFile);
			}
		}
	}

	// 루트 노드 추가 (maxNodes 상한 체크)
	const frontier: TFile[] = [];
	for (const root of roots) {
		if (nodeMap.has(root.path)) continue;
		if (nodeMap.size >= maxNodes) {
			truncated = true;
			break;
		}
		nodeMap.set(root.path, root);
		frontier.push(root);
	}

	let currentFrontier = frontier;

	for (let d = 0; d < depth; d++) {
		if (currentFrontier.length === 0) break;
		const nextFrontier: TFile[] = [];

		for (const file of currentFrontier) {
			// 아웃링크
			const outlinks = getOutlinks(app, file);
			for (const target of outlinks) {
				if (target.path === file.path) continue; // 셀프 루프 제외
				if (!includeAttachments && target.extension !== 'md') continue;

				if (!nodeMap.has(target.path)) {
					if (nodeMap.size >= maxNodes) {
						truncated = true;
						continue; // 신규 노드 추가만 스킵
					}
					nodeMap.set(target.path, target);
					nextFrontier.push(target);
				}

				if (nodeMap.has(target.path)) {
					const edgeKey = `${file.path}|${target.path}`;
					if (!edgeSet.has(edgeKey)) {
						edgeSet.add(edgeKey);
						edges.push([file.path, target.path]);
					}
				}
			}

			// 백링크 (양방향 모드)
			if (bidirectional && backlinkMap) {
				const backlinks = backlinkMap.get(file.path) ?? [];
				for (const source of backlinks) {
					if (source.path === file.path) continue;
					if (!includeAttachments && source.extension !== 'md') continue;

					if (!nodeMap.has(source.path)) {
						if (nodeMap.size >= maxNodes) {
							truncated = true;
							continue;
						}
						nodeMap.set(source.path, source);
						nextFrontier.push(source);
					}

					if (nodeMap.has(source.path)) {
						const edgeKey = `${source.path}|${file.path}`;
						if (!edgeSet.has(edgeKey)) {
							edgeSet.add(edgeKey);
							edges.push([source.path, file.path]);
						}
					}
				}
			}
		}

		currentFrontier = nextFrontier;
	}

	return { nodeMap, edges, truncated };
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

	// BFS 레이어링 시드 선정
	const layerMap = new Map<string, number>();
	const queue: string[] = [];

	if (roots.length <= 1) {
		for (const r of roots) {
			if (!layerMap.has(r) && allPaths.includes(r)) {
				layerMap.set(r, 0);
				queue.push(r);
			}
		}
	} else {
		// 다중 루트 (폴더 모드): 연결 컴포넌트별로 가장 연결도(degree)가 높은 허브 노드를 layer 0 시드로 선정
		const visitedPaths = new Set<string>();
		const validRoots = roots.filter(r => allPaths.includes(r));

		for (const r of validRoots) {
			if (visitedPaths.has(r)) continue;

			const component: string[] = [];
			const compQueue = [r];
			visitedPaths.add(r);

			while (compQueue.length > 0) {
				const cur = compQueue.shift()!;
				component.push(cur);
				for (const neighbor of (adj.get(cur) ?? [])) {
					if (!visitedPaths.has(neighbor)) {
						visitedPaths.add(neighbor);
						compQueue.push(neighbor);
					}
				}
			}

			const componentRoots = component.filter(p => validRoots.includes(p));
			const candidates = componentRoots.length > 0 ? componentRoots : component;
			candidates.sort((a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0));
			const hub = candidates[0];

			if (hub && !layerMap.has(hub)) {
				layerMap.set(hub, 0);
				queue.push(hub);
			}
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

	// 미방문 노드 폴백 (고립 노드 방어)
	for (const path of allPaths) {
		if (!layerMap.has(path)) {
			layerMap.set(path, 0);
		}
	}

	// 레이어별 노드 수집
	const layers = new Map<number, string[]>();
	for (const path of allPaths) {
		const layer = layerMap.get(path) ?? 0;
		if (!layers.has(layer)) layers.set(layer, []);
		layers.get(layer)!.push(path);
	}

	// 각 레이어 내 노드를 폴더 경로 순으로 정렬하여 동일 폴더 노드가 인접 각도에 모이도록 함
	for (const nodes of layers.values()) {
		nodes.sort((a, b) => {
			const folderA = a.includes('/') ? a.substring(0, a.lastIndexOf('/')) : '';
			const folderB = b.includes('/') ? b.substring(0, b.lastIndexOf('/')) : '';
			return folderA.localeCompare(folderB);
		});
	}

	// 좌표 할당 (오름차순 레이어 순회 및 단조 증가 반지름 보장)
	const positions = new Map<string, { x: number; y: number }>();
	const sortedLayerNums = Array.from(layers.keys()).sort((a, b) => a - b);
	let prevRadius = 0;

	for (const layer of sortedLayerNums) {
		const nodes = layers.get(layer)!;
		if (layer === 0) {
			if (nodes.length === 1) {
				positions.set(nodes[0], { x: 0, y: 0 });
				prevRadius = 0;
			} else {
				// 다중 허브: 작은 중심 원으로 배치
				const circumference = nodes.length * (NODE_WIDTH + 40);
				const r0 = Math.max(160, Math.ceil(circumference / (2 * Math.PI)));
				prevRadius = r0;
				const angleStep = (2 * Math.PI) / nodes.length;
				nodes.forEach((path, i) => {
					const angle = i * angleStep - Math.PI / 2;
					positions.set(path, {
						x: Math.round(Math.cos(angle) * r0),
						y: Math.round(Math.sin(angle) * r0),
					});
				});
			}
		} else {
			const minRadius = Math.ceil((nodes.length * (NODE_WIDTH + 40)) / (2 * Math.PI));
			const radius = Math.max(prevRadius + RADIAL_LAYER_GAP, layer * RADIAL_LAYER_GAP, minRadius);
			prevRadius = radius;
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
	const children = new Map<string, string[]>();
	const inDegree = new Map<string, number>();
	for (const path of allPaths) {
		children.set(path, []);
		inDegree.set(path, 0);
	}
	for (const [from, to] of edges) {
		if (children.has(from) && children.has(to)) {
			children.get(from)!.push(to);
			inDegree.set(to, (inDegree.get(to) || 0) + 1);
		}
	}

	// 자식 노드를 폴더명 순으로 정렬
	for (const list of children.values()) {
		list.sort((a, b) => a.localeCompare(b));
	}

	const positions = new Map<string, { x: number; y: number }>();
	const visited = new Set<string>();
	let currentY = 0;

	function dfs(path: string, depth: number): number {
		visited.add(path);
		const x = depth * TREE_X_GAP;

		const unvisitedChildren = (children.get(path) ?? []).filter(c => !visited.has(c));

		if (unvisitedChildren.length === 0) {
			const y = currentY;
			positions.set(path, { x, y });
			currentY += NODE_HEIGHT + TREE_Y_GAP;
			return y;
		}

		const childYs: number[] = [];
		for (const child of unvisitedChildren) {
			childYs.push(dfs(child, depth + 1));
		}

		// 부모 Y 좌표를 자식들의 중간값에 정렬
		const y = Math.round((childYs[0] + childYs[childYs.length - 1]) / 2);
		positions.set(path, { x, y });
		return y;
	}

	// roots 중 inDegree === 0인 노드를 우선 탐색
	const treeRoots = roots.filter((r) => allPaths.includes(r));
	treeRoots.sort((a, b) => (inDegree.get(a) || 0) - (inDegree.get(b) || 0));

	for (const root of treeRoots) {
		if (!visited.has(root)) {
			dfs(root, 0);
		}
	}

	// 미방문 노드
	for (const path of allPaths) {
		if (!visited.has(path)) {
			dfs(path, 0);
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

	// 2. 독립 노드들은 하단에 그리드 형태로 배치 (폴더 순 정렬)
	let gridStartY = 0;
	if (positions.size > 0) {
		let maxY = -Infinity;
		for (const pos of positions.values()) {
			if (pos.y > maxY) maxY = pos.y;
		}
		gridStartY = maxY + NODE_HEIGHT + 200; // 기존 그래프 밑에 배치
	}

	if (isolatedNodes.length > 0) {
		isolatedNodes.sort((a, b) => a.localeCompare(b));
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
		const baseName = fileObj ? fileObj.basename : normalizePath(path).split('/').pop()?.replace(/\.md$/, '') ?? path;

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
		if (fromPath === toPath) continue; // 셀프 루프 방어

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
 * 서로 멀리 떨어진 노드 클러스터는 분리하여 거대한 그룹 박스 겹침을 방지합니다.
 */
export function addFolderGroups(
	canvasData: CanvasData,
	nodeMap: Map<string, TFile>,
): CanvasData {
	const GROUP_PADDING = 40;
	const CLUSTER_DISTANCE_THRESHOLD = 800; // 이 거리 이상 떨어져 있으면 별도 그룹으로 분리
	const GROUP_COLORS = ['6', '4', '2', '5', '3', '1'];

	// 폴더별 노드 수집
	const folderNodes = new Map<string, CanvasTextNode[]>();
	for (const node of canvasData.nodes) {
		if (node.type !== 'text') continue;
		const textNode = node;
		
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
	let colorIndex = 0;

	for (const [folder, nodes] of folderNodes) {
		if (nodes.length === 0) continue;

		// 거리 기반 클러스터링으로 고립 노드와 연결 노드가 화면 전체를 덮지 않도록 분리
		const clusters: CanvasTextNode[][] = [];
		const visited = new Set<string>();

		for (const n of nodes) {
			if (visited.has(n.id)) continue;
			const cluster: CanvasTextNode[] = [];
			const q = [n];
			visited.add(n.id);

			while (q.length > 0) {
				const cur = q.shift()!;
				cluster.push(cur);

				for (const other of nodes) {
					if (!visited.has(other.id)) {
						const dist = Math.hypot(cur.x - other.x, cur.y - other.y);
						if (dist <= CLUSTER_DISTANCE_THRESHOLD) {
							visited.add(other.id);
							q.push(other);
						}
					}
				}
			}
			clusters.push(cluster);
		}

		const color = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
		colorIndex++;

		for (const cluster of clusters) {
			const minX = Math.min(...cluster.map((n) => n.x)) - GROUP_PADDING;
			const minY = Math.min(...cluster.map((n) => n.y)) - GROUP_PADDING;
			const maxX = Math.max(...cluster.map((n) => n.x + n.width)) + GROUP_PADDING;
			const maxY = Math.max(...cluster.map((n) => n.y + n.height)) + GROUP_PADDING;

			const labelText = !folder || folder === '/' ? t('canvas.rootGroup') : folder;

			groupNodes.push({
				type: 'group',
				id: `group-${groupCounter++}`,
				x: minX,
				y: minY,
				width: maxX - minX,
				height: maxY - minY,
				label: labelText,
				color,
			});
		}
	}

	return {
		nodes: [...groupNodes, ...canvasData.nodes],
		edges: canvasData.edges,
	};
}
