<script lang="ts">
	import { tStore } from '../../../shared/locales/index';

	let { current, max }: { current: number; max: number } = $props();

	const safeCurrent = $derived(Number.isFinite(current) && current >= 0 ? current : 0);
	const safeMax = $derived(Number.isFinite(max) && max > 0 ? max : 1);
	const isDanger = $derived(current > max);
	const percentage = $derived(Math.min(100, (safeCurrent / safeMax) * 100));
</script>

<div class="lumina-token-progress-wrapper">
	<div
		class="lumina-token-progress-bar"
		style="width: {percentage}%"
		class:is-danger={isDanger}
	></div>
	<div class="lumina-token-progress-text" class:is-danger={isDanger}>
		{$tStore('discovery.approxTokens', {
			current: safeCurrent.toLocaleString(),
			max: max.toLocaleString()
		})}
	</div>
</div>

<style>
	.lumina-token-progress-wrapper {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-token-progress-bar {
		height: 4px;
		background: var(--interactive-accent);
		border-radius: 2px;
		transition: width 0.3s ease, background-color 0.3s ease;
	}

	.lumina-token-progress-bar.is-danger {
		background: var(--text-error);
	}

	.lumina-token-progress-text {
		font-size: 10px;
		color: var(--text-muted);
		text-align: right;
	}

	.lumina-token-progress-text.is-danger {
		color: var(--text-error);
		font-weight: 600;
	}
</style>