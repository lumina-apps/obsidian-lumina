<script lang="ts">
	import { icon } from '../../../shared/utils/iconAction';
	import { t } from '../../../shared/locales/helpers';

	let {
		debugMode,
		isFiltered = false,
		onResetFilters,
	}: {
		debugMode: boolean;
		isFiltered?: boolean;
		onResetFilters?: () => void;
	} = $props();
</script>

<div class="lumina-debug__empty">
	{#if isFiltered}
		<span use:icon={'search-x'}></span>
		<p>{t('uiMessages.debugNoMatches')}</p>
		{#if onResetFilters}
			<button
				class="lumina-debug__reset-btn"
				type="button"
				onclick={onResetFilters}
			>
				{t('uiMessages.debugResetFilters')}
			</button>
		{/if}
	{:else}
		<span use:icon={'terminal'}></span>
		<p>{t('uiMessages.debugNoLogs')}</p>
		<p class="lumina-debug__empty-sub">
			{debugMode ? t('uiMessages.debugWaitLlm') : t('uiMessages.debugTurnOn')}
		</p>
	{/if}
</div>

<style>
	.lumina-debug__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 180px;
		gap: 8px;
		color: var(--text-muted);
		text-align: center;
		padding: 0 20px;
	}

	.lumina-debug__empty p {
		margin: 0;
		font-size: 12px;
	}

	.lumina-debug__empty-sub {
		font-size: 10px;
		opacity: 0.7;
	}

	.lumina-debug__reset-btn {
		margin-top: 4px;
		padding: 4px 10px;
		font-size: 11px;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-normal);
		cursor: pointer;
	}

	.lumina-debug__reset-btn:hover {
		background: var(--background-modifier-hover);
	}
</style>