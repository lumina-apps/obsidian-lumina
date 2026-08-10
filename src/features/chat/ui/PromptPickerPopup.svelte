<script lang="ts">
	import { tick } from "svelte";
	import type { SystemPromptPreset } from "../../../shared/types/settings.types";
	import { clickOutside, iconAction } from "../../../shared/utils/domUtils";
	import { useKeyboardListNav } from "./composables/useKeyboardListNav";
	import { tStore } from "../../../shared/locales/index";

	// ═══════════════════════════════════════════════════════════════════════════
	// Props (Svelte 5 runes)
	// ═══════════════════════════════════════════════════════════════════════════
	let {
		prompts,
		activePromptId,
		onSelect,
		onClose,
	}: {
		prompts: SystemPromptPreset[];
		activePromptId: string;
		onSelect: (promptId: string) => void;
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
	// Derived: filter prompts by name (case-insensitive)
	// ═══════════════════════════════════════════════════════════════════════════
	const filteredPrompts = $derived(
		prompts.filter((p) => {
			const query = searchQuery.toLowerCase().trim();
			if (!query) return true;
			return p.name.toLowerCase().includes(query);
		}),
	);

	let activeIndex = $state(0);
	let isKeyboardNavigating = $state(false);

	const nav = useKeyboardListNav({
		isOpen: () => true,
		itemCount: () => filteredPrompts.length,
		onSelect: (index: number) => {
			const item = filteredPrompts[index];
			if (item) selectItem(item);
		},
		onClose: () => onClose(true),
		enableMouseConflict: true,
		getActiveIndex: () => activeIndex,
		setActiveIndex: (val) => { activeIndex = val; },
		getIsKeyboardNavigating: () => isKeyboardNavigating,
		setIsKeyboardNavigating: (val) => { isKeyboardNavigating = val; },
	});

	function selectItem(item: SystemPromptPreset) {
		onSelect(item.id);
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
	class="lumina-prompt-picker"
	bind:this={containerEl}
	use:clickOutside={() => onClose(false)}
>
	<div class="lumina-prompt-picker__search-wrap">
		<input
			bind:this={inputEl}
			bind:value={searchQuery}
			type="text"
			class="lumina-prompt-picker__search"
			placeholder={$tStore("uiMessages.searchPromptShort")}
			onkeydown={nav.handleKeydown}
		/>
	</div>

	<div class="lumina-popup-selector__list lumina-scrollbar-thin" bind:this={listEl} role="listbox">
		{#if filteredPrompts.length === 0}
			<div class="lumina-popup-selector__empty">{$tStore("uiMessages.noSearchResults")}</div>
		{:else}
			{#each filteredPrompts as item, i}
				<button
					class="lumina-popup-selector__item"
					class:is-active={i === nav.activeIndex}
					class:is-selected={item.id === activePromptId}
					role="option"
					aria-selected={i === nav.activeIndex}
					onclick={() => selectItem(item)}
					onmouseenter={() => {
						if (!nav.isKeyboardNavigating) nav.setActiveIndex(i);
					}}
					onmousemove={() => {
						if (!nav.isKeyboardNavigating && nav.activeIndex !== i) nav.setActiveIndex(i);
					}}
					type="button"
				>
					<div class="lumina-popup-selector__item-info">
						<span class="lumina-popup-selector__item-name">{item.name}</span>
						{#if item.content}
							<span class="lumina-prompt-picker__preview">{item.content}</span>
						{/if}
					</div>
					{#if item.id === activePromptId}
						<span class="lumina-prompt-picker__check" use:iconAction={"check"}></span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.lumina-prompt-picker {
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
		animation: lumina-popover-fade-in 0.15s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.lumina-prompt-picker__search-wrap {
		padding: 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}

	.lumina-prompt-picker__search {
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

	.lumina-prompt-picker__search:focus {
		border-color: var(--interactive-accent);
	}

	.lumina-prompt-picker__preview {
		font-size: 10px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-prompt-picker__check {
		display: flex;
		align-items: center;
		color: var(--interactive-accent);
		flex-shrink: 0;
	}

	.lumina-prompt-picker__check :global(svg) {
		width: 14px;
		height: 14px;
	}
</style>
