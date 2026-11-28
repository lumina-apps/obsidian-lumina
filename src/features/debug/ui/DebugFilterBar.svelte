<script lang="ts">
	import { t } from '../../../shared/locales/helpers';
	import type { DebugLogType } from '../../../shared/types/debug.types';
	import { FILTER_OPTIONS } from '../constants';
	import { icon } from '../../../shared/utils/iconAction';

	let {
		filterType,
		searchQuery,
		filteredCount,
		totalCount,
		allFilteredExpanded,
		anyFilteredExpanded,
		onFilterChange,
		onSearchChange,
		onExpandAll,
		onCollapseAll,
	}: {
		filterType: DebugLogType | 'all';
		searchQuery: string;
		filteredCount: number;
		totalCount: number;
		allFilteredExpanded: boolean;
		anyFilteredExpanded: boolean;
		onFilterChange: (value: DebugLogType | 'all') => void;
		onSearchChange: (value: string) => void;
		onExpandAll: () => void;
		onCollapseAll: () => void;
	} = $props();

	const hasActiveFilter = $derived(
		filterType !== 'all' || searchQuery.trim().length > 0,
	);
</script>

<div class="lumina-debug__filters">
	<div class="lumina-debug__filters-row">
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

	<div class="lumina-debug__search-row">
		<span class="lumina-debug__search-icon" use:icon={'search'}></span>
		<input
			type="text"
			class="lumina-debug__search-input"
			value={searchQuery}
			placeholder={t('uiMessages.debugSearchPlaceholder')}
			aria-label={t('uiMessages.debugSearchPlaceholder')}
			oninput={(e) => onSearchChange(e.currentTarget.value)}
			onkeydown={(e) => {
				if (e.key === 'Escape' && searchQuery) {
					e.stopPropagation();
					onSearchChange('');
				}
			}}
		/>
		{#if hasActiveFilter}
			<span class="lumina-debug__match-count">{filteredCount} / {totalCount}</span>
		{/if}
		{#if searchQuery.length > 0}
			<button
				class="lumina-debug__search-clear"
				type="button"
				aria-label={t('uiMessages.debugClearSearch')}
				onclick={() => onSearchChange('')}
			>
				<span use:icon={'x'}></span>
			</button>
		{/if}
	</div>
</div>

<style>
	.lumina-debug__filters {
		display: flex;
		flex-direction: column;
		padding: 6px 10px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
		gap: 6px;
	}

	.lumina-debug__filters-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
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

	/* 키워드 검색 행 */
	.lumina-debug__search-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		border-radius: 5px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
	}

	.lumina-debug__search-row:focus-within {
		border-color: var(--interactive-accent);
	}

	.lumina-debug__search-icon {
		display: flex;
		align-items: center;
		color: var(--text-faint);
		flex-shrink: 0;
	}

	.lumina-debug__search-icon :global(svg) {
		width: 13px;
		height: 13px;
	}

	.lumina-debug__search-input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		outline: none;
		box-shadow: none;
		font-size: 11.5px;
		color: var(--text-normal);
		padding: 2px 0;
	}

	.lumina-debug__search-input::placeholder {
		color: var(--text-faint);
	}

	.lumina-debug__match-count {
		flex-shrink: 0;
		font-size: 10px;
		font-family: var(--font-monospace);
		color: var(--text-muted);
	}

	.lumina-debug__search-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: 3px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.lumina-debug__search-clear:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-debug__search-clear :global(svg) {
		width: 12px;
		height: 12px;
	}

	/* 모바일 디버그 필터 버튼 및 검색 입력 터치 타겟 보강 */
	:global(body.is-mobile) .lumina-debug__filter-btn {
		padding: 4px 9px;
		font-size: 11px;
		min-height: 26px;
		height: auto;
		box-shadow: none;
	}

	:global(body.is-mobile) .lumina-debug__search-row {
		min-height: 34px;
		padding: 4px 10px;
	}

	:global(body.is-mobile) .lumina-debug__search-input {
		font-size: 13px;
	}

	:global(body.is-mobile) .lumina-debug__search-clear {
		width: 26px;
		height: 26px;
	}
</style>