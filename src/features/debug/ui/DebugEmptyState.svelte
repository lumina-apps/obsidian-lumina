<script lang="ts">
	import { icon } from '../../../shared/utils/iconAction';
	import { t } from '../../../shared/locales/helpers';

	let { debugMode }: { debugMode: boolean } = $props();

</script>

<div class="lumina-debug__empty">
	<span use:icon={'terminal'}></span>
	<p>{t('uiMessages.debugNoLogs')}</p>
	<p class="lumina-debug__empty-sub">
		{debugMode ? t('uiMessages.debugWaitLlm') : t('uiMessages.debugTurnOn')}
	</p>
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
</style>