<script lang="ts">
	import { tStore } from "../../../shared/locales/index";
	import type { LLMProviderConfig, FavoriteModel } from "../../../shared/types/settings.types";
	import {
		flattenProviderModels,
		stripProviderSuffix,
		sortWithFavorites,
	} from "../../../shared/utils/modelUtils";
	import { clickOutside, iconAction } from "../../../shared/utils/domUtils";
	import { useKeyboardListNav } from "./composables/useKeyboardListNav";
	import type { FlattenedModel } from "../../../shared/utils/modelUtils";

	// ═══════════════════════════════════════════════════════════════════════════
	// Props (Svelte 5 runes)
	// ═══════════════════════════════════════════════════════════════════════════
	let {
		providers,
		favoriteModels = [],
		selectedProviderId = $bindable(),
		selectedModelId = $bindable(),
		onSelect,
		onToggleFavorite,
	}: {
		providers: LLMProviderConfig[];
		favoriteModels?: FavoriteModel[];
		selectedProviderId?: string;
		selectedModelId?: string;
		onSelect?: (providerId: string, modelId: string) => void;
		onToggleFavorite?: (providerId: string, modelId: string) => void;
	} = $props();

	// ═══════════════════════════════════════════════════════════════════════════
	// State
	// ═══════════════════════════════════════════════════════════════════════════
	let isOpen = $state(false);
	let searchQuery = $state("");
	let containerEl: HTMLDivElement | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);

	// ═══════════════════════════════════════════════════════════════════════════
	// Derived: flat model list (via modelUtils)
	// ═══════════════════════════════════════════════════════════════════════════
	const allModels = $derived(sortWithFavorites(flattenProviderModels(providers, favoriteModels)));
	const hasFavorites = $derived(allModels.some((m) => m.isFavorite));

	const selectedModel = $derived(
		allModels.find(
			(m) => m.providerId === selectedProviderId && m.modelId === selectedModelId,
		),
	);

	const currentLabel = $derived(
		selectedModel
			? `${stripProviderSuffix(selectedModel.providerName)} - ${selectedModel.modelId}`
			: $tStore('settings.connections.apiKey.selectModel'),
	);

	// Filter models by search query (case-insensitive)
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
		isOpen: () => isOpen,
		itemCount: () => filteredModels.length,
		onSelect: (index: number) => {
			const item = filteredModels[index];
			if (item) selectItem(item);
		},
		onClose: () => {
			isOpen = false;
		},
		getActiveIndex: () => activeIndex,
		setActiveIndex: (val) => { activeIndex = val; },
		getIsKeyboardNavigating: () => isKeyboardNavigating,
		setIsKeyboardNavigating: (val) => { isKeyboardNavigating = val; },
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// Dropdown open/close management
	// ═══════════════════════════════════════════════════════════════════════════
	function toggleDropdown(e: MouseEvent) {
		e.stopPropagation();
		isOpen = !isOpen;
		if (isOpen) {
			searchQuery = "";
			nav.resetIndex();
			setTimeout(() => {
				inputEl?.focus();
			}, 50);
		}
	}

	function closeDropdown() {
		isOpen = false;
	}

	function selectItem(item: FlattenedModel) {
		selectedProviderId = item.providerId;
		selectedModelId = item.modelId;
		isOpen = false;
		onSelect?.(item.providerId, item.modelId);
	}

	// Scroll to the currently selected model when dropdown opens
	$effect(() => {
		if (isOpen && selectedProviderId && selectedModelId) {
			setTimeout(() => scrollToSelected(), 50);
		}
	});

	function scrollToSelected() {
		if (!listEl || !selectedProviderId || !selectedModelId) return;
		const items = listEl.querySelectorAll(".lumina-popup-selector__item");
		for (let i = 0; i < items.length; i++) {
			const el = items[i] as HTMLElement;
			if (
				el.dataset.providerId === selectedProviderId &&
				el.dataset.modelId === selectedModelId
			) {
				el.scrollIntoView({ block: "nearest" });
				return;
			}
		}
	}

	// Keyboard → scroll to active element + nav handling
	function onKeydown(e: KeyboardEvent) {
		nav.handleKeydown(e);
		nav.scrollToActive(listEl);
	}
</script>

<div class="lumina-model-selector" bind:this={containerEl} use:clickOutside={closeDropdown}>
	<button
		class="lumina-model-selector__trigger"
		onclick={toggleDropdown}
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		type="button"
	>
		<span class="lumina-model-selector__trigger-text" title={currentLabel}>{currentLabel}</span>
		<span class="lumina-model-selector__trigger-icon" use:iconAction={"chevron-down"}></span>
	</button>

	{#if isOpen}
		<div class="lumina-popup-selector lumina-model-selector__dropdown">
			<div class="lumina-model-selector__search-wrap">
				<input
					bind:this={inputEl}
					bind:value={searchQuery}
					type="text"
					class="lumina-model-selector__search"
					placeholder={$tStore('uiMessages.searchModelShort')}
					onkeydown={onKeydown}
				/>
			</div>

			<div class="lumina-popup-selector__list lumina-scrollbar-thin" bind:this={listEl}>
				{#if filteredModels.length === 0}
					<div class="lumina-popup-selector__empty">{$tStore('uiMessages.noSearchResults')}</div>
				{:else}
					{#each filteredModels as item, i}
						{#if !searchQuery && hasFavorites}
							{#if i === 0 && item.isFavorite}
								<div class="lumina-popup-selector__section-header">
									<span class="lumina-popup-selector__section-icon" use:iconAction={"star"}></span>
									{$tStore('uiMessages.favorites')}
								</div>
							{:else if !item.isFavorite && (i === 0 || filteredModels[i - 1].isFavorite)}
								<div class="lumina-popup-selector__section-header lumina-popup-selector__section-divider">
									{$tStore('uiMessages.allModels')}
								</div>
							{/if}
						{/if}
						<div
							class="lumina-popup-selector__item"
							class:is-selected={item.providerId === selectedProviderId && item.modelId === selectedModelId}
							class:is-active={i === nav.activeIndex}
							data-provider-id={item.providerId}
							data-model-id={item.modelId}
							role="button"
							tabindex="0"
							onclick={() => selectItem(item)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									selectItem(item);
								}
							}}
							onmouseenter={() => nav.setActiveIndex(i)}
						>
							<div class="lumina-popup-selector__item-info" style="flex-direction: row; align-items: center; gap: 8px;">
								<span class="lumina-popup-selector__item-badge">
									{stripProviderSuffix(item.providerName)}
								</span>
								<span class="lumina-popup-selector__item-name">{item.modelId}</span>
							</div>
							<div class="lumina-model-selector__actions">
								<button
									type="button"
									class="lumina-popup-selector__fav-btn"
									class:is-favorite={item.isFavorite}
									aria-label={item.isFavorite ? $tStore('uiMessages.removeFromFavorites') : $tStore('uiMessages.addToFavorites')}
									title={item.isFavorite ? $tStore('uiMessages.removeFromFavorites') : $tStore('uiMessages.addToFavorites')}
									onclick={(e) => {
										e.stopPropagation();
										onToggleFavorite?.(item.providerId, item.modelId);
									}}
								>
									<span use:iconAction={"star"}></span>
								</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.lumina-model-selector {
		position: relative;
		display: inline-block;
		width: 140px;
	}

	.lumina-model-selector__trigger {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		font-size: 11px;
		font-weight: 600;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-normal);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-model-selector__trigger:hover {
		border-color: var(--background-modifier-border-hover);
		background-color: var(--background-secondary-alt);
	}

	.lumina-model-selector__trigger-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-right: 4px;
		flex-grow: 1;
		text-align: left;
	}

	.lumina-model-selector__trigger-icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.lumina-model-selector__trigger-icon :global(svg) {
		width: 12px;
		height: 12px;
	}

	/* Overriding default popup selector for model selector dropdown */
	.lumina-model-selector__dropdown {
		top: calc(100% + 4px);
		bottom: auto;
		right: 0;
		left: auto;
		width: 360px;
		max-width: calc(100vw - 32px);
		padding: 0;
		z-index: 100;
	}

	.lumina-model-selector__search-wrap {
		padding: 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}

	.lumina-model-selector__search {
		width: 100%;
		font-size: 11px;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-normal);
		outline: none;
		box-sizing: border-box;
	}

	.lumina-model-selector__search:focus {
		border-color: var(--interactive-accent);
	}

	.lumina-model-selector__actions {
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

	.lumina-popup-selector__item.is-selected {
		background-color: rgba(var(--color-accent-rgb, 139, 92, 246), 0.1);
		color: var(--interactive-accent);
		font-weight: 600;
	}

	.lumina-popup-selector__item.is-selected .lumina-popup-selector__item-badge {
		background: rgba(var(--color-accent-rgb, 139, 92, 246), 0.2);
		color: var(--interactive-accent);
		border-color: var(--interactive-accent);
	}
</style>