<script lang="ts">
	import { iconAction } from "../../../shared/utils/domUtils";

	/**
	 * 배치 스튜디오 전용 폴더 선택 콤보박스.
	 * HTML 기본 datalist와 달리 이미 폴더가 선택된 상태에서 다시 열어도
	 * 항상 전체 폴더 목록을 먼저 보여주고, 직접 타이핑할 때만 필터링합니다.
	 */
	let {
		folders,
		value,
		placeholder = "",
		id = undefined,
		disabled = false,
		inputClass = "",
		onChange,
		onEnter = undefined,
	}: {
		folders: string[];
		value: string;
		placeholder?: string;
		id?: string;
		disabled?: boolean;
		inputClass?: string;
		onChange: (nextValue: string) => void;
		onEnter?: () => void;
	} = $props();

	let rootEl = $state<HTMLDivElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let menuEl = $state<HTMLDivElement | null>(null);
	let isOpen = $state(false);
	let isFiltering = $state(false);
	let activeIndex = $state(-1);
	let menuStyle = $state("");

	/**
	 * container-type / transform 조상의 containing block 영향을 받지 않도록
	 * 드롭다운 메뉴를 document.body 직속으로 이동시키는 포털 액션
	 */
	function portalToBody(node: HTMLElement) {
		if (typeof document !== "undefined" && document.body) {
			document.body.appendChild(node);
		}
		return {
			destroy() {
				node.remove();
			},
		};
	}

	const filteredFolders = $derived.by(() => {
		if (!isFiltering) return folders;
		const query = value.trim().toLowerCase();
		if (!query) return folders;
		return folders.filter((folder) => folder.toLowerCase().includes(query));
	});

	function updateMenuPosition(): void {
		if (!rootEl || typeof window === "undefined") return;
		const rect = rootEl.getBoundingClientRect();
		const maxMenuHeight = 220;
		const spaceBelow = window.innerHeight - rect.bottom - 8;
		const openUpward = spaceBelow < 150 && rect.top > spaceBelow;
		const top = openUpward
			? Math.max(8, rect.top - Math.min(maxMenuHeight, rect.top - 8) - 4)
			: rect.bottom + 4;
		const maxHeight = openUpward
			? Math.min(maxMenuHeight, Math.max(100, rect.top - 12))
			: Math.min(maxMenuHeight, Math.max(100, spaceBelow));
		menuStyle = `top:${top}px;left:${rect.left}px;width:${Math.max(rect.width, 180)}px;max-height:${maxHeight}px;`;
	}

	function openFullList(): void {
		if (disabled) return;
		isFiltering = false;
		activeIndex = folders.indexOf(value);
		updateMenuPosition();
		isOpen = true;
	}

	function closeList(): void {
		isOpen = false;
		isFiltering = false;
		activeIndex = -1;
	}

	function handleInput(e: Event): void {
		const nextVal = (e.currentTarget as HTMLInputElement).value;
		onChange(nextVal);
		isFiltering = true;
		activeIndex = -1;
		updateMenuPosition();
		isOpen = true;
	}

	function handleSelect(folder: string): void {
		onChange(folder);
		closeList();
	}

	function handleClear(e: MouseEvent): void {
		e.stopPropagation();
		if (disabled) return;
		onChange("");
		openFullList();
		inputEl?.focus();
	}

	function handleToggleBtn(e: MouseEvent): void {
		e.stopPropagation();
		if (disabled) return;
		if (isOpen) {
			closeList();
		} else {
			openFullList();
			inputEl?.focus();
		}
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (disabled) return;
		if (e.key === "Escape") {
			if (isOpen) {
				e.preventDefault();
				closeList();
			}
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (!isOpen) {
				openFullList();
				return;
			}
			if (filteredFolders.length > 0) {
				activeIndex = (activeIndex + 1) % filteredFolders.length;
			}
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			if (!isOpen) {
				openFullList();
				return;
			}
			if (filteredFolders.length > 0) {
				activeIndex = (activeIndex - 1 + filteredFolders.length) % filteredFolders.length;
			}
			return;
		}
		if (e.key === "Enter") {
			if (isOpen && activeIndex >= 0 && activeIndex < filteredFolders.length) {
				e.preventDefault();
				handleSelect(filteredFolders[activeIndex]);
				return;
			}
			if (onEnter) {
				e.preventDefault();
				closeList();
				onEnter();
			}
		}
	}

	$effect(() => {
		if (!isOpen || typeof window === "undefined") return;
		const onReposition = () => updateMenuPosition();
		const onOutsideMouseDown = (ev: MouseEvent) => {
			const target = ev.target as Node | null;
			if (!target) return;
			if (rootEl?.contains(target) || menuEl?.contains(target)) return;
			closeList();
		};
		window.addEventListener("resize", onReposition);
		window.addEventListener("scroll", onReposition, true);
		document.addEventListener("mousedown", onOutsideMouseDown, true);
		return () => {
			window.removeEventListener("resize", onReposition);
			window.removeEventListener("scroll", onReposition, true);
			document.removeEventListener("mousedown", onOutsideMouseDown, true);
		};
	});
</script>

<div
	class="lumina-folder-select"
	class:is-disabled={disabled}
	bind:this={rootEl}
>
	<input
		bind:this={inputEl}
		{id}
		type="text"
		autocomplete="off"
		class={`lumina-folder-select__input ${inputClass}`.trim()}
		{disabled}
		{placeholder}
		{value}
		onfocus={openFullList}
		onclick={openFullList}
		oninput={handleInput}
		onkeydown={handleKeydown}
	/>

	<div class="lumina-folder-select__controls">
		{#if !disabled && value}
			<button
				type="button"
				class="lumina-folder-select__icon-btn"
				tabindex="-1"
				aria-label="Clear"
				onmousedown={(e) => e.preventDefault()}
				onclick={handleClear}
			>
				<span use:iconAction={"x"}></span>
			</button>
		{/if}
		<button
			type="button"
			class="lumina-folder-select__icon-btn"
			tabindex="-1"
			{disabled}
			aria-label="Toggle folders"
			onmousedown={(e) => e.preventDefault()}
			onclick={handleToggleBtn}
		>
			<span use:iconAction={isOpen ? "chevron-up" : "chevron-down"}></span>
		</button>
	</div>

	{#if isOpen && filteredFolders.length > 0}
		<div
			class="lumina-folder-select__menu lumina-scrollbar-thin"
			style={menuStyle}
			role="listbox"
			bind:this={menuEl}
			use:portalToBody
		>
			{#each filteredFolders as folder, idx (folder)}
				<button
					type="button"
					role="option"
					aria-selected={folder === value}
					class="lumina-folder-select__option"
					class:is-selected={folder === value}
					class:is-highlighted={idx === activeIndex}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => handleSelect(folder)}
				>
					<span class="lumina-folder-select__option-icon" use:iconAction={"folder"}></span>
					<span class="lumina-folder-select__option-text">{folder}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.lumina-folder-select {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1 1 0;
		min-width: 0;
		width: 100%;
	}

	.lumina-folder-select__input {
		width: 100%;
		min-width: 0;
		padding: 5px 48px 5px 8px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 12px;
	}

	.lumina-folder-select__controls {
		position: absolute;
		right: 4px;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.lumina-folder-select__icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		box-shadow: none;
		color: var(--text-muted);
		cursor: pointer;
	}

	.lumina-folder-select__icon-btn:hover:not(:disabled) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-folder-select__icon-btn :global(svg) {
		width: 13px;
		height: 13px;
	}

	.lumina-folder-select__menu {
		position: fixed;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		padding: 4px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		box-shadow: var(--shadow-s);
		overflow-y: auto;
	}

	.lumina-folder-select__option {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 5px 8px;
		border: none;
		border-radius: 4px;
		background: transparent;
		box-shadow: none;
		color: var(--text-normal);
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}

	.lumina-folder-select__option:hover,
	.lumina-folder-select__option.is-highlighted {
		background: var(--background-modifier-hover);
	}

	.lumina-folder-select__option.is-selected {
		background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
		color: var(--text-accent);
		font-weight: 600;
	}

	.lumina-folder-select__option-icon {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.lumina-folder-select__option-icon :global(svg) {
		width: 12px;
		height: 12px;
	}

	.lumina-folder-select__option-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
