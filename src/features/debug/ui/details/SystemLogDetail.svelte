<script lang="ts">
	import type { SystemLog } from '../../../../shared/types/debug.types';

	let { entry }: { entry: SystemLog } = $props();
</script>

<section class="lumina-debug__section">
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>event</td><td>{entry.event}</td></tr>
			<tr><td>message</td><td>{entry.message}</td></tr>
		</tbody>
	</table>
	{#if entry.meta}
		<div class="lumina-debug__section-title" style="margin-top:8px">Meta</div>
		<pre class="lumina-debug__pre">{JSON.stringify(entry.meta, null, 2)}</pre>
	{/if}
</section>