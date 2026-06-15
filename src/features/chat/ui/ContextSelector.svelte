<script lang="ts">
	import { setIcon, MarkdownView } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import { tick } from "svelte";
	import { tStore } from "../../../shared/locales/index";

	let {
		plugin,
		searchQuery = "",
		onSelect,
		onClose
	} = $props<{
		plugin: LuminaPlugin;
		searchQuery: string;
		onSelect: (attachment: ContextAttachment) => void;
		onClose: () => void;
	}>();

	let containerEl: HTMLDivElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);
	let urlInputEl: HTMLInputElement | null = $state(null);
	let activeIndex = $state(0);
	let urlText = $state("");

	// Navigation state: 'categories' | 'items' | 'url_input'
	let view = $state<'categories' | 'items' | 'url_input'>('categories');
	let activeCategory = $state<string | null>(null);

	let isKeyboardNavigating = false;
	let keyboardNavTimer: ReturnType<typeof setTimeout> | null = null;

	function setKeyboardNav() {
		isKeyboardNavigating = true;
		if (keyboardNavTimer) clearTimeout(keyboardNavTimer);
		keyboardNavTimer = setTimeout(() => {
			isKeyboardNavigating = false;
		}, 150);
	}

	// ── Category definitions ──────────────────────────────────────────────────
	interface CategoryItem {
		id: string;
		icon: string;
		label: string;
		show: boolean;
		type: ContextAttachment['type'] | 'category';
	}

	const categories = $derived.by(() => {
		const cats: CategoryItem[] = [];

		// Active Note
		const activeFile = plugin.app.workspace.getActiveFile();
		if (activeFile) {
			cats.push({
				id: 'active_note',
				icon: 'file-edit',
				label: $tStore('settings.chat.context.categoryActiveNote'),
				show: true,
				type: 'active_note'
			});
		}

		// Selected Text
		const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		// @ts-ignore
		const selection = activeView?.editor?.getSelection();
		if (selection) {
			cats.push({
				id: 'selection',
				icon: 'mouse-pointer-2',
				label: $tStore('settings.chat.context.categorySelection'),
				show: true,
				type: 'selection'
			});
		}

		// Folder
		cats.push({
			id: 'folder',
			icon: 'folder',
			label: $tStore('settings.chat.context.categoryFolder'),
			show: true,
			type: 'folder'
		});

		// File
		cats.push({
			id: 'file',
			icon: 'file-text',
			label: $tStore('settings.chat.context.categoryFile'),
			show: true,
			type: 'file'
		});

		// Tag
		// @ts-ignore
		const tagsInfo = plugin.app.metadataCache.getTags();
		if (tagsInfo && Object.keys(tagsInfo).length > 0) {
			cats.push({
				id: 'tag',
				icon: 'hash',
				label: $tStore('settings.chat.context.categoryTag'),
				show: true,
				type: 'tag'
			});
		}

		// Canvas - check if any canvas files exist
		const files = plugin.app.vault.getFiles();
		const hasCanvas = files.some((f: any) => f.extension === 'canvas');
		if (hasCanvas) {
			cats.push({
				id: 'canvas',
				icon: 'layout',
				label: $tStore('settings.chat.context.categoryCanvas'),
				show: true,
				type: 'canvas'
			});
		}

		// URL
		cats.push({
			id: 'url',
			icon: 'globe',
			label: $tStore('settings.chat.context.categoryUrl'),
			show: true,
			type: 'url'
		});

		return cats;
	});

	// ── Category filtering ────────────────────────────────────────────────────
	const filteredCategories = $derived.by(() => {
		const query = searchQuery.toLowerCase().trim();
		if (!query) return categories;
		return categories.filter(cat =>
			cat.label.toLowerCase().includes(query)
		);
	});

	// ── Items for selected category ───────────────────────────────────────────
	const categoryItems = $derived.by(() => {
		if (!activeCategory) return [];

		const files = plugin.app.vault.getFiles();
		const query = searchQuery.toLowerCase().trim();
		const items: ContextAttachment[] = [];

		switch (activeCategory) {
			case 'active_note': {
				const activeFile = plugin.app.workspace.getActiveFile();
				if (activeFile) {
					items.push({
						type: 'active_note',
						path: activeFile.path,
						name: $tStore('settings.chat.context.activeNote', { name: activeFile.basename })
					});
				}
				break;
			}
			case 'selection': {
				const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
				// @ts-ignore
				const sel = activeView?.editor?.getSelection();
				if (sel) {
					items.push({
						type: 'selection',
						path: 'selection',
						name: $tStore('settings.chat.context.selectedText', { length: sel.length })
					});
				}
				break;
			}
			case 'folder': {
				const folders = new Set<string>();
				files.forEach((f: any) => {
					if (f.parent && f.parent.path !== "/") {
						folders.add(f.parent.path);
					}
				});
				folders.forEach(folderPath => {
					items.push({
						type: 'folder',
						path: folderPath,
						name: folderPath
					});
				});
				break;
			}
			case 'file': {
				files.forEach((f: any) => {
					if (f.extension !== 'canvas') {
						items.push({
							type: 'file',
							path: f.path,
							name: f.basename
						});
					}
				});
				break;
			}
			case 'canvas': {
				files.forEach((f: any) => {
					if (f.extension === 'canvas') {
						items.push({
							type: 'canvas',
							path: f.path,
							name: f.basename
						});
					}
				});
				break;
			}
			case 'tag': {
				// @ts-ignore
				const tagsInfo = plugin.app.metadataCache.getTags();
				if (tagsInfo) {
					Object.keys(tagsInfo).forEach(t => {
						items.push({
							type: 'tag',
							path: t,
							name: t
						});
					});
				}
				break;
			}
		}

		if (!query) return items.slice(0, 50);

		return items.filter(item =>
			item.name.toLowerCase().includes(query) || item.path.toLowerCase().includes(query)
		).slice(0, 50);
	});

	// Total selectable items count (categories or items depending on view)
	const selectableCount = $derived(
		view === 'categories' ? filteredCategories.length : categoryItems.length
	);

	// ── Actions ───────────────────────────────────────────────────────────────
	function selectCategory(cat: CategoryItem) {
		if (cat.id === 'url') {
			view = 'url_input';
			activeCategory = 'url';
			urlText = searchQuery;
			activeIndex = 0;
			tick().then(() => urlInputEl?.focus());
			return;
		}

		// For single-item categories (active_note, selection), select immediately
		if (cat.id === 'active_note' || cat.id === 'selection') {
			const items = getImmediateItem(cat.id);
			if (items) {
				selectItem(items);
				return;
			}
		}

		// Navigate to items view
		view = 'items';
		activeCategory = cat.id;
		activeIndex = 0;
	}

	function getImmediateItem(id: string): ContextAttachment | null {
		const files = plugin.app.vault.getFiles();
		switch (id) {
			case 'active_note': {
				const activeFile = plugin.app.workspace.getActiveFile();
				if (activeFile) {
					return {
						type: 'active_note',
						path: activeFile.path,
						name: $tStore('settings.chat.context.activeNote', { name: activeFile.basename })
					};
				}
				return null;
			}
			case 'selection': {
				const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
				// @ts-ignore
				const sel = activeView?.editor?.getSelection();
				if (sel) {
					return {
						type: 'selection',
						path: 'selection',
						name: $tStore('settings.chat.context.selectedText', { length: sel.length })
					};
				}
				return null;
			}
		}
		return null;
	}

	function goBack() {
		view = 'categories';
		activeCategory = null;
		activeIndex = 0;
	}

	function selectItem(item: ContextAttachment) {
		onSelect(item);
		onClose();
	}

	function submitUrl() {
		const trimmed = urlText.trim();
		if (!trimmed) return;

		if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
			urlText = 'https://' + trimmed;
			return;
		}

		selectItem({
			type: 'url',
			path: trimmed,
			name: trimmed
		});
	}

	function handleUrlKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submitUrl();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			view = 'categories';
			activeCategory = null;
		}
	}

	// ── Icon helper ───────────────────────────────────────────────────────────
	function getIcon(type: string) {
		switch (type) {
			case 'file': return 'file-text';
			case 'folder': return 'folder';
			case 'active_note': return 'file-edit';
			case 'selection': return 'mouse-pointer-2';
			case 'canvas': return 'layout';
			case 'tag': return 'hash';
			case 'url': return 'globe';
			default: return 'file';
		}
	}

	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
	}

	// ── Keyboard handling ─────────────────────────────────────────────────────
	function handleGlobalKeydown(e: KeyboardEvent) {
		if (view === 'url_input') return; // handled by url input

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (selectableCount > 0) {
				setKeyboardNav();
				activeIndex = (activeIndex + 1) % selectableCount;
				tick().then(() => scrollIntoView());
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (selectableCount > 0) {
				setKeyboardNav();
				activeIndex = (activeIndex - 1 + selectableCount) % selectableCount;
				tick().then(() => scrollIntoView());
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (view === 'categories') {
				const cat = filteredCategories[activeIndex];
				if (cat) selectCategory(cat);
			} else {
				const item = categoryItems[activeIndex];
				if (item) selectItem(item);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (view === 'items') {
				goBack();
			} else {
				onClose();
			}
		} else if (e.key === 'Backspace' && view === 'items' && !searchQuery) {
			e.preventDefault();
			goBack();
		}
	}

	function scrollIntoView() {
		if (!listEl) return;
		const activeEl = listEl.querySelector(".is-active") as HTMLElement;
		if (activeEl) {
			activeEl.scrollIntoView({ block: "nearest" });
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (containerEl && !containerEl.contains(e.target as Node)) {
			onClose();
		}
	}

	$effect(() => {
		document.addEventListener("click", handleClickOutside);
		document.addEventListener("keydown", handleGlobalKeydown, true);
		return () => {
			document.removeEventListener("click", handleClickOutside);
			document.removeEventListener("keydown", handleGlobalKeydown, true);
		};
	});

	$effect(() => {
		// Reset active index when search query or view changes
		searchQuery;
		view;
		activeIndex = 0;
	});

	// ── Check for URL pattern on search query ─────────────────────────────────
	$effect(() => {
		const q = searchQuery.trim();
		if (view === 'categories' && (q.startsWith('http://') || q.startsWith('https://'))) {
			// Auto-switch to URL input mode
			view = 'url_input';
			activeCategory = 'url';
			urlText = q;
			tick().then(() => urlInputEl?.focus());
		}
	});
</script>

<div class="lumina-context-selector" bind:this={containerEl}>
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
						class:is-active={i === activeIndex}
						onclick={() => selectCategory(cat)}
						onmouseenter={() => { if (!isKeyboardNavigating) activeIndex = i; }}
						onmousemove={() => { if (!isKeyboardNavigating && activeIndex !== i) activeIndex = i; }}
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
						class:is-active={i === activeIndex}
						onclick={() => selectItem(item)}
						onmouseenter={() => { if (!isKeyboardNavigating) activeIndex = i; }}
						onmousemove={() => { if (!isKeyboardNavigating && activeIndex !== i) activeIndex = i; }}
						type="button"
					>
						<span class="lumina-context-selector__item-icon" use:icon={getIcon(item.type)}></span>
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