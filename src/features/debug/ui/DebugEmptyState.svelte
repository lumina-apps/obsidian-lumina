<script lang="ts">
	import { setIcon } from 'obsidian';
	import { t } from '../../../shared/locales/helpers';

	let { debugMode }: { debugMode: boolean } = $props();

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

<div class="lumina-debug__empty">
	<span use:icon={'terminal'}></span>
	<p>{t('uiMessages.debugNoLogs')}</p>
	<p class="lumina-debug__empty-sub">
		{debugMode ? t('uiMessages.debugWaitLlm') : t('uiMessages.debugTurnOn')}
	</p>
</div>