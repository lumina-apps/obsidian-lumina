<script lang="ts">
	import type { GraphNode } from '../../../shared/types/graph.types';
	import { tStore } from '../../../shared/locales/index';

	let { node, x, y }: { node: GraphNode; x: number; y: number } = $props();

	// 뷰포트 좌우·상하 경계 밖으로 툴팁이 잘리지 않도록 좌표 클램핑
	let tooltipWidth = 200;
	let rawX = $derived(x + 15 + tooltipWidth > window.innerWidth ? x - tooltipWidth - 15 : x + 15);
	let adjustedX = $derived(Math.max(8, Math.min(rawX, window.innerWidth - tooltipWidth - 8)));
	let adjustedY = $derived(Math.max(8, Math.min(y + 15, window.innerHeight - 96)));

</script>

<div 
	class="lumina-graph-tooltip"
	style="left: {adjustedX}px; top: {adjustedY}px;"
>
	<div class="lumina-graph-tooltip__title">{node.name}</div>
	<div class="lumina-graph-tooltip__meta">
		<div>{$tStore('graph.folder')} {node.group}</div>
		<div>{$tStore('graph.connections')} {node.degree}</div>
	</div>
</div>

<style>
	.lumina-graph-tooltip {
		position: fixed;
		pointer-events: none;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		border-radius: 6px;
		padding: 8px 12px;
		z-index: 100;
		width: 200px;
		font-family: var(--font-interface);
	}

	.lumina-graph-tooltip__title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
		margin-bottom: 4px;
		word-break: break-all;
	}

	.lumina-graph-tooltip__meta {
		font-size: 11px;
		color: var(--text-muted);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
</style>
