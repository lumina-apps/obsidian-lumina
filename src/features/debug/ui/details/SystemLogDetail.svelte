<script lang="ts">
	import type { SystemLog } from '../../../../shared/types/debug.types';
	import { safeJsonStringify } from '../../utils/searchUtils';
	import HighlightText from '../HighlightText.svelte';

	let {
		entry,
		highlightTokens = [],
	}: {
		entry: SystemLog;
		highlightTokens?: readonly string[];
	} = $props();

	const metaText = $derived(entry.meta ? safeJsonStringify(entry.meta, 2) : '');
</script>

<section class="lumina-debug__section">
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>event</td><td><HighlightText text={entry.event} tokens={highlightTokens} /></td></tr>
			<tr><td>message</td><td><HighlightText text={entry.message} tokens={highlightTokens} /></td></tr>
		</tbody>
	</table>
	{#if entry.meta}
		<div class="lumina-debug__section-title" style="margin-top:8px">Meta</div>
		<pre class="lumina-debug__pre"><HighlightText text={metaText} tokens={highlightTokens} /></pre>
	{/if}
</section>