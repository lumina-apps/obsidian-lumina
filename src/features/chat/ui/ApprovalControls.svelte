<script lang="ts">
	import { t } from '../../../shared/locales/helpers';

	interface Props {
		status?: 'pending' | 'accepted' | 'rejected';
		onAccept: () => void;
		onReject: () => void;
	}

	const { status = 'pending', onAccept, onReject }: Props = $props();
</script>

<div class="approval-controls">
	{#if status === 'pending'}
		<button class="accept-btn" onclick={onAccept}>{t('uiMessages.actionApproval.accept')}</button>
		<button class="reject-btn" onclick={onReject}>{t('uiMessages.actionApproval.reject')}</button>
	{:else if status === 'accepted'}
		<span class="status-label accepted">✓ {t('uiMessages.actionApproval.chunkAcceptedShort')}</span>
	{:else if status === 'rejected'}
		<span class="status-label rejected">✕ {t('uiMessages.actionApproval.chunkRejectedShort')}</span>
	{/if}
</div>

<style>
	.approval-controls {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	button {
		padding: 4px 12px;
		font-size: 0.9em;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-weight: 500;
	}

	.accept-btn {
		background-color: var(--interactive-success);
		color: var(--text-on-accent);
	}

	.accept-btn:hover {
		background-color: var(--interactive-success-hover);
	}

	.reject-btn {
		background-color: var(--interactive-normal);
		color: var(--text-normal);
		border: 1px solid var(--background-modifier-border);
	}

	.reject-btn:hover {
		background-color: var(--background-modifier-hover);
	}

	.status-label {
		font-size: 0.9em;
		font-weight: bold;
	}

	.status-label.accepted {
		color: var(--text-success);
	}

	.status-label.rejected {
		color: var(--text-error);
	}
</style>
