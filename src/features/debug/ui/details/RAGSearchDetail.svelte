<script lang="ts">
	import type { RAGSearchLog } from '../../../../shared/types/debug.types';
	import { formatDuration } from '../../utils/formatUtils';
	import HighlightText from '../HighlightText.svelte';

	let {
		entry,
		highlightTokens = [],
	}: {
		entry: RAGSearchLog;
		highlightTokens?: readonly string[];
	} = $props();
</script>

<section class="lumina-debug__section">
	<div class="lumina-debug__section-title">Search Info</div>
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>query</td><td><HighlightText text={entry.query} tokens={highlightTokens} /></td></tr>
			<tr><td>top-K</td><td>{entry.topK}</td></tr>
			<tr><td>results</td><td>{entry.chunks.length}</td></tr>
			<tr><td>duration</td><td>{formatDuration(entry.durationMs)}</td></tr>
		</tbody>
	</table>
</section>

{#if entry.chunks.length > 0}
	<section class="lumina-debug__section">
		<div class="lumina-debug__section-title">Chunks</div>
		{#each entry.chunks as chunk, i}
			<div class="lumina-debug__rag-chunk">
				<div class="lumina-debug__rag-chunk-header">
					<span class="lumina-debug__rag-rank">#{i + 1}</span>
					<span class="lumina-debug__rag-score">score {chunk.score.toFixed(3)}</span>
					<span class="lumina-debug__rag-path"><HighlightText text={chunk.filePath} tokens={highlightTokens} /></span>
				</div>
				<pre class="lumina-debug__pre"><HighlightText text={chunk.fullContent} tokens={highlightTokens} /></pre>
			</div>
		{/each}
	</section>
{/if}