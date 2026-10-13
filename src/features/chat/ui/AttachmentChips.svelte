<script lang="ts">
	import type { App } from "obsidian";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import { getAttachmentIcon } from "../utils/fileAttachmentUtils";
	import { icon } from "../../../shared/utils/iconAction";
	import { openFile } from "./utils/messageActions";

	let {
		attachments,
		app,
	}: {
		attachments: ContextAttachment[];
		app: App;
	} = $props();
	function handleClick(att: ContextAttachment, e: MouseEvent) {
		if (att.type === 'file' || att.type === 'active_note' || att.type === 'canvas') {
			openFile(app, att.path, e);
		} else if (att.type === 'url') {
			window.open(att.path, '_blank', 'noopener,noreferrer');
		}
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
			{#if att.content?.startsWith('data:image/')}
				<img src={att.content} alt={att.name} class="lumina-message__attachment-thumb" />
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