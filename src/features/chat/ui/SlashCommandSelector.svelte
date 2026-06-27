<script lang="ts">
	import type { SlashCommand } from "../types/slashCommand.types";
	import { clickOutside, iconAction } from "../../../shared/utils/domUtils";
	import { useKeyboardListNav } from "./composables/useKeyboardListNav";

	let {
		commands = [],
		searchQuery = "",
		onSelect,
		onClose,
	}: {
		commands: SlashCommand[];
		searchQuery: string;
		onSelect: (cmd: SlashCommand) => void;
		onClose: (focusTextarea?: boolean) => void;
	} = $props();

	let containerEl: HTMLDivElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);

	const filteredCommands = $derived.by(() => {
		const query = searchQuery.toLowerCase().trim();
		if (!query) return commands;
		return commands.filter(
			(cmd) =>
				cmd.id.toLowerCase().includes(query) ||
				cmd.name.toLowerCase().includes(query) ||
				cmd.description.toLowerCase().includes(query),
		);
	});

	function selectItem(cmd: SlashCommand) {
		onSelect(cmd);
		onClose();
	}

	let activeIndex = $state(0);
	let isKeyboardNavigating = $state(false);

	const nav = useKeyboardListNav({
		isOpen: () => true,
		itemCount: () => filteredCommands.length,
		onSelect: (index: number) => {
			const cmd = filteredCommands[index];
			if (cmd) selectItem(cmd);
		},
		onClose: () => onClose(true),
		enableMouseConflict: true,
		getActiveIndex: () => activeIndex,
		setActiveIndex: (val) => { activeIndex = val; },
		getIsKeyboardNavigating: () => isKeyboardNavigating,
		setIsKeyboardNavigating: (val) => { isKeyboardNavigating = val; },
	});

	// Global keydown capture (SlashCommandSelector는 capture phase로 등록)
	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.isComposing && e.key === "Enter") return; // Ignore IME composition Enter
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

	// Reset activeIndex when search query changes
	$effect(() => {
		searchQuery;
		nav.resetIndex();
	});
</script>

<div class="lumina-popup-selector" bind:this={containerEl} use:clickOutside={() => onClose(false)}>
	<div class="lumina-popup-selector__list lumina-scrollbar-thin" bind:this={listEl} role="listbox">
		{#if filteredCommands.length === 0}
			<div class="lumina-popup-selector__empty">명령어를 찾을 수 없습니다.</div>
		{:else}
			{#each filteredCommands as cmd, i}
				<button
					class="lumina-popup-selector__item"
					class:is-active={i === nav.activeIndex}
					role="option"
					aria-selected={i === nav.activeIndex}
					onclick={() => selectItem(cmd)}
					onmouseenter={() => {
						if (!nav.isKeyboardNavigating) nav.setActiveIndex(i);
					}}
					onmousemove={() => {
						if (!nav.isKeyboardNavigating && nav.activeIndex !== i) nav.setActiveIndex(i);
					}}
					type="button"
				>
					<span class="lumina-popup-selector__item-icon" use:iconAction={cmd.icon}></span>
					<div class="lumina-popup-selector__item-info">
						<span class="lumina-popup-selector__item-name">{cmd.name}</span>
						<span class="lumina-slash-selector__item-desc">{cmd.description}</span>
					</div>
					<span class="lumina-popup-selector__item-badge">/{cmd.id}</span>
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.lumina-slash-selector__item-desc {
		font-size: 10px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>