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
				title={$tS("splitChat.modeBlindTooltip")}
				onclick={() => onChangeMode("blind")}
			>
				🎭 {$tS("splitChat.modeBlind")}
			</button>
		</div>
	</div>

	<div class="lumina-split-header__right">
		<div class="lumina-split-header__segmented" role="group" aria-label="Context mode">
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
				title={$tS("splitChat.contextWinnerTooltip")}
				onclick={() => onChangeContextMode("winner")}
			>
				🏆 {$tS("splitChat.contextWinner")}
			</button>
		</div>

		{#if isRagEnabled}
			{#if indexingState.status === "ready"}
				<span
					class="lumina-chat__rag-badge lumina-chat__rag-badge--ready"
					title={$tS("settings.rag.status.ready")}
				>
					RAG ✓
				</span>
			{:else if indexingState.status === "indexing" || indexingState.status === "loading-model"}
				<span
					class="lumina-chat__rag-badge lumina-chat__rag-badge--indexing"
					title={$tS("settings.rag.status.indexingShort")}
				>
					RAG {indexingState.status === "loading-model" ? "…" : `${indexingProgress}%`}
				</span>
			{:else}
				<span
					class="lumina-chat__rag-badge lumina-chat__rag-badge--idle"
					title={$tS("settings.rag.status.waiting")}
				>
					RAG -
				</span>
			{/if}
		{/if}

		<button
			type="button"
			class="lumina-chat__toggle-btn"
			class:is-active={useRagContext}
			class:is-disabled={!isRagEnabled}
			aria-label={$tS("settings.rag.toggleTooltip")}
			onclick={onToggleRag}
		>
			RAG
		</button>

		<button
			type="button"
			class="lumina-split-header__add-btn"
			disabled={slotCount >= maxSlots || isStreaming || !hasProvider}
			onclick={onAddSlot}
			title={slotCount >= maxSlots
				? $tS("splitChat.maxModelsReached", { max: maxSlots })
				: $tS("splitChat.addModel")}
		>
			+ {$tS("splitChat.addModel")} ({slotCount}/{maxSlots})
		</button>

		<button
			type="button"
			class="clickable-icon lumina-split-header__icon-btn"
			disabled={!hasTurns}
			aria-label={$tS("splitChat.exportComparison")}
			title={$tS("splitChat.exportComparison")}
			onclick={onExport}
			use:iconAction={"download"}
		></button>

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
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 14px;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
	}

	.lumina-split-header__left,
	.lumina-split-header__right {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
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

	.lumina-split-header__add-btn {
		all: unset;
		box-sizing: border-box;
		padding: 4px 10px;
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
</style>
