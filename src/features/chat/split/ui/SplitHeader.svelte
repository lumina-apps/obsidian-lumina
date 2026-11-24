<script lang="ts">
	import type { IndexingState } from "../../../../core/store/ragStore";
	import type { tStore } from "../../../../shared/locales/index";
	import type {
		SplitContextMode,
		SplitLayoutMode,
	} from "../../../../shared/types/splitChat.types";
	import { iconAction } from "../../../../shared/utils/domUtils";

	let {
		mode,
		contextMode,
		slotCount,
		maxSlots,
		freeMaxSlots = 2,
		isPro = true,
		isStreaming,
		hasProvider,
		hasTurns,
		showHistory,
		isRagEnabled,
		indexingState,
		indexingProgress,
		useRagContext,
		tStore: tS,
		onToggleHistory,
		onChangeMode,
		onChangeContextMode,
		onToggleRag,
		onAddSlot,
		onExport,
		onNewChat,
	}: {
		mode: SplitLayoutMode;
		contextMode: SplitContextMode;
		slotCount: number;
		maxSlots: number;
		freeMaxSlots?: number;
		isPro?: boolean;
		isStreaming: boolean;
		hasProvider: boolean;
		hasTurns: boolean;
		showHistory: boolean;
		isRagEnabled: boolean;
		indexingState: IndexingState;
		indexingProgress: number;
		useRagContext: boolean;
		tStore: typeof tStore;
		onToggleHistory: () => void;
		onChangeMode: (next: SplitLayoutMode) => void;
		onChangeContextMode: (next: SplitContextMode) => void;
		onToggleRag: () => void;
		onAddSlot: () => void;
		onExport: () => void;
		onNewChat: () => void;
	} = $props();

	const isAtFreeSlotLimit = $derived(!isPro && slotCount >= freeMaxSlots);
	const isAtProSlotLimit = $derived(isPro && slotCount >= maxSlots);
</script>

<div class="lumina-split-header">
	<div class="lumina-split-header__left">
		<button
			type="button"
			class="clickable-icon lumina-split-header__icon-btn"
			class:is-active={showHistory}
			aria-label={$tS("splitChat.historyToggle")}
			title={$tS("splitChat.historyToggle")}
			onclick={onToggleHistory}
			use:iconAction={"panel-left"}
		></button>

		<div class="lumina-split-header__brand">
			<span class="lumina-split-header__brand-icon" use:iconAction={"lumina-split-chat"}></span>
			<span class="lumina-split-header__title">{$tS("splitChat.title")}</span>
			<span class="lumina-split-pro-badge">{$tS("splitChat.proBadge")}</span>
		</div>

		<div class="lumina-split-header__segmented" role="group" aria-label="Layout mode">
			<button
				type="button"
				class="lumina-split-header__seg-btn"
				class:is-active={mode === "side-by-side"}
				title={$tS("splitChat.modeSideBySideTooltip")}
				onclick={() => onChangeMode("side-by-side")}
			>
				{$tS("splitChat.modeSideBySide")}
			</button>
			<button
				type="button"
				class="lumina-split-header__seg-btn"
				class:is-active={mode === "blind"}
				class:is-locked={!isPro}
				title={!isPro ? `${$tS("splitChat.modeBlindTooltip")} (PRO)` : $tS("splitChat.modeBlindTooltip")}
				onclick={() => onChangeMode("blind")}
			>
				🎭 {$tS("splitChat.modeBlind")}{#if !isPro} <span class="lumina-split-lock-mark" aria-hidden="true">🔒</span>{/if}
			</button>
		</div>
	</div>

	<div class="lumina-split-header__right">
		<div class="lumina-split-header__context-group">
			<span class="lumina-split-header__group-label">
				{$tS("splitChat.contextLabel")}:
			</span>
			<div class="lumina-split-header__segmented" role="group" aria-label={$tS("splitChat.contextLabel")}>
				<button
					type="button"
					class="lumina-split-header__seg-btn"
					class:is-active={contextMode === "independent"}
					title={$tS("splitChat.contextIndependentTooltip")}
					onclick={() => onChangeContextMode("independent")}
				>
					{$tS("splitChat.contextIndependent")}
				</button>
				<button
					type="button"
					class="lumina-split-header__seg-btn"
					class:is-active={contextMode === "winner"}
					class:is-locked={!isPro}
					title={!isPro ? `${$tS("splitChat.contextWinnerTooltip")} (PRO)` : $tS("splitChat.contextWinnerTooltip")}
					onclick={() => onChangeContextMode("winner")}
				>
					🏆 {$tS("splitChat.contextWinner")}{#if !isPro} <span class="lumina-split-lock-mark" aria-hidden="true">🔒</span>{/if}
				</button>
			</div>
		</div>

		<button
			type="button"
			class="lumina-chat__toggle-btn lumina-split-header__rag-btn"
			class:is-active={useRagContext}
			class:is-disabled={!isRagEnabled}
			aria-label={$tS("settings.rag.toggleTooltip")}
			title={!isRagEnabled
				? $tS("errors.ragDisabledGlobally")
				: indexingState.status === "ready"
					? `${$tS("settings.rag.toggleTooltip")} (${$tS("settings.rag.status.ready")})`
					: indexingState.status === "indexing" || indexingState.status === "loading-model"
						? `${$tS("settings.rag.toggleTooltip")} (${indexingProgress}%)`
						: $tS("settings.rag.toggleTooltip")}
			onclick={onToggleRag}
		>
			RAG
			{#if isRagEnabled && (indexingState.status === "indexing" || indexingState.status === "loading-model")}
				<span class="lumina-split-header__rag-pct">
					{indexingState.status === "loading-model" ? "…" : `${indexingProgress}%`}
				</span>
			{:else if isRagEnabled && indexingState.status === "ready"}
				<span class="lumina-split-header__rag-dot"></span>
			{/if}
		</button>

		<button
			type="button"
			class="lumina-split-header__add-btn"
			class:is-locked={isAtFreeSlotLimit}
			disabled={isAtProSlotLimit || isStreaming || !hasProvider}
			onclick={onAddSlot}
			title={isAtFreeSlotLimit
				? $tS("splitChat.proMaxSlotsNotice")
				: isAtProSlotLimit
					? $tS("splitChat.maxModelsReached", { max: maxSlots })
					: $tS("splitChat.addModel")}
		>
			<span>+</span>
			<span class="lumina-split-header__add-label">{$tS("splitChat.addModel")}</span>
			<span>({slotCount}/{maxSlots}){#if isAtFreeSlotLimit} 🔒{/if}</span>
		</button>

		<button
			type="button"
			class="clickable-icon lumina-split-header__icon-btn"
			class:is-locked={!isPro}
			disabled={!hasTurns}
			aria-label={!isPro ? `${$tS("splitChat.exportComparison")} (PRO)` : $tS("splitChat.exportComparison")}
			title={!isPro ? `${$tS("splitChat.exportComparison")} (PRO)` : $tS("splitChat.exportComparison")}
			onclick={onExport}
		>
			<span class="lumina-split-header__icon-inner" use:iconAction={"download"}></span>
			{#if !isPro}
				<span class="lumina-split-export-lock" aria-hidden="true">🔒</span>
			{/if}
		</button>

		<button
			type="button"
			class="clickable-icon lumina-split-header__icon-btn"
			aria-label={$tS("splitChat.newComparison")}
			title={$tS("splitChat.newComparison")}
			onclick={onNewChat}
			use:iconAction={"lumina-message-plus"}
		></button>
	</div>
</div>

<style>
	.lumina-split-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: nowrap;
		gap: 8px;
		padding: 6px 12px;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.lumina-split-header::-webkit-scrollbar {
		display: none;
	}

	.lumina-split-header__left,
	.lumina-split-header__right {
		display: flex;
		align-items: center;
		flex-wrap: nowrap;
		gap: 6px;
		flex-shrink: 0;
	}

	.lumina-split-header__brand {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 700;
		font-size: 13px;
		color: var(--text-normal);
		margin-right: 4px;
	}

	.lumina-split-pro-badge {
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.lumina-split-header__brand-icon {
		display: inline-flex;
		align-items: center;
		color: var(--interactive-accent);
	}

	.lumina-split-header__brand-icon :global(svg) {
		width: 15px;
		height: 15px;
	}

	.lumina-split-header__segmented {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 7px;
		gap: 2px;
	}

	.lumina-split-header__context-group {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.lumina-split-header__group-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		user-select: none;
		white-space: nowrap;
	}

	.lumina-split-header__seg-btn {
		all: unset;
		box-sizing: border-box;
		padding: 3px 9px;
		font-size: 11px;
		font-weight: 600;
		border-radius: 5px;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.lumina-split-header__seg-btn:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.lumina-split-header__seg-btn.is-active {
		color: var(--text-on-accent);
		background: var(--interactive-accent);
	}

	.lumina-split-header__seg-btn.is-locked,
	.lumina-split-header__add-btn.is-locked,
	.lumina-split-header__icon-btn.is-locked {
		opacity: 0.78;
	}

	.lumina-split-lock-mark {
		font-size: 10px;
		opacity: 0.85;
	}

	.lumina-split-header__add-btn {
		all: unset;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 9px;
		font-size: 11px;
		font-weight: 600;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-normal);
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.lumina-split-header__rag-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}

	.lumina-split-header__rag-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: rgb(34, 197, 94);
	}

	.lumina-split-header__rag-pct {
		font-size: 10px;
		opacity: 0.85;
	}

	@container (max-width: 980px) {
		.lumina-split-header__group-label,
		.lumina-split-header__add-label {
			display: none;
		}
	}

	@container (max-width: 780px) {
		.lumina-split-header__title {
			display: none;
		}
	}

	.lumina-split-header__add-btn:hover:not(:disabled) {
		border-color: var(--interactive-accent);
		color: var(--interactive-accent);
		background: var(--background-modifier-hover);
	}

	.lumina-split-header__add-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.lumina-split-header__icon-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.lumina-split-header__icon-inner {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.lumina-split-export-lock {
		position: absolute;
		right: 0;
		bottom: 0;
		font-size: 9px;
		line-height: 1;
		pointer-events: none;
	}

	.lumina-split-header__icon-btn:hover:not(:disabled) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border);
	}

	.lumina-split-header__icon-btn.is-active {
		color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
		border-color: color-mix(in srgb, var(--interactive-accent) 35%, transparent);
	}

	.lumina-split-header__icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.lumina-split-header__icon-btn :global(svg) {
		width: 15px;
		height: 15px;
	}

	/* 모바일 분할 채팅 헤더 패딩 및 .clickable-icon 터치 영역 보정 */
	:global(body.is-mobile) .lumina-split-header {
		padding: 6px 10px;
	}

	:global(body.is-mobile) .clickable-icon.lumina-split-header__icon-btn {
		width: 32px;
		height: 32px;
		min-width: 32px;
		min-height: 32px;
		padding: 0;
		flex-shrink: 0;
	}
</style>
