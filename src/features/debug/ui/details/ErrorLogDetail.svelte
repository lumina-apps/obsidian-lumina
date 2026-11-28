<script lang="ts">
	import type { ErrorLog } from '../../../../shared/types/debug.types';
	import HighlightText from '../HighlightText.svelte';

	let {
		entry,
		highlightTokens = [],
	}: {
		entry: ErrorLog;
		highlightTokens?: readonly string[];
	} = $props();
</script>

<section class="lumina-debug__section">
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>domain</td><td><HighlightText text={entry.domain} tokens={highlightTokens} /></td></tr>
			<tr><td>message</td><td class="lumina-debug__error-text"><HighlightText text={entry.message} tokens={highlightTokens} /></td></tr>
		</tbody>
	</table>
	{#if entry.stack}
		<div class="lumina-debug__section-title" style="margin-top:8px">Stack Trace</div>
		<pre class="lumina-debug__pre lumina-debug__pre--error"><HighlightText text={entry.stack} tokens={highlightTokens} /></pre>
	{/if}
</section>