<script lang="ts">
	import { setIcon } from 'obsidian';
	import type { MCPLog } from '../../../../shared/types/debug.types';
	import { copyToClipboard } from '../../../../shared/utils/clipboardUtils';

	let { entry }: { entry: MCPLog } = $props();

	function handleCopy(evt: MouseEvent) {
		evt.stopPropagation();
		const text =
			typeof entry.data === 'string'
				? entry.data
				: JSON.stringify(entry.data, null, 2);
		void copyToClipboard(text);
	}

	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
		return {
			update(newId: string) {
				node.empty();
				setIcon(node, newId);
			},
		};
	}
</script>

<section class="lumina-debug__section">
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>action</td><td>{entry.action}</td></tr>
			<tr><td>message</td><td>{entry.message}</td></tr>
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
		<pre class="lumina-debug__pre">
			{typeof entry.data === 'string'
				? entry.data
				: JSON.stringify(entry.data, null, 2)}
		</pre>
	{/if}
</section>