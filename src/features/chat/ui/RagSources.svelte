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
			onclick={(e) => openFile(app, source.filePath, e)}
			onauxclick={(e) => openFile(app, source.filePath, e)}
		>
			📄 {source.filePath.split('/').pop()?.replace('.md', '') || source.filePath}
		</button>
	{/each}
</div>