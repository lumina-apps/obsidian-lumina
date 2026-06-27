<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import ForceGraph from 'force-graph';
	import type { GraphData, GraphNode } from '../graphDataBuilder';
	import { graphState, updateGraphState } from '../graphStore';
	import GraphTooltip from './GraphTooltip.svelte';

	let { graphData, onNodeClick }: { graphData: GraphData; onNodeClick: (nodeId: string) => void } = $props();

	type ForceNode = GraphNode & { x: number; y: number; vx?: number; vy?: number; index?: number };
	type ForceLink = GraphEdge & { source: ForceNode | string; target: ForceNode | string };

	let container: HTMLElement;
	let graph: ReturnType<typeof ForceGraph>;
	let resizeObserver: ResizeObserver;

	let hoveredNode = $state<GraphNode | null>(null);
	let hoveredPos = $state<{x: number, y: number} | null>(null);

	// Color Palette mapping for folders
	const FOLDER_COLORS = [
		'#8b5cf6', // violet
		'#3b82f6', // blue
		'#10b981', // emerald
		'#f59e0b', // amber
		'#ef4444', // red
		'#ec4899', // pink
		'#14b8a6', // teal
		'#f97316', // orange
	];
	const colorMap = new Map<string, string>();

	function getGroupColor(group: string): string {
		if (group === '__root__') return '#9ca3af'; // gray for root
		if (!colorMap.has(group)) {
			colorMap.set(group, FOLDER_COLORS[colorMap.size % FOLDER_COLORS.length]);
		}
		return colorMap.get(group)!;
	}

	let highlightSet = new Set<string>();
	let neighborSet = new Set<string>();
	let searchQueryLower = '';

	function isHighlighted(node: GraphNode) {
		if (!searchQueryLower) return false;
		return highlightSet.has(node.id);
	}

	function isDimmed(node: GraphNode) {
		if (searchQueryLower) {
			return !highlightSet.has(node.id);
		}
		if ($graphState.focusedPath) {
			return !neighborSet.has(node.id);
		}
		return false;
	}

	onMount(() => {
		graph = ForceGraph()(container)
			.backgroundColor('rgba(0,0,0,0)') // Transparent background for theme support
			.nodeId('id')
			.nodeLabel(() => '') // handled by custom tooltip
			.nodeVal(node => Math.max(2, (node as GraphNode).degree * 1.5))
			.nodeColor(node => getGroupColor((node as GraphNode).group))
			.linkWidth(link => Math.max(0.1, Math.pow((link as ForceLink).weight, 2) * 0.6))
			.linkColor(link => {
				const w = (link as ForceLink).weight;
				return `rgba(139, 92, 246, ${w * 0.3 + 0.05})`; // Very faint purple
			})
			.onNodeHover((node, prevNode) => {
				if (node) {
					hoveredNode = node as GraphNode;
					// Get screen coordinates of node
					const pos = graph.graph2ScreenCoords((node as ForceNode).x, (node as ForceNode).y);
					hoveredPos = pos;
					updateGraphState({ focusedPath: (node as GraphNode).id });
					container.style.cursor = 'pointer';
				} else {
					hoveredNode = null;
					hoveredPos = null;
					updateGraphState({ focusedPath: null });
					container.style.cursor = 'grab';
				}
			})
			.onNodeClick(node => {
				onNodeClick((node as GraphNode).id);
			})
			.cooldownTicks(100);

		// Custom Canvas drawing for focus/highlight effects
		graph.nodeCanvasObject((node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const label = node.name;
			// 줌인/아웃에 비례하되, 너무 작아지거나 커지지 않게 조정
			const fontSize = Math.max(4, 10 / globalScale);
			
			// 기존 * 4 배율을 없애고, 기본 크기를 작게(최소 2, 최대 10 내외) 설정
			const radius = Math.sqrt(Math.max(1, node.degree)) * 1.2 + 1.5;
			
			const dimmed = isDimmed(node);
			const highlight = isHighlighted(node);
			
			ctx.beginPath();
			ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
			
			const color = getGroupColor(node.group);
			ctx.fillStyle = dimmed ? `${color}40` : color; // 40 = ~25% opacity
			ctx.fill();

			// Highlight ring
			if (highlight) {
				ctx.lineWidth = 1.5 / globalScale;
				ctx.strokeStyle = '#f59e0b'; // amber
				ctx.stroke();
			} else if (node.id === $graphState.focusedPath) {
				ctx.lineWidth = 1.5 / globalScale;
				ctx.strokeStyle = '#8b5cf6'; // violet
				ctx.stroke();
			}

			// Draw label if highly zoomed in, or if it's highlighted/focused
			if (globalScale > 2 || highlight || node.id === $graphState.focusedPath) {
				const isLight = document.body.classList.contains('theme-light');
				ctx.font = `${fontSize}px Sans-Serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillStyle = dimmed 
					? (isLight ? 'rgba(0, 0, 0, 0.3)' : 'rgba(150,150,150,0.3)') 
					: (isLight ? 'rgba(0, 0, 0, 0.8)' : 'rgba(200,200,200,0.8)');
				ctx.fillText(label, node.x, node.y + radius + fontSize / 2 + 2 / globalScale);
			}
		});

		resizeObserver = new ResizeObserver(() => {
			if (container) {
				graph.width(container.clientWidth);
				graph.height(container.clientHeight);
			}
		});
		resizeObserver.observe(container);
		
		// Set initial cursor
		container.style.cursor = 'grab';
		container.addEventListener('mousedown', () => container.style.cursor = 'grabbing');
		container.addEventListener('mouseup', () => container.style.cursor = 'grab');
	});

	onDestroy(() => {
		if (resizeObserver) resizeObserver.disconnect();
		if (graph) {
			graph._destructor?.();
		}
	});

	// React to data changes
	$effect(() => {
		if (graph && graphData) {
			graph.graphData(graphData);
			
			// 데이터가 로드된 후 물리 엔진을 확실하게 재설정
			if (graph.d3Force('charge')) {
				// 반발력(strength)을 강하게 주어 뭉침을 해소하되, 
				// 거리가 먼 덩어리(cluster)끼리는 밀어내지 않도록(distanceMax) 제한하여 빈 공간 낭비를 없앰
				graph.d3Force('charge').strength(-400).distanceMax(250);
			}
			if (graph.d3Force('link')) {
				// 노드 간 연결선 거리를 띄워서 숨통을 틔움
				graph.d3Force('link').distance(80);
			}
			// 빈 공간 없이 화면 중앙으로 부드럽게 당겨주는 중력(center force) 강화
			if (graph.d3Force('center')) {
				graph.d3Force('center').strength(0.1); // 중심 당김 힘 명시적 강화
			}
			// 변경된 물리 설정 적용을 위해 시뮬레이션 재가열
			graph.d3ReheatSimulation();
		}
	});

	// React to focus/highlight changes (trigger re-render)
	$effect(() => {
		const f = $graphState.focusedPath;
		const s = $graphState.searchQuery;
		if (graph && graphData) {
			searchQueryLower = s ? s.toLowerCase() : '';

			highlightSet.clear();
			if (searchQueryLower) {
				for (const node of graphData.nodes) {
					if (node.name.toLowerCase().includes(searchQueryLower) || node.group.toLowerCase().includes(searchQueryLower)) {
						highlightSet.add(node.id);
					}
				}
			}

			neighborSet.clear();
			if (f && graphData.links) {
				for (const link of graphData.links) {
					const sNode = typeof link.source === 'object' ? (link.source as ForceNode).id : link.source;
					const tNode = typeof link.target === 'object' ? (link.target as ForceNode).id : link.target;
					if (sNode === f) neighborSet.add(tNode);
					if (tNode === f) neighborSet.add(sNode);
				}
				neighborSet.add(f);
			}

			// update opacity of links using linkColor callback
			graph.linkColor((link: ForceLink) => {
				const w = link.weight;
				let opacity = w * 0.3 + 0.05;
				if (s) {
					const sNode = typeof link.source === 'object' ? (link.source as ForceNode).id : link.source;
					const tNode = typeof link.target === 'object' ? (link.target as ForceNode).id : link.target;
					const sH = highlightSet.has(sNode);
					const tH = highlightSet.has(tNode);
					opacity = (sH || tH) ? Math.min(0.8, opacity + 0.5) : 0.02;
				} else if (f) {
					const isConnected = (link.source.id || link.source) === f || (link.target.id || link.target) === f;
					opacity = isConnected ? Math.min(0.8, opacity + 0.5) : 0.02;
				}
				return `rgba(139, 92, 246, ${opacity})`;
			});
			
			// Force redraw of nodes by dirtying an accessor
			graph.nodeColor(graph.nodeColor());
		}
	});

</script>

<div class="lumina-graph-canvas" bind:this={container}></div>

{#if hoveredNode && hoveredPos}
	<GraphTooltip node={hoveredNode} x={hoveredPos.x} y={hoveredPos.y} />
{/if}

<style>
	.lumina-graph-canvas {
		width: 100%;
		height: 100%;
		overflow: hidden;
	}
</style>
