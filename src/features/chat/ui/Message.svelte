<script lang="ts">
	import { Component, type App } from "obsidian";
	import { onDestroy } from "svelte";
	import type { UIChatMessage } from "../../../shared/types/chat.types";
	import { getLanguage } from "../../../shared/locales/helpers";
	import { formatTime } from "../../../shared/utils/dateUtils";
	import { extractThinkBlocks, sanitizeDisplayContent } from "../../../shared/utils/llmTextSanitizer";
	import { renderMessageContent } from "./utils/markdownRendererHelper";
	import AttachmentChips from "./AttachmentChips.svelte";
	import ThinkBlock from "./ThinkBlock.svelte";
	import RagSources from "./RagSources.svelte";
	import RagProgressIndicator from "./RagProgressIndicator.svelte";
	import MessageActions from "./MessageActions.svelte";
	import MessageEditArea from "./MessageEditArea.svelte";

	let {
		message,
		app,
		onEdit,
		onRegenerate,
	}: {
		message: UIChatMessage;
		app: App;
		onEdit?: (id: string, content: string) => void;
		onRegenerate?: (id: string) => void;
	} = $props();

	let isEditing = $state(false);

	let rawContent = $derived(message.content || "");
	let thinkBlocks = $derived(extractThinkBlocks(rawContent));
	let thinkContent = $derived(thinkBlocks.join('\n\n---\n\n'));
	let displayContent = $derived(sanitizeDisplayContent(rawContent));
	let isThinking = $derived(
		message.isStreaming && rawContent.toLowerCase().includes('<think>') && !rawContent.toLowerCase().includes('</think>')
	);

	let contentEl: HTMLElement | null = $state(null);
	const compRef: { current: Component | null } = { current: null };

	// 본문 마크다운 렌더링
	$effect(() => {
		if (!contentEl) return;
		renderMessageContent(contentEl, compRef, app, displayContent, message.isStreaming, message.role);
	});

	onDestroy(() => {
		compRef.current?.unload();
	});

	function handleEditStart(_id: string, content: string): void {
		isEditing = true;
	}

	function handleEditSave(newContent: string): void {
		isEditing = false;
		onEdit?.(message.id, newContent);
	}

	function handleEditCancel(): void {
		isEditing = false;
	}
</script>

<div
	class="lumina-message lumina-message--{message.role}"
	class:is-streaming={message.isStreaming}
>
	<div class="lumina-message__header">
		{#if message.role === "user"}
			<span class="lumina-message__role">👤 You</span>
		{:else}
			<span class="lumina-message__role"
				>✦ Lumina{message.model ? ` · ${message.model}` : ""}</span
			>
		{/if}
		<span class="lumina-message__time">{formatTime(message.timestamp, getLanguage())}</span>
	</div>

	<div class="lumina-message__body">
		{#if isEditing}
			<MessageEditArea
				content={message.content}
				onSave={handleEditSave}
				onCancel={handleEditCancel}
			/>
		{:else}
			{#if message.attachments && message.attachments.length > 0}
				<AttachmentChips attachments={message.attachments} {app} />
			{/if}
			{#if message.ragPipelineStep && message.role === 'assistant'}
				<RagProgressIndicator step={message.ragPipelineStep} {app} />
			{/if}
			{#if thinkContent}
				<ThinkBlock
					{thinkContent}
					{app}
					{isThinking}
					isStreaming={message.isStreaming}
					role={message.role}
				/>
			{/if}
			<div class="lumina-message__content" bind:this={contentEl}></div>
			{#if message.isStreaming && !isThinking}
				<span class="lumina-message__cursor">▋</span>
			{/if}
		{/if}
	</div>

	{#if !message.isStreaming}
		{#if message.role === "assistant" && message.ragSources && message.ragSources.length > 0}
			<RagSources sources={message.ragSources} {app} />
		{/if}
		<MessageActions
			{message}
			{app}
			onEditStart={handleEditStart}
			{onRegenerate}
		/>
	{/if}
</div>

<style>
	.lumina-message {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
		animation: fadeSlideIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
		transition: all 0.2s ease;
	}

	@keyframes fadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.lumina-message--user {
		background: var(--background-secondary-alt);
		margin-left: 28px;
		border-radius: 14px 14px 2px 14px;
		border: 1px solid rgba(var(--mono-rgb-100), 0.05);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.015);
	}

	.lumina-message--assistant {
		background: var(--background-secondary);
		margin-right: 28px;
		border-radius: 14px 14px 14px 2px;
		border: 1px solid rgba(var(--mono-rgb-100), 0.04);
		border-left: 3px solid var(--interactive-accent);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.01);
	}

	.lumina-message__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		margin-bottom: 2px;
	}

	.lumina-message__role {
		font-size: 10.5px;
		font-weight: 700;
		color: var(--text-muted);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.lumina-message--assistant .lumina-message__role {
		background: linear-gradient(135deg, var(--interactive-accent) 0%, #a855f7 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	.lumina-message__time {
		font-size: 9.5px;
		color: var(--text-faint);
		font-weight: 500;
	}

	.lumina-message__body {
		position: relative;
	}

	.lumina-message__content {
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-normal);
		word-break: break-word;
	}

	.lumina-message__think-block {
		margin-bottom: 8px;
		background: rgba(var(--mono-rgb-100), 0.03);
		border-radius: 8px;
		border-left: 3px solid var(--text-muted);
		overflow: hidden;
	}

	.lumina-message__think-summary {
		padding: 8px 12px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		user-select: none;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: background 0.2s;
	}

	.lumina-message__think-summary:hover {
		background: rgba(var(--mono-rgb-100), 0.05);
		color: var(--text-normal);
	}

	.lumina-message__think-content-wrapper {
		padding: 0 12px 10px 12px;
	}

	.lumina-message__think-content {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.lumina-message__think-content :global(p) {
		margin: 0 0 6px;
	}

	.lumina-message__think-content :global(p:last-child) {
		margin-bottom: 0;
	}

	/* 사용자 메시지: plaintext 입력이므로 pre-wrap 적용 */
	.lumina-message--user .lumina-message__content {
		white-space: pre-wrap;
	}

	/* 어시스턴트 메시지: MarkdownRenderer가 만드는 요소들 스타일 오버라이드 */
	.lumina-message__content :global(p) {
		margin: 0 0 8px;
		white-space: normal;
	}

	.lumina-message__content :global(p:last-child) {
		margin-bottom: 0;
	}

	.lumina-message__content :global(code) {
		background: var(--code-background);
		padding: 2px 5px;
		border-radius: 4px;
		font-size: 11.5px;
		font-family: var(--font-monospace);
	}

	.lumina-message__content :global(pre) {
		background: var(--code-background);
		padding: 12px 14px;
		border-radius: 8px;
		overflow-x: auto;
		border: 1px solid rgba(var(--mono-rgb-100), 0.05);
		margin: 8px 0;
	}

	.lumina-message__content :global(ul),
	.lumina-message__content :global(ol) {
		padding-left: 20px;
		margin: 6px 0;
	}

	.lumina-message__cursor {
		display: inline-block;
		color: var(--interactive-accent);
		animation: blink 1s step-end infinite;
		font-size: 14px;
		vertical-align: bottom;
		margin-left: 2px;
	}

	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	.lumina-message__actions {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
		opacity: 1; /* 마우스 오버 없이 항상 보이도록 변경 */
		transition: opacity 0.2s ease;
	}

	.lumina-message__rag-sources {
		display: flex;
		gap: 4px;
		margin-top: 10px;
		flex-wrap: wrap;
	}


	.lumina-message__rag-source {
		font-size: 9.5px;
		padding: 3px 6px;
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

	.lumina-message:hover :global(.lumina-message__actions) {
		opacity: 1;
	}

	.lumina-message--user :global(.lumina-message__actions) {
		justify-content: flex-end;
	}

	.lumina-message__action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-message__action-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border);
	}

	.lumina-message__action-btn :global(svg) {
		width: 14px;
		height: 14px;
		stroke-width: 2px;
		stroke: currentColor;
		fill: none;
		display: inline-block;
		opacity: 1;
		visibility: visible;
	}
	
	.lumina-message__action-btn :global(path),
	.lumina-message__action-btn :global(rect),
	.lumina-message__action-btn :global(polyline),
	.lumina-message__action-btn :global(line) {
		stroke: currentColor;
	}

	.lumina-message__edit-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 4px;
	}

	.lumina-message__edit-textarea {
		width: 100%;
		background: var(--background-primary);
		border: 1px solid var(--interactive-accent);
		border-radius: 6px;
		padding: 8px;
		color: var(--text-normal);
		font-size: 13px;
		resize: vertical;
		font-family: var(--font-interface);
	}

	.lumina-message__edit-textarea:focus {
		outline: none;
		box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2);
	}

	.lumina-message__edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}

	.lumina-message__edit-btn {
		background: var(--background-secondary-alt);
		border: 1px solid var(--background-modifier-border);
		color: var(--text-muted);
		padding: 4px 10px;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-message__edit-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-message__edit-btn--primary {
		background: var(--interactive-accent);
		color: white;
		border-color: var(--interactive-accent);
	}

	.lumina-message__edit-btn--primary:hover {
		background: var(--interactive-accent-hover);
		color: white;
		border-color: var(--interactive-accent-hover);
	}
</style>