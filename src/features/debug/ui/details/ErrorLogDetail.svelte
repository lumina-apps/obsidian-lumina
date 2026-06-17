<script lang="ts">
	import type { ErrorLog } from '../../../../shared/types/debug.types';

	let { entry }: { entry: ErrorLog } = $props();
</script>

<section class="lumina-debug__section">
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>domain</td><td>{entry.domain}</td></tr>
			<tr><td>message</td><td class="lumina-debug__error-text">{entry.message}</td></tr>
		</tbody>
	</table>
	{#if entry.stack}
		<div class="lumina-debug__section-title" style="margin-top:8px">Stack Trace</div>
		<pre class="lumina-debug__pre lumina-debug__pre--error">{entry.stack}</pre>
	{/if}
</section>