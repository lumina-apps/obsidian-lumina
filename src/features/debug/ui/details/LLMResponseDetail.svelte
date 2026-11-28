<script lang="ts">
	import type { LLMResponseLog } from '../../../../shared/types/debug.types';
	import { formatDuration } from '../../utils/formatUtils';
	import HighlightText from '../HighlightText.svelte';

	let {
		entry,
		highlightTokens = [],
	}: {
		entry: LLMResponseLog;
		highlightTokens?: readonly string[];
	} = $props();
</script>

<!-- Stats -->
<section class="lumina-debug__section">
	<div class="lumina-debug__section-title">Stats</div>
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>duration</td><td>{formatDuration(entry.durationMs)}</td></tr>
			{#if entry.usage}
				<tr><td>input tokens</td><td>{entry.usage.inputTokens}</td></tr>
				{#if entry.usage.cacheReadTokens}
					<tr><td>cache read tokens</td><td>{entry.usage.cacheReadTokens}{entry.usage.inputTokens > 0 ? ` (${Math.min(100, Math.round((entry.usage.cacheReadTokens / entry.usage.inputTokens) * 100))}%)` : ''}</td></tr>
				{/if}
				{#if entry.usage.cacheCreationTokens}
					<tr><td>cache creation tokens</td><td>{entry.usage.cacheCreationTokens}</td></tr>
				{/if}
				<tr><td>output tokens</td><td>{entry.usage.outputTokens}</td></tr>
				<tr><td>total tokens</td><td>{entry.usage.totalTokens}</td></tr>
			{/if}
			{#if entry.stopReason}
				<tr><td>stop_reason</td><td><HighlightText text={entry.stopReason} tokens={highlightTokens} /></td></tr>
			{/if}
			<tr><td>request_id</td><td class="lumina-debug__mono"><HighlightText text={entry.requestId} tokens={highlightTokens} /></td></tr>
		</tbody>
	</table>
</section>

<!-- Response Content -->
<section class="lumina-debug__section">
	<div class="lumina-debug__section-title">Response</div>
	<pre class="lumina-debug__pre"><HighlightText text={entry.content} tokens={highlightTokens} /></pre>
</section>