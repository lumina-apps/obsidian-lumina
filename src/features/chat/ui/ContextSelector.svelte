<script lang="ts">
	import { setIcon, TFile, TFolder, MarkdownView } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import { onMount, tick } from "svelte";
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
	let activeIndex = $state(0);
	
	let isKeyboardNavigating = false;
	let keyboardNavTimer: ReturnType<typeof setTimeout> | null = null;
	
	function setKeyboardNav() {
		isKeyboardNavigating = true;
		if (keyboardNavTimer) clearTimeout(keyboardNavTimer);
		keyboardNavTimer = setTimeout(() => {
			isKeyboardNavigating = false;
		}, 150);
	}

	// Fetch all files and folders
	const allItems = $derived.by(() => {
		const files = plugin.app.vault.getFiles();
		const items: ContextAttachment[] = [];
		
		// 1. Active Note
		const activeFile = plugin.app.workspace.getActiveFile();
		if (activeFile) {
			items.push({
				type: "active_note",
				path: activeFile.path,
				name: $tStore('settings.chat.context.activeNote', { name: activeFile.basename })
			});
		}

		// 2. Selected Text (We need a way to check if there's selection, skip for now in global list, just add a generic button if query is empty)
		// Or we can dynamically check selection
		// But usually selection is tied to the active editor
		const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		// @ts-ignore
		const selection = activeView?.editor?.getSelection();
		if (selection) {
			items.push({
				type: "selection",
				path: "selection",
				name: $tStore('settings.chat.context.selectedText', { length: selection.length })
			});
		}

		// 3. Folders
		const folders = new Set<string>();
		files.forEach((f: any) => {
			if (f.parent && f.parent.path !== "/") {
				folders.add(f.parent.path);
			}
		});
		folders.forEach(folderPath => {
			items.push({
				type: "folder",
				path: folderPath,
				name: folderPath
			});
		});

		// 4. Files & Canvas
		files.forEach((f: any) => {
			if (f.extension === 'canvas') {
				items.push({
					type: "canvas",
					path: f.path,
					name: f.basename
				});
			} else {
				items.push({
					type: "file",
					path: f.path,
					name: f.basename
				});
			}
		});

		// 5. Tags
		// @ts-ignore
		const tagsInfo = plugin.app.metadataCache.getTags();
		if (tagsInfo) {
			Object.keys(tagsInfo).forEach(t => {
				items.push({
					type: "tag",
					path: t,
					name: t
				});
			});
		}

		return items;
	});

	// Filter by search query
	const filteredItems = $derived.by(() => {
		const query = searchQuery.toLowerCase().trim();
		let results = [];
		if (!query) {
			results = allItems.slice(0, 50);
		} else {
			results = allItems.filter(item => {
				return item.name.toLowerCase().includes(query) || item.path.toLowerCase().includes(query);
			}).slice(0, 50); // limit to 50 items for performance
		}

		if (query.startsWith("http://") || query.startsWith("https://")) {
			results.unshift({
				type: "url",
				path: query,
				name: query
			});
		}
		return results;
	});

	function selectItem(item: ContextAttachment) {
		onSelect(item);
		onClose();
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (filteredItems.length > 0) {
				setKeyboardNav();
				activeIndex = (activeIndex + 1) % filteredItems.length;
				scrollIntoView();
			}
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (filteredItems.length > 0) {
				setKeyboardNav();
				activeIndex = (activeIndex - 1 + filteredItems.length) % filteredItems.length;
				scrollIntoView();
			}
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (filteredItems[activeIndex]) {
				selectItem(filteredItems[activeIndex]);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			onClose();
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
		// Reset active index when search query changes
		searchQuery; 
		activeIndex = 0;
	});

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
</script>

<div class="lumina-context-selector" bind:this={containerEl}>
	<div class="lumina-context-selector__list" bind:this={listEl}>
		{#if filteredItems.length === 0}
			<div class="lumina-context-selector__empty">{$tStore('uiMessages.noSearchResults')}</div>
		{:else}
			{#each filteredItems as item, i}
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
</div>

<style>
	.lumina-context-selector {
		position: absolute;
		bottom: 100%;
		left: 0;
		width: 320px;
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
		width: 14px;
		height: 14px;
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
</style>
