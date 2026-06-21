<script lang="ts">
	import type { App } from 'obsidian';
	import type { RagPipelineStep } from '../../../../shared/types/chat.types';
	import { t } from '../../../shared/locales/helpers';

	let {
		step,
		app,
	}: {
		step: RagPipelineStep;
		app: App;
	} = $props();

	let stepText = $derived.by(() => {
		switch (step) {
			case 'searching':
				return t('uiMessages.ragProgress.searching');
			case 'reranking':
				return t('uiMessages.ragProgress.reranking');
			case 'compressing':
				return t('uiMessages.ragProgress.compressing');
			case 'generating':
				return t('uiMessages.ragProgress.generating');
			default:
				return '';
		}
	});

	let isActive = $derived(step !== null);
</script>

{#if isActive}
	<div class="lumina-rag-indicator">
		<div class="lumina-rag-indicator__icon-wrapper">
			<svg viewBox="0 0 24 24" class="lumina-rag-indicator__spinner" width="16" height="16">
				<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"></circle>
				<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"></path>
			</svg>
		</div>
		<span class="lumina-rag-indicator__text">{stepText}</span>
	</div>
{/if}

<style>
	.lumina-rag-indicator {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		padding: 6px 12px;
		background: rgba(var(--interactive-accent-rgb), 0.05);
		border: 1px solid rgba(var(--interactive-accent-rgb), 0.15);
		border-radius: 6px;
		animation: fadeIn 0.3s ease;
	}

	.lumina-rag-indicator__icon-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--interactive-accent);
	}

	.lumina-rag-indicator__spinner {
		animation: spin 1s linear infinite;
	}

	.lumina-rag-indicator__text {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--interactive-accent);
		letter-spacing: 0.02em;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
