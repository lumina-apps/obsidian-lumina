<script lang="ts">
	import { clickOutside } from "../../../shared/utils/domUtils";
	import { tStore } from "../../../shared/locales/index";
	import { openSettingsTab } from "../../../shared/utils/openSettingsTab";
	import type LuminaPlugin from "../../../main";
	import type { ProjectConfig } from "../../../shared/types/project.types";
	import { DEFAULT_PROJECT_ID } from "../../../shared/types/project.types";

	// ── Props ──────────────────────────────────────────────────────────────
	let {
		plugin,
		projectList,
		activeProjectId,
		onSelect,
	}: {
		plugin: LuminaPlugin;
		projectList: ProjectConfig[];
		activeProjectId: string;
		onSelect: (projectId: string) => void;
	} = $props();

	// ── State ──────────────────────────────────────────────────────────────
	let isOpen = $state(false);
	let containerEl: HTMLDivElement | null = $state(null);

	// ── Derived ────────────────────────────────────────────────────────────
	const activeProject = $derived(
		projectList.find((p) => p.id === activeProjectId) ?? projectList[0],
	);

	// ── Handlers ───────────────────────────────────────────────────────────
	function toggle(e: MouseEvent) {
		e.stopPropagation();
		isOpen = !isOpen;
	}

	function handleSelect(projectId: string) {
		isOpen = false;
		if (projectId !== activeProjectId) {
			onSelect(projectId);
		}
	}

	function handleManageSettings() {
		isOpen = false;
		openSettingsTab(plugin.app, "lumina");
	}

	function handleClickOutside() {
		isOpen = false;
	}
</script>

<div
	class="lumina-project-selector"
	bind:this={containerEl}
	use:clickOutside={handleClickOutside}
>
	<!-- Trigger pill -->
	<button
		class="lumina-project-selector__trigger"
		class:is-open={isOpen}
		onclick={toggle}
		type="button"
		aria-label={$tStore("projects.selector.label") || "Select project"}
		aria-expanded={isOpen}
		aria-haspopup="listbox"
	>
		<span class="lumina-project-selector__icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
			</svg>
		</span>
		<span class="lumina-project-selector__name">
			{activeProject?.id === DEFAULT_PROJECT_ID && activeProject?.name === 'Default' ? ($tStore("projects.settings.defaultProjectName") || "Default Project") : (activeProject?.name ?? "Default")}
		</span>
		<span class="lumina-project-selector__caret" aria-hidden="true">
			<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="6 9 12 15 18 9" />
			</svg>
		</span>
	</button>

	<!-- Dropdown -->
	{#if isOpen}
		<div
			class="lumina-project-selector__dropdown"
			role="listbox"
			aria-label={$tStore("projects.selector.label") || "Projects"}
		>
			<div class="lumina-project-selector__list">
				{#each projectList as project (project.id)}
					<button
						class="lumina-project-selector__item"
						class:is-active={project.id === activeProjectId}
						role="option"
						aria-selected={project.id === activeProjectId}
						type="button"
						onclick={() => handleSelect(project.id)}
					>
						<span class="lumina-project-selector__item-icon" aria-hidden="true">
							{#if project.id === activeProjectId}
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="20 6 9 17 4 12" />
								</svg>
							{:else}
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
								</svg>
							{/if}
						</span>
						<span class="lumina-project-selector__item-name">
							{project.id === DEFAULT_PROJECT_ID && project.name === 'Default' ? ($tStore("projects.settings.defaultProjectName") || "Default Project") : project.name}
						</span>
						{#if project.id === DEFAULT_PROJECT_ID}
							<span class="lumina-project-selector__item-badge">
								{$tStore("projects.selector.default") || "Default"}
							</span>
						{/if}
					</button>
				{/each}
			</div>

			<div class="lumina-project-selector__footer">
				<button
					class="lumina-project-selector__manage-btn"
					type="button"
					onclick={handleManageSettings}
				>
					<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
					{$tStore("projects.selector.manage") || "설정에서 관리"}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.lumina-project-selector {
		position: relative;
		display: flex;
		align-items: center;
	}

	/* Trigger pill */
	.lumina-project-selector__trigger {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--text-normal);
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		max-width: 140px;
	}

	.lumina-project-selector__trigger:hover,
	.lumina-project-selector__trigger.is-open {
		background: var(--background-modifier-hover);
	}

	.lumina-project-selector__icon {
		display: none;
	}

	.lumina-project-selector__name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.lumina-project-selector__caret {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		opacity: 0.7;
		transition: transform 0.15s ease;
	}

	.lumina-project-selector__trigger.is-open .lumina-project-selector__caret {
		transform: rotate(180deg);
	}

	/* Dropdown */
	.lumina-project-selector__dropdown {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		min-width: 180px;
		max-width: 260px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		overflow: hidden;
		animation: lumina-project-dropdown-in 0.12s cubic-bezier(0.4, 0, 0.2, 1);
	}

	@keyframes lumina-project-dropdown-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.lumina-project-selector__list {
		padding: 4px 0;
		max-height: 200px;
		overflow-y: auto;
	}

	.lumina-project-selector__list::-webkit-scrollbar {
		width: 4px;
	}
	.lumina-project-selector__list::-webkit-scrollbar-thumb {
		background: var(--background-modifier-border);
		border-radius: 2px;
	}

	/* List item */
	.lumina-project-selector__item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 12px;
		background: transparent;
		border: none;
		font-size: 12px;
		color: var(--text-normal);
		cursor: pointer;
		transition: background 0.1s ease;
		text-align: left;
	}

	.lumina-project-selector__item:hover {
		background: var(--background-modifier-hover);
	}

	.lumina-project-selector__item.is-active {
		color: var(--interactive-accent);
		font-weight: 600;
	}

	.lumina-project-selector__item-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.lumina-project-selector__item.is-active .lumina-project-selector__item-icon {
		color: var(--interactive-accent);
	}

	.lumina-project-selector__item-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-project-selector__item-badge {
		font-size: 9px;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--background-secondary-alt);
		color: var(--text-faint);
		border: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
	}

	/* Footer */
	.lumina-project-selector__footer {
		border-top: 1px solid var(--background-modifier-border);
		padding: 4px 0;
	}

	.lumina-project-selector__manage-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 12px;
		background: transparent;
		border: none;
		font-size: 11px;
		color: var(--text-muted);
		cursor: pointer;
		transition: background 0.1s ease;
	}

	.lumina-project-selector__manage-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
</style>
