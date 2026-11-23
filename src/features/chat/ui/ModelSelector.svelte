<script lang="ts">
	import { Platform } from "obsidian";
	import { tStore } from "../../../shared/locales/index";
	import type { LLMProviderConfig, FavoriteModel } from "../../../shared/types/settings.types";
	import { stripProviderSuffix, type FlattenedModel } from "../../../shared/utils/modelUtils";
	import { clickOutside, iconAction } from "../../../shared/utils/domUtils";
	import { useKeyboardListNav } from "./composables/useKeyboardListNav.svelte";
	import { getAllModels, filterModels, findSelectedModel } from "./composables/useModelList";
	import ModelListItems from "./components/ModelListItems.svelte";

	// ═══════════════════════════════════════════════════════════════════════════
	// Props (Svelte 5 runes)
	// ═══════════════════════════════════════════════════════════════════════════
	let {
		providers,
		favoriteModels = [],
		selectedProviderId = $bindable(),
		selectedModelId = $bindable(),
		dropdownAlign = "right",
		onSelect,
		onToggleFavorite,
	}: {
		providers: LLMProviderConfig[];
		favoriteModels?: FavoriteModel[];
		selectedProviderId?: string;
		selectedModelId?: string;
		dropdownAlign?: "left" | "right";
		onSelect?: (providerId: string, modelId: string) => void;
		onToggleFavorite?: (providerId: string, modelId: string) => void;
	} = $props();

	// ═══════════════════════════════════════════════════════════════════════════
	// State & Derived
	// ═══════════════════════════════════════════════════════════════════════════
	let isOpen = $state(false);
	let searchQuery = $state("");
	let mobileDropdownStyle = $state<string | undefined>(undefined);
	let containerEl: HTMLDivElement | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);

	const allModels = $derived(getAllModels(providers, favoriteModels));
	const hasFavorites = $derived(allModels.some((m) => m.isFavorite));
	const selectedModel = $derived(findSelectedModel(allModels, selectedProviderId, selectedModelId));
	const filteredModels = $derived(filterModels(allModels, searchQuery));

	const currentLabel = $derived(
		selectedModel
			? `${stripProviderSuffix(selectedModel.providerName)} - ${selectedModel.modelId}`
			: $tStore('settings.connections.apiKey.selectModel'),
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
			if (Platform.isMobile && containerEl) {
				const rect = containerEl.getBoundingClientRect();
				const top = rect.bottom > 0 ? Math.round(rect.bottom + 4) : 56;
				const viewportW = typeof window !== "undefined" ? window.innerWidth : 390;
				if (viewportW > 600) {
					// 태블릿 등 넓은 모바일 화면에서는 트리거 좌/우 기준 360px 앵커 팝오버로 표시
					const dropdownW = Math.min(360, viewportW - 24);
					const rawLeft = dropdownAlign === "left" ? rect.left : rect.right - dropdownW;
					const clampedLeft = Math.max(12, Math.min(rawLeft, viewportW - dropdownW - 12));
					mobileDropdownStyle = `top: ${top}px; left: ${Math.round(clampedLeft)}px; right: auto; width: ${dropdownW}px; max-width: calc(100vw - 24px);`;
				} else {
					mobileDropdownStyle = `top: ${top}px;`;
				}
			} else {
				mobileDropdownStyle = undefined;
			}
			searchQuery = "";
			nav.resetIndex();
			// 모바일에서는 드롭다운 오픈 시 소프트 키보드가 즉시 팝업되지 않도록 자동 포커스 생략
			if (!Platform.isMobile) {
				setTimeout(() => {
					inputEl?.focus();
				}, 50);
			}
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
		<div
			class="lumina-popup-selector lumina-model-selector__dropdown"
			class:lumina-model-selector__dropdown--left={dropdownAlign === "left"}
			style={Platform.isMobile ? mobileDropdownStyle : undefined}
		>
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
				<ModelListItems
					{filteredModels}
					{hasFavorites}
					{searchQuery}
					{selectedProviderId}
					{selectedModelId}
					activeIndex={nav.activeIndex}
					isKeyboardNavigating={nav.isKeyboardNavigating}
					onSelect={selectItem}
					{onToggleFavorite}
					onHoverItem={(i) => nav.setActiveIndex(i)}
				/>
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

	.lumina-model-selector__dropdown--left {
		left: 0;
		right: auto;
	}

	:global(body.is-mobile) .lumina-model-selector__dropdown,
	:global(body.is-mobile) .lumina-model-selector__dropdown--left {
		position: fixed;
		left: 12px;
		right: 12px;
		width: auto;
		max-width: none;
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

	/* 모바일(폰+태블릿) 모델 선택기 축소 허용 및 좁은 컨테이너(<= 520px) 전체 폭 확장 */
	:global(body.is-mobile) .lumina-model-selector {
		min-width: 0;
		max-width: 100%;
	}

	@container (max-width: 520px) {
		:global(body.is-mobile) .lumina-model-selector {
			width: 100%;
		}
	}

	:global(body.is-mobile) .lumina-model-selector__trigger {
		min-height: 28px;
		padding: 5px 10px;
		font-size: 11.5px;
	}
</style>