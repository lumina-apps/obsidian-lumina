<script lang="ts">
	import type { App } from "obsidian";
	import type { UIChatMessage } from "../../../shared/types/chat.types";
	import { t } from "../../../shared/locales/helpers";
	import { copyToClipboard } from "../../../shared/utils/clipboardUtils";
	import { icon } from "./utils/iconAction";
	import { insertToNote } from "./utils/messageActions";

	let {
		message,
		app,
		onEditStart,
		onRegenerate,
	}: {
		message: UIChatMessage;
		app: App;
		onEditStart?: (id: string, content: string) => void;
		onRegenerate?: (id: string) => void;
	} = $props();

	async function handleCopy(): Promise<void> {
		await copyToClipboard(message.content, t("uiMessages.copiedToClipboard"));
	}

	function handleInsertToNote(): void {
		insertToNote(app, message.content);
	}

	function handleRegenerate(): void {
		if (window.confirm(t("uiMessages.regenerateConfirm"))) {
			onRegenerate?.(message.id);
		}
	}

	function handleEditStart(): void {
		onEditStart?.(message.id, message.content);
	}
</script>

<div class="lumina-message__actions">
	{#if message.role === "assistant"}
		<button class="clickable-icon lumina-message__action-btn" aria-label={t("common.copy")} use:icon={"copy"} onclick={handleCopy}></button>
		<button class="clickable-icon lumina-message__action-btn" aria-label={t("uiMessages.insertToNote")} use:icon={"arrow-down"} onclick={handleInsertToNote}></button>
		<button class="clickable-icon lumina-message__action-btn" aria-label={t("uiMessages.regenerate")} use:icon={"refresh-cw"} onclick={handleRegenerate}></button>
	{:else}
		<button class="clickable-icon lumina-message__action-btn" aria-label={t("common.copy")} use:icon={"copy"} onclick={handleCopy}></button>
		<button class="clickable-icon lumina-message__action-btn" aria-label={t("uiMessages.insertToNote")} use:icon={"arrow-down"} onclick={handleInsertToNote}></button>
		<button class="clickable-icon lumina-message__action-btn" aria-label={t("uiMessages.edit")} use:icon={"pencil"} onclick={handleEditStart}></button>
	{/if}
</div>