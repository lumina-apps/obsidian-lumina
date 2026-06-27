<script lang="ts">
	import type { GraphNode } from '../graphDataBuilder';
	import { tStore } from '../../../shared/locales/index';

	let { node, x, y }: { node: GraphNode; x: number; y: number } = $props();

	// Avoid clipping out of window
	let tooltipWidth = 200;
	let adjustedX = $derived(x + 15 + tooltipWidth > window.innerWidth ? x - tooltipWidth - 15 : x + 15);
	let adjustedY = $derived(y + 15);

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
