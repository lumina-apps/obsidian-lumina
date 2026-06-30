<script lang="ts">
	import { setIcon } from 'obsidian';
	import { t } from '../../../shared/locales/helpers';
	import { icon } from '../../../shared/utils/iconAction';

	let {
		entryCount,
		autoScroll,
		onToggleAutoScroll,
		onExport,
		onClear,
	}: {
		entryCount: number;
		autoScroll: boolean;
		onToggleAutoScroll: () => void;
		onExport: () => void;
		onClear: () => void;
	} = $props();
</script>

<div class="lumina-debug__header">
	<div class="lumina-debug__title">
		<span class="lumina-debug__title-icon" use:icon={'bug'}></span>
		<span>DevLog</span>
		{#if entryCount > 0}
			<span class="lumina-debug__count">{entryCount}</span>
		{/if}
	</div>

	<div class="lumina-debug__actions">
		<!-- Auto-scroll toggle -->
		<button
			class="lumina-debug__action-btn"
			class:is-active={autoScroll}
			aria-label="{t('uiMessages.debugAutoScroll')} {autoScroll ? 'ON' : 'OFF'}"
			onclick={onToggleAutoScroll}
			type="button"
		>
			<span use:icon={'arrow-down-to-line'}></span>
		</button>

		<!-- Export -->
		<button
			class="lumina-debug__action-btn"
			aria-label={t('uiMessages.debugExport')}
			onclick={onExport}
			disabled={entryCount === 0}
			type="button"
		>
			<span use:icon={'download'}></span>
		</button>

		<!-- Clear -->
		<button
			class="lumina-debug__action-btn lumina-debug__action-btn--danger"
			aria-label={t('uiMessages.debugDelAll')}
			onclick={onClear}
			disabled={entryCount === 0}
			type="button"
		>
			<span use:icon={'trash-2'}></span>
		</button>
	</div>
</div>

<style>
	.lumina-debug__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	.lumina-debug__title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 700;
		color: var(--text-normal);
	}

	.lumina-debug__title-icon {
		color: var(--text-muted);
		display: flex;
		align-items: center;
	}

	.lumina-debug__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		font-size: 10px;
		font-weight: 700;
		border-radius: 9px;
		background: var(--background-modifier-border);
		color: var(--text-muted);
	}

	.lumina-debug__actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}
</style>