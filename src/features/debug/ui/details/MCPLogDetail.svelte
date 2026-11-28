<script lang="ts">
	import { icon } from '../../../../shared/utils/iconAction';
	import type { MCPLog } from '../../../../shared/types/debug.types';
	import { copyToClipboard } from '../../../../shared/utils/clipboardUtils';
	import { safeJsonStringify } from '../../utils/searchUtils';
	import HighlightText from '../HighlightText.svelte';

	let {
		entry,
		highlightTokens = [],
	}: {
		entry: MCPLog;
		highlightTokens?: readonly string[];
	} = $props();

	const dataText = $derived(
		entry.data !== undefined
			? typeof entry.data === 'string'
				? entry.data
				: safeJsonStringify(entry.data, 2)
			: '',
	);

	function handleCopy(evt: MouseEvent) {
		evt.stopPropagation();
		void copyToClipboard(dataText);
	}

</script>

<section class="lumina-debug__section">
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>action</td><td><HighlightText text={entry.action} tokens={highlightTokens} /></td></tr>
			<tr><td>message</td><td><HighlightText text={entry.message} tokens={highlightTokens} /></td></tr>
		</tbody>
	</table>
	{#if entry.data !== undefined}
		<div class="lumina-debug__section-header">
			<div class="lumina-debug__section-title" style="margin-top:0">Data</div>
			<button
				class="lumina-debug__copy-btn"
				onclick={handleCopy}
				aria-label="Copy JSON"
				title="Copy JSON"
				type="button"
			>
				<span use:icon={'copy'}></span>
			</button>
		</div>
		<pre class="lumina-debug__pre"><HighlightText text={dataText} tokens={highlightTokens} /></pre>
	{/if}
</section>