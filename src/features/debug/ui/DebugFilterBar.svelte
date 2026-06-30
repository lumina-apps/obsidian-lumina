<script lang="ts">
	import { setIcon } from 'obsidian';
	import { t } from '../../../shared/locales/helpers';
	import type { DebugLogType } from '../../../shared/types/debug.types';
	import { FILTER_OPTIONS } from '../constants';
	import { icon } from '../../../shared/utils/iconAction';

	let {
		filterType,
		filteredCount,
		allFilteredExpanded,
		anyFilteredExpanded,
		onFilterChange,
		onExpandAll,
		onCollapseAll,
	}: {
		filterType: DebugLogType | 'all';
		filteredCount: number;
		allFilteredExpanded: boolean;
		anyFilteredExpanded: boolean;
		onFilterChange: (value: DebugLogType | 'all') => void;
		onExpandAll: () => void;
		onCollapseAll: () => void;
	} = $props();
</script>

<div class="lumina-debug__filters">
	<div class="lumina-debug__filter-group">
		{#each FILTER_OPTIONS as f}
			<button
				class="lumina-debug__filter-btn"
				class:is-active={filterType === f.value}
				onclick={() => onFilterChange(f.value)}
				type="button"
			>
				{f.label}
			</button>
		{/each}
	</div>
	<div class="lumina-debug__filter-actions">
		<button
			class="lumina-debug__action-btn"
			aria-label={t('uiMessages.debugExpandAll')}
			onclick={onExpandAll}
			disabled={filteredCount === 0 || allFilteredExpanded}
			type="button"
		>
			<span use:icon={'chevrons-down'}></span>
		</button>
		<button
			class="lumina-debug__action-btn"
			aria-label={t('uiMessages.debugCollapseAll')}
			onclick={onCollapseAll}
			disabled={!anyFilteredExpanded}
			type="button"
		>
			<span use:icon={'chevrons-up'}></span>
		</button>
	</div>
</div>

<style>
	.lumina-debug__filters {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 10px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
		gap: 8px;
	}

	.lumina-debug__filter-group {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.lumina-debug__filter-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.lumina-debug__filter-btn {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 4px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.lumina-debug__filter-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-debug__filter-btn.is-active {
		background: var(--background-modifier-border);
		color: var(--text-normal);
		border-color: var(--background-modifier-border-hover);
	}
</style>