import { describe, it, expect } from 'vitest';
import { buildRagGraphCanvasData } from './ragGraphCanvasExporter';
import type { GraphData, GraphNode, GraphEdge } from '../../shared/types/graph.types';
import type { CanvasTextNode, CanvasGroupNode } from './canvasTypes';

describe('ragGraphCanvasExporter', () => {
	const createSampleGraphData = (): GraphData => {
		const nodes: GraphNode[] = [
			{ id: 'notes/a.md', name: 'a', degree: 3, group: 'notes' },
			{ id: 'notes/b.md', name: 'b', degree: 2, group: 'notes' },
			{ id: 'projects/c.md', name: 'c', degree: 1, group: 'projects' },
		];

		const links: GraphEdge[] = [
			{ source: 'notes/a.md', target: 'notes/b.md', weight: 0.95 },
			{ source: 'notes/b.md', target: 'projects/c.md', weight: 0.82 },
			{ source: 'projects/c.md', target: 'notes/a.md', weight: 0.65 },
		];

		return { nodes, links };
	};

	it('should build canvas data with nodes and edges', () => {
		const graphData = createSampleGraphData();
		const result = buildRagGraphCanvasData(graphData, {
			showSimilarityLabel: true,
			showGroups: false,
		});

		expect(result.nodes.length).toBe(3);
		expect(result.edges.length).toBeGreaterThan(0);

		// 노드 형식 검증
		const firstNode = result.nodes[0];
		expect(firstNode.type).toBe('text');
		expect((firstNode as CanvasTextNode).text).toMatch(/^\[\[.*\|.*\]\]$/);

		// 엣지 레이블 검증
		const firstEdge = result.edges[0];
		expect(firstEdge.label).toBeDefined();
	});

	it('should create group nodes when showGroups is true', () => {
		const graphData = createSampleGraphData();
		const result = buildRagGraphCanvasData(graphData, {
			showSimilarityLabel: true,
			showGroups: true,
		});

		const groupNodes = result.nodes.filter((n): n is CanvasGroupNode => n.type === 'group');
		expect(groupNodes.length).toBe(2); // 'notes', 'projects'

		const labels = groupNodes.map((g) => g.label);
		expect(labels).toContain('notes');
		expect(labels).toContain('projects');
	});

	it('should not throw TypeError even when links contain string endpoints (closure bug regression test)', () => {
		const nodes: GraphNode[] = [
			{ id: 'node1.md', name: 'node1', degree: 2, group: 'g' },
			{ id: 'node2.md', name: 'node2', degree: 2, group: 'g' },
			{ id: 'node3.md', name: 'node3', degree: 2, group: 'g' },
		];

		// 문자열 ID로 링크 구성 (force-graph 초기화 전 상태)
		const links: GraphEdge[] = [
			{ source: 'node1.md', target: 'node2.md', weight: 0.9 },
			{ source: 'node2.md', target: 'node3.md', weight: 0.8 },
			{ source: 'node3.md', target: 'node1.md', weight: 0.7 },
		];

		expect(() => {
			const result = buildRagGraphCanvasData({ nodes, links }, {
				showSimilarityLabel: true,
				showGroups: false,
			});
			expect(result.nodes.length).toBe(3);
		}).not.toThrow();
	});

	it('should handle missing nodes in links gracefully without call stack overflow', () => {
		const nodes: GraphNode[] = [
			{ id: 'node1.md', name: 'node1', degree: 1, group: 'g' },
			{ id: 'node2.md', name: 'node2', degree: 1, group: 'g' },
		];

		// nodes에 없는 unknown 노드가 links에 포함된 경우
		const links: GraphEdge[] = [
			{ source: 'node1.md', target: 'unknown-node.md', weight: 0.9 },
			{ source: 'node1.md', target: 'node2.md', weight: 0.8 },
		];

		expect(() => {
			const result = buildRagGraphCanvasData({ nodes, links }, {
				showSimilarityLabel: false,
				showGroups: false,
			});
			expect(result.nodes.length).toBe(2);
		}).not.toThrow();
	});

	it('should comply with JSON Canvas color specifications (6-digit hex or preset)', () => {
		const graphData = createSampleGraphData();
		const result = buildRagGraphCanvasData(graphData, {
			showSimilarityLabel: true,
			showGroups: false,
		});

		for (const edge of result.edges) {
			if (edge.color) {
				// Canvas preset (1-6) 또는 6자리 Hex (#RRGGBB)
				const isPreset = ['1', '2', '3', '4', '5', '6'].includes(edge.color);
				const is6DigitHex = /^#[0-9a-fA-F]{6}$/.test(edge.color);
				expect(isPreset || is6DigitHex).toBe(true);
				// 8자리 Hex가 아니어야 함
				expect(edge.color.length).not.toBe(9);
			}
		}
	});

	it('should ignore self-loop edges where source equals target', () => {
		const nodes: GraphNode[] = [
			{ id: 'node1.md', name: 'node1', degree: 1, group: 'g' },
		];

		const links: GraphEdge[] = [
			{ source: 'node1.md', target: 'node1.md', weight: 0.99 },
		];

		const result = buildRagGraphCanvasData({ nodes, links }, {
			showSimilarityLabel: false,
			showGroups: false,
		});

		expect(result.edges.length).toBe(0);
	});
});

