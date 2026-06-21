<script lang="ts">
	import { setIcon } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import type { TFile } from "obsidian";
	import { tick } from "svelte";
	import { tStore } from "../../../shared/locales/index";
	import { getAttachmentIcon } from "../utils/fileAttachmentUtils";
	import {
		buildCategoryContext,
		buildCategories,
		filterCategories,
		isImmediateCategory,
		type CategoryItem,
	} from "./lib/contextSelector/categories";
	import {
		buildCategoryItems,
		filterItems,
	} from "./lib/contextSelector/items";
	import { useKeyboardNav } from "./lib/contextSelector/keyboardNav.svelte.ts";

	let {
		plugin,
		searchQuery = "",
		onSelect,
		onClose
	} = $props<{
		plugin: LuminaPlugin;
		searchQuery: string;
		onSelect: (attachment: ContextAttachment) => void;
		onClose: (focusTextarea?: boolean) => void;
	}>();

	let containerEl: HTMLDivElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);
	let urlInputEl: HTMLInputElement | null = $state(null);
	let urlText = $state("");

	// Navigation state: 'categories' | 'items' | 'url_input'
	let view = $state<"categories" | "items" | "url_input">("categories");
	let activeCategory = $state<string | null>(null);

	// ── Category context (built once, reused) ─────────────────────────────────
	const context = $derived(buildCategoryContext(plugin));
	const files: TFile[] = $derived(context.files);
	const tagsInfo = $derived(context.tagsInfo);

	// ── Category definitions ──────────────────────────────────────────────────
	const categories = $derived(
		buildCategories(context, (key) => $tStore(key)),
	);

	// ── Category filtering ────────────────────────────────────────────────────
	const filteredCategories = $derived(
		filterCategories(categories, searchQuery),
	);

	// ── Items for selected category ───────────────────────────────────────────
	const categoryItems = $derived.by(() => {
		if (!activeCategory) return [];
		const items = buildCategoryItems(
			activeCategory,
			files,
			tagsInfo,
			plugin,
			(key, vars) => $tStore(key, vars as Record<string, string>),
		);
		return filterItems(items, searchQuery);
	});

	// Total selectable items count (categories or items depending on view)
	const selectableCount = $derived(
		view === "categories" ? filteredCategories.length : categoryItems.length,
	);

	// ── Actions ───────────────────────────────────────────────────────────────
	function selectCategory(cat: CategoryItem) {
		if (cat.id === "url") {
			view = "url_input";
			activeCategory = "url";
			urlText = searchQuery;
			nav.resetIndex();
			tick().then(() => urlInputEl?.focus());
			return;
		}

		// For single-item categories (active_note, selection), select immediately
		if (isImmediateCategory(cat.id)) {
			const items = buildCategoryItems(
				cat.id,
				files,
				tagsInfo,
				plugin,
				(key, vars) => $tStore(key, vars as Record<string, string>),
			);
			if (items.length > 0) {
				selectItem(items[0]);
				return;
			}
		}

		// Navigate to items view
		view = "items";
		activeCategory = cat.id;
		nav.resetIndex();
	}

	function goBack() {
		view = "categories";
		activeCategory = null;
		nav.resetIndex();
	}

	function selectItem(item: ContextAttachment) {
		onSelect(item);
		onClose();
	}

	function isValidUrl(text: string): boolean {
		try {
			const url = new URL(text);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	}

	function submitUrl() {
		const trimmed = urlText.trim();
		if (!trimmed) return;

		if (!isValidUrl(trimmed)) {
			// Try prepending https:// only if the text doesn't already look like a URL
			if (!trimmed.includes("://")) {
				const withHttps = `https://${trimmed}`;
				if (isValidUrl(withHttps)) {
					urlText = withHttps;
					return;
				}
			}
			return;
		}

		selectItem({
			type: "url",
			path: trimmed,
			name: trimmed,
		});
	}

	function handleUrlKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			submitUrl();
		} else if (e.key === "Escape") {
			e.preventDefault();
			view = "categories";
			activeCategory = null;
		}
	}

	// ── Icon helper ───────────────────────────────────────────────────────────
	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
	}

	// ── Keyboard handling (using Runes composable) ─────────────────────────────
	function handleSelectCurrent() {
		if (view === "categories") {
			const cat = filteredCategories[nav.activeIndex];
			if (cat) selectCategory(cat);
		} else if (view === "items") {
			const item = categoryItems[nav.activeIndex];
			if (item) selectItem(item);
		}
	}

	function handleEscape() {
		if (view === "items") {
			goBack();
		} else {
			onClose(true);
		}
	}

	function handleBack() {
		if (view === "items" && !searchQuery) {
			goBack();
		}
	}

	let activeIndex = $state(0);
	let isKeyboardNavigating = $state(false);

	const nav = useKeyboardNav({
		selectableCount: () => selectableCount,
		onSelectCurrent: handleSelectCurrent,
		onEscape: handleEscape,
		onBack: handleBack,
		scrollIntoView: () => nav.scrollActiveIntoView(listEl),
		enableMouseConflict: true,
		getActiveIndex: () => activeIndex,
		setActiveIndex: (val) => { activeIndex = val; },
		getIsKeyboardNavigating: () => isKeyboardNavigating,
		setIsKeyboardNavigating: (val) => { isKeyboardNavigating = val; },
	});

	function handleClickOutside(e: MouseEvent) {
		if (containerEl && !containerEl.contains(e.target as Node)) {
			onClose(false);
		}
	}

	$effect(() => {
		activeDocument.addEventListener("click", handleClickOutside);
		const onGlobalKeydown = (e: KeyboardEvent) => {
			if (view === "url_input") return;
			nav.handleKeydown(e);
		};
		activeDocument.addEventListener("keydown", onGlobalKeydown, true);
		return () => {
			activeDocument.removeEventListener("click", handleClickOutside);
			activeDocument.removeEventListener("keydown", onGlobalKeydown, true);
		};
	});

	$effect(() => {
		// Reset active index when search query or view changes
		searchQuery;
		view;
		nav.resetIndex();
	});

	// ── Check for URL pattern on search query ─────────────────────────────────
	$effect(() => {
		const q = searchQuery.trim();
		if (view === "categories" && (q.startsWith("http://") || q.startsWith("https://"))) {
			// Auto-switch to URL input mode
			view = "url_input";
			activeCategory = "url";
			urlText = q;
			tick().then(() => urlInputEl?.focus());
		}
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="lumina-context-selector" bind:this={containerEl} onclick={(e) => e.stopPropagation()}>
	{#if view === 'categories'}
		<div class="lumina-context-selector__header">
			<span class="lumina-context-selector__header-title">{$tStore('settings.chat.context.categoryTitle')}</span>
		</div>
		<div class="lumina-context-selector__list" bind:this={listEl}>
			{#if filteredCategories.length === 0}
				<div class="lumina-context-selector__empty">{$tStore('uiMessages.noSearchResults')}</div>
			{:else}
				{#each filteredCategories as cat, i}
					<button
						class="lumina-context-selector__item lumina-context-selector__item--category"
						class:is-active={i === nav.activeIndex}
						onclick={() => selectCategory(cat)}
						onmouseenter={() => { if (!nav.isKeyboardNavigating) nav.activeIndex = i; }}
						onmousemove={() => { if (!nav.isKeyboardNavigating && nav.activeIndex !== i) nav.activeIndex = i; }}
						type="button"
					>
						<span class="lumina-context-selector__item-icon" use:icon={cat.icon}></span>
						<div class="lumina-context-selector__item-info">
							<span class="lumina-context-selector__item-name">{cat.label}</span>
						</div>
						<span class="lumina-context-selector__item-arrow">→</span>
					</button>
				{/each}
			{/if}
		</div>
	{:else if view === 'items'}
		<div class="lumina-context-selector__header">
			<button class="lumina-context-selector__back-btn" onclick={goBack} type="button">
				<span use:icon={"arrow-left"}></span>
				<span>{$tStore('settings.chat.context.categoryBack')}</span>
			</button>
		</div>
		<div class="lumina-context-selector__list" bind:this={listEl}>
			{#if categoryItems.length === 0}
				<div class="lumina-context-selector__empty">{$tStore('uiMessages.noSearchResults')}</div>
			{:else}
				{#each categoryItems as item, i}
					<button
						class="lumina-context-selector__item"
						class:is-active={i === nav.activeIndex}
						onclick={() => selectItem(item)}
						onmouseenter={() => { if (!nav.isKeyboardNavigating) nav.activeIndex = i; }}
						onmousemove={() => { if (!nav.isKeyboardNavigating && nav.activeIndex !== i) nav.activeIndex = i; }}
						type="button"
					>
						<span class="lumina-context-selector__item-icon" use:icon={getAttachmentIcon(item.type)}></span>
						<div class="lumina-context-selector__item-info">
							<span class="lumina-context-selector__item-name">{item.name}</span>
							{#if item.type === 'file' || item.type === 'folder' || item.type === 'canvas'}
								<span class="lumina-context-selector__item-path">{item.path}</span>
							{/if}
						</div>
						<span class="lumina-context-selector__item-badge">{item.type}</span>
					</button>
				{/each}
			{/if}
		</div>
	{:else if view === 'url_input'}
		<div class="lumina-context-selector__url-input-area">
			<div class="lumina-context-selector__header">
				<button class="lumina-context-selector__back-btn" onclick={() => { view = 'categories'; activeCategory = null; }} type="button">
					<span use:icon={"arrow-left"}></span>
					<span>{$tStore('settings.chat.context.categoryBack')}</span>
				</button>
			</div>
			<div class="lumina-context-selector__url-input-wrap">
				<span class="lumina-context-selector__url-icon" use:icon={"globe"}></span>
				<input
					bind:this={urlInputEl}
					type="url"
					class="lumina-context-selector__url-input"
					bind:value={urlText}
					placeholder={$tStore('settings.chat.context.urlInputPlaceholder')}
					onkeydown={handleUrlKeydown}
				/>
				<button class="lumina-context-selector__url-submit" onclick={submitUrl} type="button" aria-label="Submit URL">
					<span use:icon={"corner-down-right"}></span>
				</button>
			</div>
			<div class="lumina-context-selector__url-hint">{$tStore('settings.chat.context.urlInputPrompt')}</div>
		</div>
	{/if}
</div>

<style>
	.lumina-context-selector {
		position: absolute;
		bottom: 100%;
		left: 0;
		width: 340px;
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
		animation: popover-fade-in 0.15s cubic-bezier(0.4, 0, 0.2, 1);
	}

	@keyframes popover-fade-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.lumina-context-selector__header {
		padding: 8px 12px 4px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-context-selector__header-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.lumina-context-selector__back-btn {
		all: unset;
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-muted);
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
		transition: color 0.1s, background-color 0.1s;
	}

	.lumina-context-selector__back-btn:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.lumina-context-selector__back-btn :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-context-selector__list {
		max-height: 280px;
		overflow-y: auto;
		padding: 4px 0;
	}

	.lumina-context-selector__list::-webkit-scrollbar {
		width: 4px;
	}

	.lumina-context-selector__list::-webkit-scrollbar-thumb {
		background: var(--background-modifier-border);
		border-radius: 2px;
	}

	.lumina-context-selector__empty {
		font-size: 12px;
		color: var(--text-muted);
		padding: 12px;
		text-align: center;
	}

	.lumina-context-selector__item {
		all: unset;
		box-sizing: border-box;
		width: 100%;
		display: flex;
		align-items: center;
		padding: 8px 12px;
		font-size: 12px;
		color: var(--text-normal);
		cursor: pointer;
		transition: background-color 0.1s ease;
		gap: 10px;
	}

	.lumina-context-selector__item--category {
		padding: 10px 12px;
	}

	.lumina-context-selector__item.is-active {
		background-color: var(--background-modifier-hover);
	}

	.lumina-context-selector__item-icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.lumina-context-selector__item-icon :global(svg) {
		width: 16px;
		height: 16px;
	}

	.lumina-context-selector__item.is-active .lumina-context-selector__item-icon {
		color: var(--interactive-accent);
	}

	.lumina-context-selector__item-info {
		display: flex;
		flex-direction: column;
		flex-grow: 1;
		overflow: hidden;
		gap: 2px;
	}

	.lumina-context-selector__item-name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-context-selector__item-path {
		font-size: 10px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-context-selector__item-badge {
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

	.lumina-context-selector__item-arrow {
		font-size: 14px;
		color: var(--text-faint);
		flex-shrink: 0;
		margin-left: auto;
	}

	.lumina-context-selector__item.is-active .lumina-context-selector__item-arrow {
		color: var(--interactive-accent);
	}

	/* URL Input Area */
	.lumina-context-selector__url-input-area {
		padding: 4px 0;
	}

	.lumina-context-selector__url-input-wrap {
		display: flex;
		align-items: center;
		padding: 8px 12px;
		gap: 8px;
	}

	.lumina-context-selector__url-icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.lumina-context-selector__url-icon :global(svg) {
		width: 16px;
		height: 16px;
	}

	.lumina-context-selector__url-input {
		flex-grow: 1;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 12px;
		color: var(--text-normal);
		background: var(--background-secondary);
		outline: none;
	}

	.lumina-context-selector__url-input:focus {
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 1px var(--interactive-accent);
	}

	.lumina-context-selector__url-input::placeholder {
		color: var(--text-muted);
	}

	.lumina-context-selector__url-submit {
		all: unset;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-muted);
		flex-shrink: 0;
		transition: color 0.1s, background-color 0.1s;
	}

	.lumina-context-selector__url-submit:hover {
		color: var(--interactive-accent);
		background: var(--background-modifier-hover);
	}

	.lumina-context-selector__url-submit :global(svg) {
		width: 16px;
		height: 16px;
	}

	.lumina-context-selector__url-hint {
		font-size: 10px;
		color: var(--text-faint);
		padding: 0 12px 8px;
	}
</style>