<script lang="ts">
	import { tick } from "svelte";
	import type { LLMProviderConfig, FavoriteModel } from "../../../shared/types/settings.types";
	import type { FlattenedModel } from "../../../shared/utils/modelUtils";
	import { clickOutside } from "../../../shared/utils/domUtils";
	import { useKeyboardListNav } from "./composables/useKeyboardListNav.svelte";
	import { getAllModels, filterModels } from "./composables/useModelList";
	import ModelListItems from "./components/ModelListItems.svelte";
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

	const allModels = $derived(getAllModels(providers, favoriteModels));
	const hasFavorites = $derived(allModels.some((m) => m.isFavorite));
	const filteredModels = $derived(filterModels(allModels, searchQuery));

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
		<ModelListItems
			{filteredModels}
			{hasFavorites}
			{searchQuery}
			{selectedProviderId}
			{selectedModelId}
			activeIndex={nav.activeIndex}
			isKeyboardNavigating={nav.isKeyboardNavigating}
			showCheckmark={true}
			onSelect={selectItem}
			{onToggleFavorite}
			onHoverItem={(i) => {
				if (!nav.isKeyboardNavigating) nav.setActiveIndex(i);
			}}
			onHoverMove={(i) => {
				if (!nav.isKeyboardNavigating && nav.activeIndex !== i) nav.setActiveIndex(i);
			}}
		/>
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
</style>
