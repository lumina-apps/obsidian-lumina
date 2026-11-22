<script lang="ts">
	import { Component, type App } from "obsidian";
	import { onDestroy } from "svelte";
	import type { tStore } from "../../../../shared/locales/index";
	import type {
		SplitSlotResponse,
		SplitTurn,
	} from "../../../../shared/types/splitChat.types";
	import { copyToClipboard } from "../../../../shared/utils/clipboardUtils";
	import { iconAction } from "../../../../shared/utils/domUtils";
	import {
		extractThinkBlocks,
		sanitizeDisplayContent,
	} from "../../../../shared/utils/llmTextSanitizer";
	import { renderMessageContent } from "../../../../shared/utils/markdownRendererHelper";
	import ThinkBlock from "../../ui/ThinkBlock.svelte";
	import {
		insertToNote,
		openSaveAsNoteModal,
	} from "../../ui/utils/messageActions";

	let {
		turn,
		response,
		slotLabel,
		maskedLabel,
		isMasked,
		app,
		tStore: tS,
		onClose,
	}: {
		turn: SplitTurn;
		response: SplitSlotResponse;
		slotLabel: string;
		maskedLabel: string;
		isMasked: boolean;
		app: App;
		tStore: typeof tStore;
		onClose: () => void;
	} = $props();

	const rawContent = $derived(response.content || "");
	const textThinking = $derived(extractThinkBlocks(rawContent).join("\n\n---\n\n"));
	const thinkContent = $derived(
		[response.thinking, textThinking].filter(Boolean).join("\n\n---\n\n"),
	);
	const displayContent = $derived(sanitizeDisplayContent(rawContent));
	const isStreaming = $derived(
		response.status === "waiting" || response.status === "streaming",
	);

	const titleText = $derived(
		isMasked
			? $tS("splitChat.blindModelLabel", { label: maskedLabel })
			: `${slotLabel} · ${response.modelId}`,
	);

	let contentEl = $state<HTMLElement | null>(null);
	const compRef: { current: Component | null } = { current: null };

	$effect(() => {
		if (!contentEl) return;
		renderMessageContent(
			contentEl,
			compRef,
			app,
			displayContent,
			isStreaming,
			"assistant",
			{
				onInsertCode: (fencedCode) => insertToNote(app, fencedCode),
				insertCodeLabel: $tS("uiMessages.insertCodeBlock"),
			},
		);
	});

	$effect(() => {
		const handleKeydown = (e: KeyboardEvent): void => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		activeDocument.addEventListener("keydown", handleKeydown);
		return () => {
			activeDocument.removeEventListener("keydown", handleKeydown);
		};
	});

	onDestroy(() => {
		compRef.current?.unload();
	});

	async function handleCopy(): Promise<void> {
		await copyToClipboard(displayContent, $tS("uiMessages.copiedToClipboard"));
	}

	function handleSaveNote(): void {
		openSaveAsNoteModal(app, displayContent);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="lumina-split-focus-backdrop"
	role="presentation"
	onclick={onClose}
>
	<div
		class="lumina-split-focus-modal"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="lumina-split-focus-modal__header">
			<div class="lumina-split-focus-modal__title">{titleText}</div>
			<div class="lumina-split-focus-modal__actions">
				<button
					type="button"
					class="clickable-icon lumina-split-focus-modal__btn"
					aria-label={$tS("common.copy")}
					title={$tS("common.copy")}
					onclick={handleCopy}
					use:iconAction={"copy"}
				></button>
				<button
					type="button"
					class="clickable-icon lumina-split-focus-modal__btn"
					aria-label={$tS("uiMessages.saveAsNote")}
					title={$tS("uiMessages.saveAsNote")}
					onclick={handleSaveNote}
					use:iconAction={"file-plus"}
				></button>
				<button
					type="button"
					class="clickable-icon lumina-split-focus-modal__btn"
					aria-label={$tS("common.cancel")}
					title={$tS("common.cancel")}
					onclick={onClose}
					use:iconAction={"x"}
				></button>
			</div>
		</div>

		<div class="lumina-split-focus-modal__prompt">
			<strong>👤 You:</strong> {turn.userMessage.content}
		</div>

		<div class="lumina-split-focus-modal__body lumina-scrollbar-thin">
			{#if thinkContent}
				<ThinkBlock
					{thinkContent}
					{app}
					isThinking={isStreaming && Boolean(thinkContent)}
					{isStreaming}
					role="assistant"
				/>
			{/if}
			<div class="lumina-message__content lumina-split-focus-modal__content" bind:this={contentEl}></div>
		</div>
	</div>
</div>

<style>
	.lumina-split-focus-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(2px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		z-index: 200;
	}

	.lumina-split-focus-modal {
		width: min(860px, 100%);
		max-height: 90%;
		display: flex;
		flex-direction: column;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 12px;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
		overflow: hidden;
	}

	.lumina-split-focus-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-split-focus-modal__title {
		font-size: 13.5px;
		font-weight: 700;
		color: var(--text-normal);
	}

	.lumina-split-focus-modal__actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.lumina-split-focus-modal__btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: transparent;
		border: 1px solid transparent;
		color: var(--text-muted);
		cursor: pointer;
	}

	.lumina-split-focus-modal__btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border);
	}

	.lumina-split-focus-modal__btn :global(svg) {
		width: 15px;
		height: 15px;
	}

	.lumina-split-focus-modal__prompt {
		padding: 8px 16px;
		font-size: 12px;
		color: var(--text-muted);
		background: var(--background-secondary-alt);
		border-bottom: 1px solid var(--background-modifier-border);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lumina-split-focus-modal__body {
		flex: 1;
		overflow-y: auto;
		padding: 16px 20px;
	}

	.lumina-split-focus-modal__content {
		font-size: 13.5px;
		line-height: 1.65;
		color: var(--text-normal);
		user-select: text;
	}

	.lumina-split-focus-modal__content :global(pre) {
		position: relative;
		background: var(--code-background);
		padding: 12px;
		border-radius: 8px;
		overflow-x: auto;
	}
</style>
