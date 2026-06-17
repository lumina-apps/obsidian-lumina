<script lang="ts">
	import type { App } from "obsidian";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import { getAttachmentIcon } from "../utils/fileAttachmentUtils";
	import { icon } from "./utils/iconAction";
	import { openFile } from "./utils/messageActions";

	let {
		attachments,
		app,
	}: {
		attachments: ContextAttachment[];
		app: App;
	} = $props();
</script>

<div class="lumina-message__attachments">
	{#each attachments as att}
		<div
			class="lumina-message__attachment-chip"
			title={att.path}
			onclick={(e) => {
				if (att.type === 'file' || att.type === 'active_note') {
					openFile(app, att.path, e);
				}
			}}
			onauxclick={(e) => {
				if (att.type === 'file' || att.type === 'active_note') {
					openFile(app, att.path, e);
				}
			}}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					if (att.type === 'file' || att.type === 'active_note') {
						openFile(app, att.path, e);
					}
				}
			}}
			role="button"
			tabindex="0"
		>
			<span class="lumina-message__attachment-icon" use:icon={getAttachmentIcon(att.type)}></span>
			<span class="lumina-message__attachment-name">{att.name}</span>
		</div>
	{/each}
</div>