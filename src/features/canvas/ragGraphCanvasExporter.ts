/**
 * ragGraphCanvasExporter.ts
 *
 * RAG 그래프 데이터(GraphData)를 Obsidian Canvas(.canvas) 형식으로 변환합니다.
 * - 노드: CanvasFileNode (vault 상대 경로 기반 실제 파일 노드)
 * - 엣지: 유사도 레이블 + 색상, 방향 없음(양방향)
 * - 레이아웃: 간소화된 force-directed 알고리즘
 */

import type { CanvasData, CanvasFileNode, CanvasEdge } from './canvasTypes';
import type { GraphData, GraphNode, GraphEdge } from '../graph/graphDataBuilder';
import { getEdgeSides } from './canvasBuilder';

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const BASE_NODE_WIDTH = 160; // 기존 240에서 축소 (공간 확보)
const BASE_NODE_HEIGHT = 40; // 기존 60에서 축소

/**
 * degree 기반 노드 크기 스케일.
 * 최대 1.4배 상한을 두어 과도하게 커지지 않도록 합니다.
 */
const MAX_SCALE = 1.4;
const DEGREE_SCALE_FACTOR = 0.05; // degree당 5% 성장

// ─── 옵션 ─────────────────────────────────────────────────────────────────────

export interface RagGraphCanvasOptions {
  /** 엣지에 유사도 점수를 레이블로 표기할지 여부 (기본: true) */
  showSimilarityLabel: boolean;
  /** 폴더별 그룹 노드 생성 여부 (기본: false) */
  showGroups: boolean;
}

// ─── 노드 크기 계산 ───────────────────────────────────────────────────────────

function getNodeSize(degree: number): { width: number; height: number } {
  const scale = Math.min(MAX_SCALE, 1 + degree * DEGREE_SCALE_FACTOR);
  return {
    width: Math.round(BASE_NODE_WIDTH * scale),
    height: Math.round(BASE_NODE_HEIGHT * scale),
  };
}

// ─── 엣지 색상 매핑 ───────────────────────────────────────────────────────────

/**
 * 유사도 점수를 Obsidian Canvas 색상 번호 및 커스텀 Hex 색상으로 매핑합니다.
 * 백분위수 기반 임계값을 사용하여 임베딩 모델에 상관없이 최적의 가독성을 보장합니다.
 */
function getSimilarityColor(weight: number, threshold95: number, threshold80: number): string | undefined {
  if (weight >= threshold95) return '4'; // 상위 5%: 녹색 강조
  if (weight >= threshold80) return '#88888866'; // 상위 20%: 반투명 회색
  return '#8888881a'; // 나머지: 매우 투명한 회색
}

// ─── Force-directed 레이아웃 ──────────────────────────────────────────────────

interface NodePos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * 간소화된 force-directed 알고리즘으로 노드 2D 좌표를 계산합니다.
 */
function computeForceLayout(
  nodes: GraphNode[],
  links: GraphEdge[],
): Map<string, { x: number; y: number }> {
  const n = nodes.length;
  if (n === 0) return new Map();

  // 노드 개수 기반 동적 물리 엔진 스케일링
  const scaleFactor = Math.log10(Math.max(10, n)); // 10개=1, 100개=2, 1000개=3
  
  const REPULSION = 300000; // 뭉침을 풀기 위한 강력한 척력
  const ATTRACTION = 0.04;  // 너무 퍼지지 않게 잡아주는 인력
  const CENTER_FORCE = 0.02; // 중앙 텅 빔 현상을 방지하는 구심력
  const DAMPING = 0.65; // 마찰력 (빠른 안정화)
  const ITERATIONS = Math.max(150, Math.floor(100 * scaleFactor));

  // 빅뱅(Big Bang) 초기 배치: 모두 중앙에 모아두고 반발력으로 자연스럽게 팽창시킵니다.
  // 이렇게 하면 링 모양으로 겉돌며 중앙이 텅 비는 현상이 원천적으로 해결됩니다.
  const positions = new Map<string, NodePos>();
  nodes.forEach((node) => {
    positions.set(node.id, {
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      vx: 0,
      vy: 0,
    });
  });

  // adjacency map
  const adjacency = new Map<string, { target: string; weight: number }[]>();
  for (const link of links) {
    const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
    const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
    
    if (!adjacency.has(sourceId)) adjacency.set(sourceId, []);
    if (!adjacency.has(targetId)) adjacency.set(targetId, []);
    adjacency.get(sourceId)!.push({ target: targetId, weight: link.weight });
    adjacency.get(targetId)!.push({ target: sourceId, weight: link.weight });
  }

  const nodeIds = nodes.map(nd => nd.id);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const alpha = 1 - iter / ITERATIONS;

    // 척력
    for (let i = 0; i < nodeIds.length; i++) {
      const a = positions.get(nodeIds[i])!;
      for (let j = i + 1; j < nodeIds.length; j++) {
        const b = positions.get(nodeIds[j])!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 1;
        const force = (REPULSION * alpha) / dist2;
        const dist = Math.sqrt(dist2);
        a.vx -= (force * dx) / dist;
        a.vy -= (force * dy) / dist;
        b.vx += (force * dx) / dist;
        b.vy += (force * dy) / dist;
      }
    }

    // 인력 (엣지)
    for (const [sourceId, neighbors] of adjacency) {
      const a = positions.get(sourceId);
      if (!a) continue;
      for (const { target, weight } of neighbors) {
        const b = positions.get(target);
        if (!b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const idealDist = 450; // 노드 간 최소 450px 이격 보장
        const force = ATTRACTION * (dist - idealDist) * alpha * weight;
        a.vx += (force * dx) / dist;
        a.vy += (force * dy) / dist;
      }
    }

    // 중심력 + 위치 업데이트
    const MAX_VELOCITY = 300; // 물리 폭발(Physics Explosion) 방지용 속도 제한
    
    for (const pos of positions.values()) {
      pos.vx += -pos.x * CENTER_FORCE * alpha;
      pos.vy += -pos.y * CENTER_FORCE * alpha;
      pos.vx *= DAMPING;
      pos.vy *= DAMPING;
      
      // 속도 클램핑 (노드가 무한대로 튕겨나가는 현상 방지)
      const speed = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy);
      if (speed > MAX_VELOCITY) {
        pos.vx = (pos.vx / speed) * MAX_VELOCITY;
        pos.vy = (pos.vy / speed) * MAX_VELOCITY;
      }
      
      pos.x += pos.vx;
      pos.y += pos.vy;
      
      // 혹시 모를 연산 오류 방어
      if (!Number.isFinite(pos.x)) pos.x = 0;
      if (!Number.isFinite(pos.y)) pos.y = 0;
    }
  }

  const result = new Map<string, { x: number; y: number }>();
  for (const [id, pos] of positions) {
    result.set(id, { 
      x: Number.isFinite(pos.x) ? Math.round(pos.x) : 0, 
      y: Number.isFinite(pos.y) ? Math.round(pos.y) : 0 
    });
  }
  return result;
}

// ─── 유니온 파인드 (MST 구성용) ────────────────────────────────────────────────

class UnionFind {
  parent: Map<string, string>;
  constructor(nodes: string[]) {
    this.parent = new Map();
    nodes.forEach(n => this.parent.set(n, n));
  }
  find(i: string): string {
    if (this.parent.get(i) === i) return i;
    const root = this.find(this.parent.get(i)!);
    this.parent.set(i, root);
    return root;
  }
  union(i: string, j: string): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      this.parent.set(rootI, rootJ);
    }
  }
}

// ─── Canvas 데이터 빌드 ───────────────────────────────────────────────────────

/**
 * GraphData를 Obsidian Canvas 형식으로 변환합니다.
 */
export function buildRagGraphCanvasData(
  graphData: GraphData,
  opts: RagGraphCanvasOptions,
): CanvasData {
  let { nodes, links } = graphData;

  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // 1. 임베딩 모델 파편화 대응: 백분위수 임계값 계산
  const sortedWeights = links.map(l => l.weight).sort((a, b) => b - a);
  const threshold95 = sortedWeights[Math.floor(sortedWeights.length * 0.05)] ?? 1;
  const threshold80 = sortedWeights[Math.floor(sortedWeights.length * 0.20)] ?? 1;

  // 2. 가독성을 위한 엣지 프루닝(Pruning) - MST 기반
  const prunedLinksSet = new Set<GraphEdge>();
  
  // 2-1. Maximum Spanning Tree (MST) 구성하여 연결성 보장
  const uf = new UnionFind(nodes.map(n => n.id));
  const sortedLinks = [...links].sort((a, b) => b.weight - a.weight);
  
  for (const link of sortedLinks) {
    const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
    const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
    if (uf.find(srcId) !== uf.find(tgtId)) {
      uf.union(srcId, tgtId);
      prunedLinksSet.add(link);
    }
  }

  // 2-2. 뼈대만 있으면 밋밋하므로 노드당 가장 강한 엣지 최대 1개 추가 (Cycle 허용)
  const MAX_EXTRA_LINKS = 1;
  nodes.forEach(node => {
    const connected = sortedLinks.filter(l => {
      const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;
      return srcId === node.id || tgtId === node.id;
    });
    
    let addedCount = 0;
    for (const link of connected) {
      if (addedCount >= MAX_EXTRA_LINKS) break;
      if (!prunedLinksSet.has(link)) {
        prunedLinksSet.add(link);
        addedCount++;
      }
    }
  });

  const prunedLinks = Array.from(prunedLinksSet);

  // 3. Force-directed 레이아웃 (정제된 핵심 엣지만을 기반으로 배치 계산)
  const positions = computeForceLayout(nodes, prunedLinks);

  // 2. 노드 빌드 (CanvasTextNode)
  const idMap = new Map<string, string>();
  const canvasNodes: any[] = []; // type it dynamically
  const maxDegree = Math.max(1, ...nodes.map(nd => nd.degree));

  nodes.forEach((node, index) => {
    const canvasId = `rag-node-${index.toString().padStart(4, '0')}`;
    idMap.set(node.id, canvasId);

    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    // degree를 maxDegree로 정규화하여 스케일 편차를 줄임
    const normalizedDegree = maxDegree > 1 ? (node.degree / maxDegree) * 10 : node.degree;
    const { width, height } = getNodeSize(normalizedDegree);

    const baseName = node.id.split('/').pop()?.replace(/\.md$/, '') ?? node.id;

    canvasNodes.push({
      type: 'text',
      id: canvasId,
      text: `[[${node.id}|${baseName}]]`,
      x: pos.x - Math.round(width / 2),
      y: pos.y - Math.round(height / 2),
      width,
      height,
    });
  });

  // 3. 엣지 빌드 — 방향 없는 유사도 연결
  const canvasEdges: CanvasEdge[] = [];
  const processedEdges = new Set<string>();

  for (const link of prunedLinks) {
    const sourcePath = typeof link.source === 'object' ? (link.source as any).id : link.source;
    const targetPath = typeof link.target === 'object' ? (link.target as any).id : link.target;

    const fromId = idMap.get(sourcePath);
    const toId = idMap.get(targetPath);
    if (!fromId || !toId) continue;

    const edgeKey = fromId < toId ? `${fromId}|${toId}` : `${toId}|${fromId}`;
    if (processedEdges.has(edgeKey)) continue;
    processedEdges.add(edgeKey);

    const fromPos = positions.get(sourcePath) ?? { x: 0, y: 0 };
    const toPos = positions.get(targetPath) ?? { x: 0, y: 0 };
    const sides = getEdgeSides(fromPos, toPos);

    const edge: CanvasEdge = {
      id: `rag-edge-${fromId}-${toId}`,
      fromNode: fromId,
      fromSide: sides.fromSide,
      fromEnd: 'none',
      toNode: toId,
      toSide: sides.toSide,
      toEnd: 'none',
      color: getSimilarityColor(link.weight, threshold95, threshold80),
    };

    if (opts.showSimilarityLabel) {
      edge.label = link.weight.toFixed(2);
    }

    canvasEdges.push(edge);
  }

  return { nodes: canvasNodes, edges: canvasEdges };
}
