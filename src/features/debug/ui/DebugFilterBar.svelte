<script lang="ts">
	import { setIcon } from 'obsidian';
	import { t } from '../../../shared/locales/helpers';
	import type { DebugLogType } from '../../../shared/types/debug.types';
	import { FILTER_OPTIONS } from '../constants';

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

	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
		return {
			update(newId: string) {
				node.empty();
				setIcon(node, newId);
			},
		};
	}
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