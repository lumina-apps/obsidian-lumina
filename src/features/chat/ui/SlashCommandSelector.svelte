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
		if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
			e.stopPropagation();
		}
		nav.handleKeydown(e);
		nav.scrollToActive(listEl);
	}

	$effect(() => {
		document.addEventListener("keydown", handleGlobalKeydown, true);
		return () => {
			document.removeEventListener("keydown", handleGlobalKeydown, true);
		};
	});

	// Reset activeIndex when search query changes
	$effect(() => {
		searchQuery;
		nav.resetIndex();
	});
</script>

<div class="lumina-slash-selector" bind:this={containerEl} use:clickOutside={() => onClose(false)}>
	<div class="lumina-slash-selector__list lumina-scrollbar-thin" bind:this={listEl} role="listbox">
		{#if filteredCommands.length === 0}
			<div class="lumina-slash-selector__empty">명령어를 찾을 수 없습니다.</div>
		{:else}
			{#each filteredCommands as cmd, i}
				<button
					class="lumina-slash-selector__item"
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
					<span class="lumina-slash-selector__item-icon" use:iconAction={cmd.icon}></span>
					<div class="lumina-slash-selector__item-info">
						<span class="lumina-slash-selector__item-name">{cmd.name}</span>
						<span class="lumina-slash-selector__item-desc">{cmd.description}</span>
					</div>
					<span class="lumina-slash-selector__item-badge">/{cmd.id}</span>
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.lumina-slash-selector {
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
		animation: lumina-popover-fade-in 0.15s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.lumina-slash-selector__list {
		max-height: 280px;
		overflow-y: auto;
		padding: 4px 0;
	}

	.lumina-slash-selector__empty {
		font-size: 12px;
		color: var(--text-muted);
		padding: 12px;
		text-align: center;
	}

	.lumina-slash-selector__item {
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

	.lumina-slash-selector__item.is-active {
		background-color: var(--background-modifier-hover);
	}

	.lumina-slash-selector__item-icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.lumina-slash-selector__item-icon :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-slash-selector__item.is-active .lumina-slash-selector__item-icon {
		color: var(--interactive-accent);
	}

	.lumina-slash-selector__item-info {
		display: flex;
		flex-direction: column;
		flex-grow: 1;
		overflow: hidden;
		gap: 2px;
	}

	.lumina-slash-selector__item-name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-slash-selector__item-desc {
		font-size: 10px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-slash-selector__item-badge {
		font-size: 9px;
		font-weight: 700;
		padding: 2px 5px;
		border-radius: 4px;
		background: var(--background-secondary-alt);
		color: var(--text-muted);
		border: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
	}
</style>