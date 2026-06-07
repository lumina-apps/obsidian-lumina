<script lang="ts">
	import { PROVIDER_LABELS } from "../../../shared/types/settings.types";
	import { setIcon } from "obsidian";
	import { tStore } from "../../../shared/locales/index";

	// props using Svelte 5 runes
	let { 
		providers, 
		selectedProviderId = $bindable(), 
		selectedModelId = $bindable(), 
		onSelect 
	} = $props();

	let isOpen = $state(false);
	let searchQuery = $state("");
	let activeIndex = $state(0);
	let containerEl: HTMLDivElement | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);

	// Flatten all models with provider details
	const allModels = $derived(
		providers.flatMap((p) =>
			p.availableModels.map((m) => ({
				providerId: p.id,
				providerType: p.type,
				providerName: PROVIDER_LABELS[p.type] || p.type,
				modelId: m,
				label: m,
				value: `${p.id}::${m}`
			}))
		)
	);

	// Filter models by search query (case-insensitive)
	const filteredModels = $derived(
		allModels.filter((item) => {
			const query = searchQuery.toLowerCase().trim();
			if (!query) return true;
			return (
				item.modelId.toLowerCase().includes(query) ||
				item.providerName.toLowerCase().includes(query)
			);
		})
	);

	const selectedModel = $derived(
		allModels.find(
			(m) => m.providerId === selectedProviderId && m.modelId === selectedModelId
		)
	);

	const currentLabel = $derived(
		selectedModel
			? `${selectedModel.providerName.replace(/\s*\(.*\)\s*/, "")} - ${selectedModel.modelId}`
			: "Select Model"
	);

	function toggleDropdown(e: MouseEvent) {
		e.stopPropagation();
		isOpen = !isOpen;
		if (isOpen) {
			searchQuery = "";
			activeIndex = 0;
			// Focus input field after it renders
			setTimeout(() => {
				inputEl?.focus();
			}, 50);
		}
	}

	function selectItem(item: typeof allModels[0]) {
		selectedProviderId = item.providerId;
		selectedModelId = item.modelId;
		isOpen = false;
		if (onSelect) {
			onSelect(item.providerId, item.modelId);
			}
		}

	// 모델이 변경될 때 해당 모델로 스크롤 이동
	$effect(() => {
		if (isOpen && selectedProviderId && selectedModelId) {
			setTimeout(() => scrollToSelected(), 50);
			}
		});

	function scrollToSelected() {
		if (!listEl || !selectedProviderId || !selectedModelId) return;
		
		const items = listEl.querySelectorAll(".lumina-model-selector__item");
		for (let i = 0; i < items.length; i++) {
			const el = items[i] as HTMLElement;
			if (el.dataset.providerId === selectedProviderId && el.dataset.modelId === selectedModelId) {
				el.scrollIntoView({ block: "nearest" });
				return;
				}
			}
		}

	function handleKeydown(e: KeyboardEvent) {
		if (!isOpen) return;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (filteredModels.length > 0) {
				activeIndex = (activeIndex + 1) % filteredModels.length;
				scrollIntoView();
			}
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (filteredModels.length > 0) {
				activeIndex = (activeIndex - 1 + filteredModels.length) % filteredModels.length;
				scrollIntoView();
			}
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (filteredModels[activeIndex]) {
				selectItem(filteredModels[activeIndex]);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			isOpen = false;
		}
	}

	function scrollIntoView() {
		if (!listEl) return;
		const activeEl = listEl.querySelector(".is-active") as HTMLElement;
		if (activeEl) {
			activeEl.scrollIntoView({ block: "nearest" });
		}
	}

	// Click outside handler to close dropdown
	function handleClickOutside(e: MouseEvent) {
		if (isOpen && containerEl && !containerEl.contains(e.target as Node)) {
			isOpen = false;
		}
	}

	$effect(() => {
		if (isOpen) {
			document.addEventListener("click", handleClickOutside);
		} else {
			document.removeEventListener("click", handleClickOutside);
		}
		return () => {
			document.removeEventListener("click", handleClickOutside);
		};
	});

	function chevronIcon(node: HTMLElement) {
		setIcon(node, "chevron-down");
	}
</script>

<div class="lumina-model-selector" bind:this={containerEl}>
	<button 
		class="lumina-model-selector__trigger" 
		onclick={toggleDropdown}
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		type="button"
	>
		<span class="lumina-model-selector__trigger-text" title={currentLabel}>{currentLabel}</span>
		<span class="lumina-model-selector__trigger-icon" use:chevronIcon></span>
	</button>

	{#if isOpen}
		<div class="lumina-model-selector__dropdown">
			<div class="lumina-model-selector__search-wrap">
				<input
					bind:this={inputEl}
					bind:value={searchQuery}
					type="text"
					class="lumina-model-selector__search"
					placeholder={$tStore('uiMessages.searchModelShort')}
					onkeydown={handleKeydown}
				/>
			</div>

			<div class="lumina-model-selector__list" bind:this={listEl}>
				{#if filteredModels.length === 0}
					<div class="lumina-model-selector__empty">{$tStore('uiMessages.noSearchResults')}</div>
				{:else}
						{#each filteredModels as item, i}
							<button
							class="lumina-model-selector__item"
							class:is-selected={item.providerId === selectedProviderId && item.modelId === selectedModelId}
							class:is-active={i === activeIndex}
							data-provider-id={item.providerId}
							data-model-id={item.modelId}
							onclick={() => selectItem(item)}
							onmouseenter={() => activeIndex = i}
							type="button"
							>
								<div class="lumina-model-selector__item-info">
									<span class="lumina-model-selector__item-badge">{item.providerName.replace(/\s*\(.*\)\s*/, "")}</span>
									<span class="lumina-model-selector__item-name">{item.modelId}</span>
								</div>
							</button>
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

	.lumina-model-selector__dropdown {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		width: 280px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: popover-fade-in 0.15s cubic-bezier(0.4, 0, 0.2, 1);
	}

	@keyframes popover-fade-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
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

	.lumina-model-selector__list {
		max-height: 220px;
		overflow-y: auto;
		padding: 4px 0;
	}

	.lumina-model-selector__list::-webkit-scrollbar {
		width: 4px;
	}

	.lumina-model-selector__list::-webkit-scrollbar-thumb {
		background: var(--background-modifier-border);
		border-radius: 2px;
	}

	.lumina-model-selector__empty {
		font-size: 11px;
		color: var(--text-muted);
		padding: 12px;
		text-align: center;
	}

	.lumina-model-selector__item {
		all: unset;
		box-sizing: border-box;
		width: 100%;
		display: flex;
		align-items: center;
		padding: 6px 12px;
		font-size: 11px;
		color: var(--text-normal);
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.lumina-model-selector__item.is-active {
		background-color: var(--background-modifier-hover);
	}

	.lumina-model-selector__item.is-selected {
		background-color: rgba(var(--color-accent-rgb, 139, 92, 246), 0.1);
		color: var(--interactive-accent);
		font-weight: 600;
	}

	.lumina-model-selector__item-info {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		overflow: hidden;
	}

	.lumina-model-selector__item-badge {
		font-size: 9px;
		font-weight: 700;
		padding: 2px 5px;
		border-radius: 4px;
		background: var(--background-secondary-alt);
		color: var(--text-muted);
		border: 1px solid var(--background-modifier-border);
		text-transform: uppercase;
		flex-shrink: 0;
	}

	.lumina-model-selector__item.is-selected .lumina-model-selector__item-badge {
		background: rgba(var(--color-accent-rgb, 139, 92, 246), 0.2);
		color: var(--interactive-accent);
		border-color: var(--interactive-accent);
	}

	.lumina-model-selector__item-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex-grow: 1;
		text-align: left;
	}
</style>
