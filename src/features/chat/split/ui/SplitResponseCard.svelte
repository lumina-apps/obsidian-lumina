<script lang="ts">
	import { Component, type App } from "obsidian";
	import { onDestroy } from "svelte";
	import type { tStore } from "../../../../shared/locales/index";
	import type { SplitSlotResponse } from "../../../../shared/types/splitChat.types";
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
	import { getSlotAccentColor } from "../splitSlotUtils";

	let {
		response,
		slotLabel,
		maskedLabel,
		isMasked,
		isWinner,
		isFastest,
		app,
		tStore: tS,
		onStop,
		onRetry,
		onPickWinner,
		onContinueInChat,
		onExpand,
	}: {
		response: SplitSlotResponse;
		slotLabel: string;
		maskedLabel: string;
		isMasked: boolean;
		isWinner: boolean;
		isFastest: boolean;
		app: App;
		tStore: typeof tStore;
		onStop: () => void;
		onRetry: () => void;
		onPickWinner: () => void;
		onContinueInChat: () => void;
		onExpand: () => void;
	} = $props();

	const isStreaming = $derived(
		response.status === "waiting" || response.status === "streaming",
	);

	const rawContent = $derived(response.content || "");
	const textThinking = $derived(extractThinkBlocks(rawContent).join("\n\n---\n\n"));
	const thinkContent = $derived(
		[response.thinking, textThinking].filter(Boolean).join("\n\n---\n\n"),
	);
	const displayContent = $derived(sanitizeDisplayContent(rawContent));
	const isThinking = $derived(isStreaming && Boolean(thinkContent));

	let contentEl = $state<HTMLElement | null>(null);
	const compRef: { current: Component | null } = { current: null };

	// 본문 마크다운 렌더링
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

	// 스트리밍 중 실시간 경과 시간 표시
	let liveElapsedMs = $state(0);
	$effect(() => {
		if (!isStreaming) {
			liveElapsedMs = response.metrics.durationMs ?? 0;
			return;
		}
		liveElapsedMs = Math.max(0, Date.now() - response.metrics.startedAt);
		const timerId = window.setInterval(() => {
			liveElapsedMs = Math.max(0, Date.now() - response.metrics.startedAt);
		}, 100);
		return () => {
			window.clearInterval(timerId);
		};
	});

	onDestroy(() => {
		compRef.current?.unload();
	});

	const headerTitle = $derived(
		isMasked
			? $tS("splitChat.blindModelLabel", { label: maskedLabel })
			: response.modelId,
	);

	const badgeColor = $derived(
		isMasked ? "var(--text-muted)" : getSlotAccentColor(slotLabel),
	);

	const metricLabel = $derived.by(() => {
		const durMs = response.metrics.durationMs;
		if (typeof durMs !== "number") return "";
		const sec = (durMs / 1000).toFixed(2);
		const totalTok = response.tokenUsage?.totalTokens;
		const tps = response.metrics.tokensPerSecond;
		if (typeof totalTok === "number" && typeof tps === "number") {
			return $tS("splitChat.metricsSummary", {
				sec,
				tokens: totalTok.toLocaleString(),
				tps: tps.toFixed(1),
			});
		}
		return $tS("splitChat.metricsTimeOnly", { sec });
	});

	const ttftTooltip = $derived(
		typeof response.metrics.ttftMs === "number"
			? $tS("splitChat.metricsTtftTooltip", {
					ms: Math.round(response.metrics.ttftMs).toLocaleString(),
				})
			: undefined,
	);

	async function handleCopy(): Promise<void> {
		await copyToClipboard(displayContent, $tS("uiMessages.copiedToClipboard"));
	}

	function handleSaveNote(): void {
		openSaveAsNoteModal(app, displayContent);
	}
</script>

<div
	class="lumina-split-card"
	class:is-winner={isWinner}
	class:is-streaming={isStreaming}
	class:is-error={response.status === "error"}
>
	<!-- 카드 상단 헤더 -->
	<div class="lumina-split-card__header">
		<div class="lumina-split-card__identity">
			<span
				class="lumina-split-card__badge"
				style:background={badgeColor}
			>
				{isMasked ? maskedLabel : slotLabel}
			</span>
			<span class="lumina-split-card__model" title={headerTitle}>
				{headerTitle}
			</span>
			{#if isWinner}
				<span class="lumina-split-card__winner-pill">
					🏆 {$tS("splitChat.winnerBadge")}
				</span>
			{/if}
		</div>

		<div class="lumina-split-card__status">
			{#if isStreaming}
				<span class="lumina-split-card__live-time">
					{(liveElapsedMs / 1000).toFixed(1)}s
				</span>
				<button
					type="button"
					class="clickable-icon lumina-split-card__stop-btn"
					aria-label={$tS("splitChat.stopSlot")}
					title={$tS("splitChat.stopSlot")}
					onclick={onStop}
					use:iconAction={"lumina-square"}
				></button>
			{:else if response.status === "aborted"}
				<span class="lumina-split-card__aborted-pill">
					{$tS("splitChat.aborted")}
				</span>
			{/if}
		</div>
	</div>

	<!-- 카드 본문 -->
	<div class="lumina-split-card__body">
		{#if response.status === "waiting" && !rawContent}
			<div class="lumina-split-card__waiting">
				<span class="lumina-spinner"></span>
				<span>{$tS("splitChat.waiting")}</span>
			</div>
		{:else}
			{#if thinkContent}
				<ThinkBlock
					{thinkContent}
					{app}
					{isThinking}
					{isStreaming}
					role="assistant"
				/>
			{/if}

			{#if response.status === "error"}
				<div class="lumina-split-card__error">
					<div class="lumina-split-card__error-text">
						⚠️ {response.errorMessage || $tS("common.error")}
					</div>
					<button
						type="button"
						class="lumina-split-card__retry-inline"
						onclick={onRetry}
					>
						↻ {$tS("splitChat.retrySlot")}
					</button>
				</div>
			{:else}
				<div class="lumina-message__content lumina-split-card__content" bind:this={contentEl}></div>
				{#if isStreaming && !isThinking}
					<span class="lumina-message__cursor">▋</span>
				{/if}
				{#if response.status === "aborted" && !displayContent}
					<div class="lumina-split-card__empty-aborted">
						{$tS("splitChat.aborted")}
					</div>
				{/if}
			{/if}
		{/if}
	</div>

	<!-- 카드 하단 고정 푸터 (메트릭 + 액션 바) -->
	{#if !isStreaming}
		<div class="lumina-split-card__footer">
			<div class="lumina-split-card__metrics" title={ttftTooltip}>
				{#if isFastest && response.status === "done"}
					<span class="lumina-split-card__fastest" title={$tS("splitChat.fastestBadge")}>
						⚡
					</span>
				{/if}
				{#if metricLabel}
					<span>{metricLabel}</span>
				{/if}
			</div>

			<div class="lumina-split-card__actions">
				{#if !isMasked && response.status !== "error" && displayContent}
					<button
						type="button"
						class="lumina-split-card__pick-btn"
						class:is-picked={isWinner}
						title={$tS("splitChat.pickWinner")}
						onclick={onPickWinner}
					>
						🏆 {isWinner ? $tS("splitChat.pickedWinner") : ""}
					</button>
				{/if}

				{#if displayContent}
					<button
						type="button"
						class="clickable-icon lumina-split-card__action-btn"
						aria-label={$tS("common.copy")}
						title={$tS("common.copy")}
						onclick={handleCopy}
						use:iconAction={"copy"}
					></button>
					<button
						type="button"
						class="clickable-icon lumina-split-card__action-btn"
						aria-label={$tS("uiMessages.saveAsNote")}
						title={$tS("uiMessages.saveAsNote")}
						onclick={handleSaveNote}
						use:iconAction={"file-plus"}
					></button>
				{/if}

				<button
					type="button"
					class="clickable-icon lumina-split-card__action-btn"
					aria-label={$tS("splitChat.retrySlot")}
					title={$tS("splitChat.retrySlot")}
					onclick={onRetry}
					use:iconAction={"refresh-cw"}
				></button>

				{#if !isMasked && response.status !== "error" && displayContent}
					<button
						type="button"
						class="clickable-icon lumina-split-card__action-btn"
						aria-label={$tS("splitChat.continueInChat")}
						title={$tS("splitChat.continueInChat")}
						onclick={onContinueInChat}
						use:iconAction={"message-square-share"}
					></button>
				{/if}

				{#if displayContent}
					<button
						type="button"
						class="clickable-icon lumina-split-card__action-btn"
						aria-label={$tS("splitChat.expandView")}
						title={$tS("splitChat.expandView")}
						onclick={onExpand}
						use:iconAction={"maximize-2"}
					></button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.lumina-split-card {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 10px;
		overflow: hidden;
		transition: border-color 0.2s ease, box-shadow 0.2s ease;
	}

	.lumina-split-card.is-winner {
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--interactive-accent) 45%, transparent);
	}

	.lumina-split-card.is-error {
		border-color: color-mix(in srgb, var(--text-error) 50%, var(--background-modifier-border));
	}

	.lumina-split-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 7px 10px;
		background: color-mix(in srgb, var(--background-primary) 50%, var(--background-secondary));
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-split-card__identity {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.lumina-split-card__badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		color: #ffffff;
		font-size: 10px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.lumina-split-card__model {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-split-card__winner-pill {
		font-size: 10px;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--interactive-accent) 16%, transparent);
		color: var(--interactive-accent);
		flex-shrink: 0;
	}

	.lumina-split-card__status {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.lumina-split-card__live-time {
		font-size: 10.5px;
		font-weight: 600;
		color: var(--interactive-accent);
		font-variant-numeric: tabular-nums;
	}

	.lumina-split-card__stop-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border-radius: 4px;
		border: none;
		background: color-mix(in srgb, var(--text-error) 15%, transparent);
		color: var(--text-error);
		cursor: pointer;
	}

	.lumina-split-card__stop-btn :global(svg) {
		width: 11px;
		height: 11px;
	}

	.lumina-split-card__aborted-pill {
		font-size: 10px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--background-modifier-border);
		padding: 1px 6px;
		border-radius: 4px;
	}

	.lumina-split-card__body {
		flex: 1;
		padding: 10px 12px;
		min-height: 60px;
		overflow-x: auto;
	}

	.lumina-split-card__waiting {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--text-muted);
		font-size: 12px;
		padding: 6px 0;
	}

	.lumina-split-card__content {
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-normal);
		word-break: break-word;
	}

	.lumina-split-card__content :global(p) {
		margin: 0 0 8px;
	}

	.lumina-split-card__content :global(p:last-child) {
		margin-bottom: 0;
	}

	.lumina-split-card__content :global(pre) {
		position: relative;
		background: var(--code-background);
		padding: 10px 12px;
		border-radius: 7px;
		overflow-x: auto;
		margin: 8px 0;
	}

	.lumina-split-card__content :global(code) {
		background: var(--code-background);
		padding: 1px 4px;
		border-radius: 4px;
		font-size: 11.5px;
		font-family: var(--font-monospace);
	}

	.lumina-split-card__content :global(.lumina-code-insert-btn) {
		position: absolute;
		top: 6px;
		right: 36px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 4px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		color: var(--text-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.lumina-split-card__content :global(pre:hover .lumina-code-insert-btn),
	:global(.is-mobile) .lumina-split-card__content :global(.lumina-code-insert-btn) {
		opacity: 1;
	}

	.lumina-split-card__error {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 10px;
		border-radius: 6px;
		background: color-mix(in srgb, var(--text-error) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--text-error) 30%, transparent);
	}

	.lumina-split-card__error-text {
		font-size: 12px;
		color: var(--text-error);
		word-break: break-word;
	}

	.lumina-split-card__retry-inline {
		all: unset;
		box-sizing: border-box;
		align-self: flex-start;
		padding: 4px 10px;
		border-radius: 5px;
		font-size: 11px;
		font-weight: 600;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		color: var(--text-normal);
		cursor: pointer;
	}

	.lumina-split-card__retry-inline:hover {
		border-color: var(--interactive-accent);
		color: var(--interactive-accent);
	}

	.lumina-split-card__empty-aborted {
		font-size: 12px;
		color: var(--text-muted);
		font-style: italic;
	}

	.lumina-split-card__footer {
		margin-top: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 6px;
		padding: 6px 10px;
		border-top: 1px solid var(--background-modifier-border);
		background: color-mix(in srgb, var(--background-primary) 40%, var(--background-secondary));
	}

	.lumina-split-card__metrics {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10.5px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.lumina-split-card__fastest {
		font-size: 11px;
	}

	.lumina-split-card__actions {
		display: flex;
		align-items: center;
		gap: 3px;
	}

	.lumina-split-card__pick-btn {
		all: unset;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 22px;
		padding: 0 6px;
		border-radius: 5px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-muted);
		font-size: 10.5px;
		font-weight: 600;
		cursor: pointer;
	}

	.lumina-split-card__pick-btn:hover {
		border-color: var(--interactive-accent);
		color: var(--text-normal);
	}

	.lumina-split-card__pick-btn.is-picked {
		border-color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-primary));
		color: var(--interactive-accent);
	}

	.lumina-split-card__action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 5px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}

	.lumina-split-card__action-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border);
	}

	.lumina-split-card__action-btn :global(svg) {
		width: 13px;
		height: 13px;
	}

	.lumina-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid var(--text-muted);
		border-top-color: transparent;
		border-radius: 50%;
		animation: splitSpin 1s linear infinite;
	}

	@keyframes splitSpin {
		to {
			transform: rotate(360deg);
		}
	}

	.lumina-message__cursor {
		display: inline-block;
		color: var(--interactive-accent);
		animation: splitCursorBlink 1s step-end infinite;
		font-size: 14px;
		vertical-align: bottom;
		margin-left: 2px;
	}

	@keyframes splitCursorBlink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	/* 모바일 응답 카드 액션·정지 버튼 터치 영역 및 마크다운 표 가로 스크롤 */
	:global(body.is-mobile) .clickable-icon.lumina-split-card__action-btn,
	:global(body.is-mobile) .clickable-icon.lumina-split-card__stop-btn {
		width: 28px;
		height: 28px;
		min-width: 28px;
		min-height: 28px;
		padding: 0;
	}

	:global(body.is-mobile) .lumina-split-card__content :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}
</style>
