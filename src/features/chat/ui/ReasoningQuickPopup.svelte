<script lang="ts">
	import type { Readable } from "svelte/store";
	import type { TranslationKeys } from "../../../shared/locales/locale.types";
	import type { ReasoningEffort } from "../../../shared/types/llm.types";
	import type { ProviderType } from "../../../shared/types/settings.types";
	import { iconAction, clickOutside } from "../../../shared/utils/domUtils";
	import {
		describeEffectiveReasoning,
		getModelReasoningSupport,
	} from "../../../core/llm-providers/reasoning-config";

	type TStore = Readable<
		(key: TranslationKeys, params?: Record<string, string | number>) => string
	>;

	const EFFORT_LEVELS: readonly ReasoningEffort[] = ["auto", "off", "low", "medium", "high"];

	let {
		tStore,
		currentEffort,
		budgetTokens = 0,
		providerType,
		modelId,
		isSplitMode = false,
		onSelect,
		onClose,
		onOpenSettings,
	}: {
		tStore: TStore;
		currentEffort: ReasoningEffort;
		budgetTokens?: number;
		providerType?: ProviderType;
		modelId?: string;
		isSplitMode?: boolean;
		onSelect: (effort: ReasoningEffort) => void;
		onClose: (focusTextarea?: boolean) => void;
		onOpenSettings: () => void;
	} = $props();

	const support = $derived(getModelReasoningSupport(providerType, modelId));
	const effectiveDesc = $derived(
		describeEffectiveReasoning(providerType, modelId, currentEffort, budgetTokens),
	);
	const showIgnoredBudgetHint = $derived(
		!isSplitMode &&
			budgetTokens > 0 &&
			(currentEffort === "low" || currentEffort === "medium" || currentEffort === "high") &&
			support.supported &&
			!support.supportsCustomBudget,
	);

	function handleGlobalKeydown(e: KeyboardEvent): void {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			onClose(true);
		}
	}

	$effect(() => {
		activeDocument.addEventListener("keydown", handleGlobalKeydown, true);
		return () => {
			activeDocument.removeEventListener("keydown", handleGlobalKeydown, true);
		};
	});
</script>

<div class="lumina-reasoning-popup" use:clickOutside={() => onClose(false)}>
	<div class="lumina-reasoning-popup__header">
		<span class="lumina-reasoning-popup__title">
			{$tStore("settings.chat.reasoning.popupTitle")}
		</span>
		<button
			class="lumina-reasoning-popup__btn-settings"
			onclick={onOpenSettings}
			title={$tStore("common.settings")}
			aria-label={$tStore("common.settings")}
			type="button"
		>
			<span use:iconAction={"settings"}></span>
		</button>
	</div>

	<div class="lumina-reasoning-popup__body">
		<div class="lumina-reasoning-popup__segments" role="radiogroup" aria-label={$tStore("settings.chat.reasoning.popupTitle")}>
			{#each EFFORT_LEVELS as level}
				<button
					type="button"
					role="radio"
					aria-checked={currentEffort === level}
					class="lumina-reasoning-popup__seg-btn"
					class:is-active={currentEffort === level}
					onclick={() => onSelect(level)}
				>
					{$tStore(`settings.chat.reasoning.short.${level}` as TranslationKeys)}
				</button>
			{/each}
		</div>

		<div class="lumina-reasoning-popup__summary">
			{#if isSplitMode}
				{$tStore("settings.chat.reasoning.summarySplitMulti")}
			{:else}
				{$tStore(
					`settings.chat.reasoning.${effectiveDesc.key}` as TranslationKeys,
					effectiveDesc.params,
				)}
			{/if}
		</div>

		{#if showIgnoredBudgetHint}
			<div class="lumina-reasoning-popup__hint">
				{$tStore("settings.chat.reasoning.manualBudgetIgnoredHint")}
			</div>
		{/if}
	</div>
</div>

<style>
	.lumina-reasoning-popup {
		position: absolute;
		bottom: 100%;
		left: 0;
		width: 280px;
		margin-bottom: 8px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: lumina-popover-fade-in 0.15s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.lumina-reasoning-popup__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-reasoning-popup__title {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.lumina-reasoning-popup__btn-settings {
		all: unset;
		cursor: pointer;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		padding: 2px;
		border-radius: 4px;
		transition: color 0.1s;
	}

	.lumina-reasoning-popup__btn-settings:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.lumina-reasoning-popup__btn-settings :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-reasoning-popup__body {
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-reasoning-popup__segments {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 4px;
	}

	.lumina-reasoning-popup__seg-btn {
		padding: 5px 4px;
		font-size: 11px;
		font-weight: 600;
		border-radius: 5px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-muted);
		cursor: pointer;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: all 0.15s ease;
	}

	.lumina-reasoning-popup__seg-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-reasoning-popup__seg-btn.is-active {
		background: rgba(var(--color-accent-rgb, 139, 92, 246), 0.15);
		color: var(--interactive-accent);
		border-color: var(--interactive-accent);
	}

	.lumina-reasoning-popup__summary {
		font-size: 11px;
		line-height: 1.4;
		color: var(--text-muted);
	}

	.lumina-reasoning-popup__hint {
		font-size: 10.5px;
		line-height: 1.35;
		color: var(--text-faint);
	}

	:global(body.is-mobile) .lumina-reasoning-popup {
		max-width: 100%;
		box-sizing: border-box;
	}

	:global(body.is-mobile) .lumina-reasoning-popup__seg-btn {
		min-height: 30px;
		font-size: 11.5px;
	}

	@container (max-width: 520px) {
		:global(body.is-mobile) .lumina-reasoning-popup {
			left: 0;
			right: 0;
			width: 100%;
		}
	}
</style>
