<script lang="ts">
	import DiscoveryCard from '../DiscoveryCard.svelte';
	import type { SearchResult } from '../../../../shared/types/rag.types';

	let {
		searchResults,
		searchQuery,
		isSearching,
		stagedItems,
		onOpenFile,
		onInsertLink,
		onOpenInSplit,
		onToggleStage,
	} = $props<{
		searchResults: SearchResult[];
		searchQuery: string;
		isSearching: boolean;
		stagedItems: SearchResult[];
		onOpenFile: (path: string, e?: MouseEvent) => void;
		onInsertLink: (path: string) => void;
		onOpenInSplit: (path: string) => void;
		onToggleStage: (result: SearchResult) => void;
	}>();
</script>

<div class="lumina-discovery__results-list" class:is-updating={isSearching}>
	{#each searchResults as result (result.chunk.id)}
		<DiscoveryCard
			{result}
			{searchQuery}
			isStaged={stagedItems.some((i: SearchResult) => i.chunk.id === result.chunk.id)}
			onOpen={onOpenFile}
			onInsertLink={onInsertLink}
			onOpenInSplit={onOpenInSplit}
			onToggleStage={onToggleStage}
		/>
	{/each}
</div>

<style>
	.is-updating {
		opacity: 0.5;
		transition: opacity 0.2s ease;
	}

	.lumina-discovery__results-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
</style>
