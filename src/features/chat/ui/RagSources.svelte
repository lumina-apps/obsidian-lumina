<script lang="ts">
	import type { App } from "obsidian";
	import type { ChatRagSource } from "../../../shared/types/chat.types";
	import { t } from "../../../shared/locales/helpers";
	import { openFile } from "./utils/messageActions";

	let {
		sources,
		app,
	}: {
		sources: ChatRagSource[];
		app: App;
	} = $props();
</script>

<div class="lumina-message__rag-sources">
	{#each sources as source}
		<button
			class="lumina-message__rag-source"
			aria-label={t("uiMessages.openReferenceNote")}
			onclick={(e) => openFile(app, source.filePath, e, source.chunkText)}
			onauxclick={(e) => openFile(app, source.filePath, e, source.chunkText)}
		>
			📄 {source.filePath.split('/').pop()?.replace('.md', '') || source.filePath}
		</button>
	{/each}
</div>

<style>
	.lumina-message__rag-sources {
		display: flex;
		gap: 8px;
		margin-top: 10px;
		flex-wrap: wrap;
	}

	.lumina-message__rag-source {
		font-size: 9.5px;
		padding: 3px 8px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-message__rag-source:hover {
		background: var(--background-modifier-hover);
		color: var(--interactive-accent);
		border-color: rgba(139, 92, 246, 0.3);
	}
</style>
