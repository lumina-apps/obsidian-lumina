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
	const compRef: { current: Component | null } = { current: null };

	let isThinkOpen = $state(false);

	// 스트리밍 중 think 태그가 열리면 자동으로 펼침
	$effect(() => {
		if (isThinking) {
			isThinkOpen = true;
		}
	});

	// 스트리밍 완료 시 접기
	$effect(() => {
		if (!isStreaming && isThinkOpen) {
			isThinkOpen = false;
		}
	});

	// 마크다운 렌더링
	$effect(() => {
		if (!thinkEl) return;
		renderMessageContent(thinkEl, compRef, app, thinkContent, isStreaming, role);
	});

	onDestroy(() => {
		compRef.current?.unload();
	});
</script>

<details class="lumina-message__think-block" bind:open={isThinkOpen}>
	<summary class="lumina-message__think-summary">
		🧠 {t("uiMessages.thoughtProcess")} {isThinking ? '...' : ''}
	</summary>
	<div class="lumina-message__think-content-wrapper">
		<div class="lumina-message__think-content" bind:this={thinkEl}></div>
		{#if isThinking}
			<span class="lumina-message__cursor">▋</span>
		{/if}
	</div>
</details>