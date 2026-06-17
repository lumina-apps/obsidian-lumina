<script lang="ts">
	import type { LLMRequestLog } from '../../../../shared/types/debug.types';
	import { t } from '../../../../shared/locales/helpers';

	let { entry }: { entry: LLMRequestLog } = $props();
</script>

<!-- Model Config -->
<section class="lumina-debug__section">
	<div class="lumina-debug__section-title">Model Config</div>
	<table class="lumina-debug__table">
		<tbody>
			<tr><td>model</td><td>{entry.model}</td></tr>
			<tr><td>provider</td><td>{entry.provider}</td></tr>
			<tr><td>temperature</td><td>{entry.temperature}</td></tr>
			<tr><td>max_tokens</td><td>{entry.maxTokens}</td></tr>
			{#if entry.topP !== undefined}
				<tr><td>top_p</td><td>{entry.topP}</td></tr>
			{/if}
			<tr><td>stream</td><td>{entry.stream}</td></tr>
			{#if entry.estimatedInputTokens !== undefined}
				<tr><td>est. input tokens</td><td>{entry.estimatedInputTokens}</td></tr>
			{/if}
		</tbody>
	</table>
</section>

<!-- System Prompt -->
<section class="lumina-debug__section">
	<div class="lumina-debug__section-title">System Prompt</div>
	<pre class="lumina-debug__pre">{entry.systemPrompt}</pre>
</section>

<!-- Messages -->
<section class="lumina-debug__section">
	<div class="lumina-debug__section-title">
		Messages ({entry.messages.length})
	</div>
	{#each entry.messages as msg, i}
		<div class="lumina-debug__message-item">
			<span class="lumina-debug__message-role lumina-debug__message-role--{msg.role}">
				{msg.role}
			</span>
			<pre class="lumina-debug__pre">{msg.content}</pre>
		</div>
	{/each}
</section>

<!-- RAG Chunks -->
{#if entry.ragChunks && entry.ragChunks.length > 0}
	<section class="lumina-debug__section">
		<div class="lumina-debug__section-title">
			RAG Context ({entry.ragChunks.length} chunks injected)
		</div>
		{#each entry.ragChunks as chunk, i}
			<div class="lumina-debug__rag-chunk">
				<div class="lumina-debug__rag-chunk-header">
					<span class="lumina-debug__rag-score">score {chunk.score.toFixed(3)}</span>
					<span class="lumina-debug__rag-path">{chunk.filePath}</span>
				</div>
				<pre class="lumina-debug__pre">{chunk.fullContent}</pre>
			</div>
		{/each}
	</section>
{/if}