<script lang="ts">
	import { splitHighlightSegments } from '../utils/searchUtils';

	let {
		text,
		tokens = [],
	}: {
		text: string;
		tokens?: readonly string[];
	} = $props();

	const segments = $derived(
		tokens.length > 0 ? splitHighlightSegments(text, tokens) : null,
	);
</script>

{#if segments === null}
	{text}
{:else}
	{#each segments as seg}
		{#if seg.matched}
			<mark class="lumina-debug__highlight">{seg.text}</mark>
		{:else}
			{seg.text}
		{/if}
	{/each}
{/if}

<style>
	.lumina-debug__highlight {
		background: var(--text-highlight-bg, rgba(250, 204, 21, 0.35));
		color: inherit;
		border-radius: 2px;
		padding: 0 1px;
	}
</style>
