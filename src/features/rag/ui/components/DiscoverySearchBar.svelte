<script lang="ts">
	import { tStore } from '../../../../shared/locales/index';
	import { iconAction } from '../../../../shared/utils/domUtils';

	let { searchQuery = $bindable(), filterQuery = $bindable() } = $props<{ searchQuery: string; filterQuery: string }>();
</script>

<div class="lumina-discovery__search-bar">
	<span class="lumina-discovery__search-icon" use:iconAction={"search"}></span>
	<input
		type="text"
		class="lumina-discovery__search-input"
		placeholder={$tStore('discovery.searchPlaceholder')}
		bind:value={searchQuery}
	/>
	{#if searchQuery}
		<button class="lumina-discovery__clear-btn" aria-label="Clear Search" onclick={() => searchQuery = ''}>
			<span use:iconAction={"x"}></span>
		</button>
	{/if}
</div>
<div class="lumina-discovery__search-bar" style="margin-top: 4px;">
	<span class="lumina-discovery__search-icon" use:iconAction={"filter"}></span>
	<input
		type="text"
		class="lumina-discovery__search-input"
		placeholder={$tStore('discovery.filterPlaceholder')}
		bind:value={filterQuery}
	/>
	{#if filterQuery}
		<button class="lumina-discovery__clear-btn" aria-label="Clear Filter" onclick={() => filterQuery = ''}>
			<span use:iconAction={"x"}></span>
		</button>
	{/if}
</div>

<style>
	.lumina-discovery__search-bar {
		display: flex;
		align-items: center;
		padding: 2px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		gap: 8px;
	}

	.lumina-discovery__search-icon {
		color: var(--text-muted);
		display: flex;
	}

	.lumina-discovery__search-input {
		flex: 1;
		border: none;
		background: transparent;
		outline: none;
		font-size: 13px;
		color: var(--text-normal);
	}

	.lumina-discovery__search-input::placeholder {
		color: var(--text-faint);
	}

	.lumina-discovery__clear-btn {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		padding: 4px;
	}
</style>
