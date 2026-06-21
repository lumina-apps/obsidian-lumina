<script lang="ts">
	import { Component, MarkdownRenderer, type App } from "obsidian";
	import { onMount, onDestroy } from "svelte";
	import { t } from "../../../shared/locales/helpers";
	import { renderMessageContent } from "./utils/markdownRendererHelper";

	let {
		thinkContent,
		app,
		isThinking,
		role,
		isStreaming,
	}: {
		thinkContent: string;
		app: App;
		isThinking: boolean;
		role: string;
		isStreaming: boolean;
	} = $props();

	let thinkEl: HTMLElement | null = $state(null);
	let wrapperEl: HTMLElement | null = $state(null);
	const compRef: { current: Component | null } = { current: null };

	let isThinkOpen = $state(false);
	let autoClosed = $state(false);

	// 스트리밍 중 think 태그가 열리면 자동으로 펼침
	$effect(() => {
		if (isThinking) {
			isThinkOpen = true;
			autoClosed = false;
		}
	});

	// 스트리밍 완료 시 한 번만 자동 접기 (사용자가 수동으로 열면 다시 닫지 않음)
	$effect(() => {
		if (!isStreaming && !isThinking && !autoClosed) {
			isThinkOpen = false;
			autoClosed = true;
		}
	});

	// 마크다운 렌더링 및 자동 스크롤
	$effect(() => {
		if (!thinkEl) return;
		renderMessageContent(
			thinkEl,
			compRef,
			app,
			thinkContent,
			isStreaming,
			role,
		);

		// 스트리밍 중에는 자동으로 스크롤을 맨 아래로 내림
		if (isStreaming && wrapperEl) {
			requestAnimationFrame(() => {
				if (wrapperEl) {
					wrapperEl.scrollTop = wrapperEl.scrollHeight;
				}
			});
		}
	});

	onDestroy(() => {
		compRef.current?.unload();
	});
</script>

<details class="lumina-message__think-block" bind:open={isThinkOpen}>
	<summary class="lumina-message__think-summary">
		🧠 {t("uiMessages.thoughtProcess")}
		{isThinking ? "..." : ""}
	</summary>
	<div class="lumina-message__think-content-wrapper" bind:this={wrapperEl}>
		<div class="lumina-message__think-content" bind:this={thinkEl}></div>
		{#if isThinking}
			<span class="lumina-message__cursor">▋</span>
		{/if}
	</div>
</details>

<style>
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
		max-height: 150px;
		overflow-y: auto;
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
</style>
