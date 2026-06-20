<script lang="ts">
	export let status: 'pending' | 'accepted' | 'rejected' = 'pending';
	export let onAccept: () => void;
	export let onReject: () => void;
</script>

<div class="approval-controls">
	{#if status === 'pending'}
		<button class="accept-btn" on:click={onAccept}>Accept</button>
		<button class="reject-btn" on:click={onReject}>Reject</button>
	{:else if status === 'accepted'}
		<span class="status-label accepted">✓ Accepted</span>
	{:else if status === 'rejected'}
		<span class="status-label rejected">✕ Rejected</span>
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
