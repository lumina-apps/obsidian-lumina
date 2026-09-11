<script lang="ts">
	import { tick } from "svelte";
	import type { LLMProviderConfig, FavoriteModel } from "../../../shared/types/settings.types";
	import {
		flattenProviderModels,
		stripProviderSuffix,
		sortWithFavorites,
	} from "../../../shared/utils/modelUtils";
	import type { FlattenedModel } from "../../../shared/utils/modelUtils";
	import { clickOutside, iconAction } from "../../../shared/utils/domUtils";
	import { useKeyboardListNav } from "./composables/useKeyboardListNav";
	import { tStore } from "../../../shared/locales/index";

	// ═══════════════════════════════════════════════════════════════════════════
	// Props (Svelte 5 runes)
	// ═══════════════════════════════════════════════════════════════════════════
	let {
		providers,
		favoriteModels = [],
		selectedProviderId,
		selectedModelId,
		onSelect,
		onToggleFavorite,
		onClose,
	}: {
		providers: LLMProviderConfig[];
		favoriteModels?: FavoriteModel[];
		selectedProviderId: string;
		selectedModelId: string;
		onSelect: (providerId: string, modelId: string) => void;
		onToggleFavorite?: (providerId: string, modelId: string) => void;
		onClose: (focusTextarea?: boolean) => void;
	} = $props();

	// ═══════════════════════════════════════════════════════════════════════════
	// State
	// ═══════════════════════════════════════════════════════════════════════════
	let containerEl: HTMLDivElement | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);
	let searchQuery = $state("");

	// ═══════════════════════════════════════════════════════════════════════════
	// Derived: flat model list (via modelUtils)
	// ═══════════════════════════════════════════════════════════════════════════
	const allModels = $derived(sortWithFavorites(flattenProviderModels(providers, favoriteModels)));
	const hasFavorites = $derived(allModels.some((m) => m.isFavorite));

	const filteredModels = $derived(
		allModels.filter((item) => {
			const query = searchQuery.toLowerCase().trim();
			if (!query) return true;
			return (
				item.modelId.toLowerCase().includes(query) ||
				stripProviderSuffix(item.providerName).toLowerCase().includes(query)
			);
		}),
	);

	let activeIndex = $state(0);
	let isKeyboardNavigating = $state(false);

	const nav = useKeyboardListNav({
		isOpen: () => true,
		itemCount: () => filteredModels.length,
		onSelect: (index: number) => {
			const item = filteredModels[index];
			if (item) selectItem(item);
		},
		onClose: () => onClose(true),
		enableMouseConflict: true,
		getActiveIndex: () => activeIndex,
		setActiveIndex: (val) => { activeIndex = val; },
		getIsKeyboardNavigating: () => isKeyboardNavigating,
		setIsKeyboardNavigating: (val) => { isKeyboardNavigating = val; },
	});

	function selectItem(item: FlattenedModel) {
		onSelect(item.providerId, item.modelId);
		onClose(true);
	}

	// 오픈 시 검색창에 포커스
	$effect(() => {
		void tick().then(() => inputEl?.focus());
	});

	// Global keydown capture (팝업이 열려 있는 동안 키보드 네비게이션 처리)
	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.isComposing && e.key === "Enter") return; // IME 조합 Enter 무시
		if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
			e.stopPropagation();
		}
		nav.handleKeydown(e);
		nav.scrollToActive(listEl);
	}

	$effect(() => {
		activeDocument.addEventListener("keydown", handleGlobalKeydown, true);
		return () => {
			activeDocument.removeEventListener("keydown", handleGlobalKeydown, true);
		};
	});

	// 검색어 변경 시 activeIndex 리셋
	$effect(() => {
		searchQuery;
		nav.resetIndex();
	});
</script>

<div
	class="lumina-model-picker"
	bind:this={containerEl}
	use:clickOutside={() => onClose(false)}
>
	<div class="lumina-model-picker__search-wrap">
		<input
			bind:this={inputEl}
			bind:value={searchQuery}
			type="text"
			class="lumina-model-picker__search"
			placeholder={$tStore("uiMessages.searchModelShort")}
			onkeydown={nav.handleKeydown}
		/>
	</div>

	<div class="lumina-popup-selector__list lumina-scrollbar-thin" bind:this={listEl} role="listbox">
		{#if filteredModels.length === 0}
			<div class="lumina-popup-selector__empty">{$tStore("uiMessages.noSearchResults")}</div>
		{:else}
			{#each filteredModels as item, i}
				{#if !searchQuery && hasFavorites}
					{#if i === 0 && item.isFavorite}
						<div class="lumina-popup-selector__section-header">
							<span class="lumina-popup-selector__section-icon" use:iconAction={"star"}></span>
							{$tStore("uiMessages.favorites")}
						</div>
					{:else if !item.isFavorite && (i === 0 || filteredModels[i - 1].isFavorite)}
						<div class="lumina-popup-selector__section-header lumina-popup-selector__section-divider">
							{$tStore("uiMessages.allModels")}
						</div>
					{/if}
				{/if}
				<div
					class="lumina-popup-selector__item"
					class:is-active={i === nav.activeIndex}
					class:is-selected={item.providerId === selectedProviderId && item.modelId === selectedModelId}
					role="option"
					aria-selected={i === nav.activeIndex}
					tabindex="-1"
					onclick={() => selectItem(item)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							selectItem(item);
						}
					}}
					onmouseenter={() => {
						if (!nav.isKeyboardNavigating) nav.setActiveIndex(i);
					}}
					onmousemove={() => {
						if (!nav.isKeyboardNavigating && nav.activeIndex !== i) nav.setActiveIndex(i);
					}}
				>
					<div
						class="lumina-popup-selector__item-info"
						style="flex-direction: row; align-items: center; gap: 8px;"
					>
						<span class="lumina-popup-selector__item-badge">
							{stripProviderSuffix(item.providerName)}
						</span>
						<span class="lumina-popup-selector__item-name">{item.modelId}</span>
					</div>
					<div class="lumina-model-picker__actions">
						<button
							type="button"
							class="lumina-popup-selector__fav-btn"
							class:is-favorite={item.isFavorite}
							aria-label={item.isFavorite ? $tStore("uiMessages.removeFromFavorites") : $tStore("uiMessages.addToFavorites")}
							title={item.isFavorite ? $tStore("uiMessages.removeFromFavorites") : $tStore("uiMessages.addToFavorites")}
							onclick={(e) => {
								e.stopPropagation();
								onToggleFavorite?.(item.providerId, item.modelId);
							}}
						>
							<span use:iconAction={"star"}></span>
						</button>
						{#if item.providerId === selectedProviderId && item.modelId === selectedModelId}
							<span class="lumina-model-picker__check" use:iconAction={"check"}></span>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.lumina-model-picker {
		position: absolute;
		bottom: 100%;
		left: 0;
		width: 360px;
		max-width: calc(100vw - 32px);
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

	.lumina-model-picker__search-wrap {
		padding: 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}

	.lumina-model-picker__search {
		width: 100%;
		font-size: 12px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-normal);
		outline: none;
		transition: border-color 0.15s ease;
		box-sizing: border-box;
	}

	.lumina-model-picker__search:focus {
		border-color: var(--interactive-accent);
	}

	.lumina-model-picker__actions {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
		flex-shrink: 0;
	}

	.lumina-popup-selector__fav-btn {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: 4px;
		color: var(--text-muted);
		cursor: pointer;
		opacity: 0.4;
		transition: all 0.15s ease;
	}

	.lumina-popup-selector__fav-btn:hover {
		opacity: 1;
		color: var(--text-warning, #e5a00d);
		background-color: var(--background-modifier-hover);
	}

	.lumina-popup-selector__fav-btn.is-favorite {
		opacity: 1;
		color: var(--text-warning, #e5a00d);
	}

	.lumina-popup-selector__fav-btn.is-favorite:hover {
		color: var(--text-muted);
	}

	.lumina-popup-selector__fav-btn :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-popup-selector__section-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		user-select: none;
	}

	.lumina-popup-selector__section-icon :global(svg) {
		width: 12px;
		height: 12px;
		color: var(--text-warning, #e5a00d);
	}

	.lumina-popup-selector__section-divider {
		margin-top: 4px;
		border-top: 1px solid var(--background-modifier-border);
		padding-top: 8px;
	}

	.lumina-model-picker__check {
		display: flex;
		align-items: center;
		color: var(--interactive-accent);
		flex-shrink: 0;
	}

	.lumina-model-picker__check :global(svg) {
		width: 14px;
		height: 14px;
	}
</style>
