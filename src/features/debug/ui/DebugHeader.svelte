<script lang="ts">
	import { setIcon } from 'obsidian';
	import { t } from '../../../shared/locales/helpers';

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