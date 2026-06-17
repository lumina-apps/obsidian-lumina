<script lang="ts">
	import type { RAGSearchLog } from '../../../../shared/types/debug.types';
	import { formatDuration } from '../../utils/formatUtils';

	let { entry }: { entry: RAGSearchLog } = $props();
</script>

<section class="lumina-debug__section">
	<div class="lumina-debug__section-title">Search Info</div>
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>query</td><td>{entry.query}</td></tr>
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
					<span class="lumina-debug__rag-path">{chunk.filePath}</span>
				</div>
				<pre class="lumina-debug__pre">{chunk.fullContent}</pre>
			</div>
		{/each}
	</section>
{/if}