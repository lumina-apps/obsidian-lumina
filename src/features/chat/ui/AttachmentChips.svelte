<script lang="ts">
	import { TFile, type App } from "obsidian";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import { getAttachmentIcon, IMAGE_EXTS } from "../utils/fileAttachmentUtils";
	import { icon } from "../../../shared/utils/iconAction";
	import { openAttachment } from "./utils/messageActions";

	let {
		attachments,
		app,
	}: {
		attachments: ContextAttachment[];
		app: App;
	} = $props();

	function handleClick(att: ContextAttachment, e: MouseEvent | KeyboardEvent) {
		openAttachment(app, att, e);
	}

	function getImageSrc(att: ContextAttachment): string | null {
		if (att.content?.startsWith("data:image/")) {
			return att.content;
		}
		const pathOrName = att.path || att.name;
		if (pathOrName) {
			const ext = pathOrName.split(".").pop()?.toLowerCase() ?? "";
			if (IMAGE_EXTS.has(ext)) {
				let file = app.vault.getAbstractFileByPath(pathOrName);
				if (!file) {
					file = app.metadataCache.getFirstLinkpathDest(pathOrName, "");
				}
				if (file instanceof TFile) {
					return app.vault.getResourcePath(file);
				}
			}
		}
		return null;
	}
</script>

<div class="lumina-message__attachments">
	{#each attachments as att}
		<div
			class="lumina-message__attachment-chip"
			title={att.path || att.name}
			onclick={(e) => handleClick(att, e)}
			onauxclick={(e) => handleClick(att, e)}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					handleClick(att, e as unknown as MouseEvent);
				}
			}}
			role="button"
			tabindex="0"
		>
			{#if getImageSrc(att)}
				<img src={getImageSrc(att)} alt={att.name} class="lumina-message__attachment-thumb" />
			{:else}
				<span class="lumina-message__attachment-icon" use:icon={getAttachmentIcon(att.type)}></span>
			{/if}
			<span class="lumina-message__attachment-name">{att.name}</span>
		</div>
	{/each}
</div>

<style>
	.lumina-message__attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}

	.lumina-message__attachment-chip {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		font-size: 11px;
		color: var(--text-muted);
		max-width: 200px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-message__attachment-chip:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: rgba(139, 92, 246, 0.3);
	}

	.lumina-message__attachment-thumb {
		width: 14px;
		height: 14px;
		border-radius: 2px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.lumina-message__attachment-icon {
		display: flex;
		align-items: center;
	}

	.lumina-message__attachment-icon :global(svg) {
		width: 12px;
		height: 12px;
		opacity: 0.8;
	}

	.lumina-message__attachment-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>