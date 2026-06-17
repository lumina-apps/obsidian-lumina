<script lang="ts">
	import type { SearchResult } from '../../../shared/types/rag.types';
	import { tStore } from '../../../shared/locales/index';
	import { iconAction } from '../../../shared/utils/domUtils';
	import { extractFileName } from '../../../shared/utils/fileUtils';

	let {
		stagedItems,
		stagedTokenCount,
		maxTokens,
		onClear,
		onRemove,
		onStartChat
	}: {
		stagedItems: SearchResult[];
		stagedTokenCount: number;
		maxTokens: number;
		onClear: () => void;
		onRemove: (id: string) => void;
		onStartChat: () => void;
	} = $props();
</script>

<div class="lumina-discovery__staging-area">
		<div class="lumina-discovery__staging-header">
			<div class="lumina-discovery__staging-title">
				<span use:iconAction={"layers"}></span>
				{$tStore('discovery.stagedContext')} ({stagedItems.length})
			</div>
			<button class="lumina-discovery__clear-staging-btn" onclick={onClear} aria-label="Clear All">
				<span use:iconAction={"trash-2"}></span>
			</button>
		</div>
		<div class="lumina-discovery__staging-chips">
			{#each stagedItems as item (item.chunk.id)}
				<div class="lumina-discovery__staging-chip">
					<span class="lumina-discovery__staging-chip-text">
						{extractFileName(item.chunk.path)}
					</span>
					<button
						class="lumina-discovery__staging-chip-remove"
						aria-label="Remove"
						onclick={() => onRemove(item.chunk.id)}
					>
						<span use:iconAction={"x"}></span>
					</button>
				</div>
			{/each}
		</div>
		<div class="lumina-discovery__staging-footer">
			<div class="lumina-discovery__staging-progress-wrapper">
				<div
					class="lumina-discovery__staging-progress-bar"
					style="width: {Math.min(100, (stagedTokenCount / maxTokens) * 100)}%"
					class:is-danger={stagedTokenCount > maxTokens}
				></div>
				<div
					class="lumina-discovery__staging-progress-text"
					class:is-danger={stagedTokenCount > maxTokens}
				>
					{$tStore('discovery.approxTokens', {
						current: stagedTokenCount.toLocaleString(),
						max: maxTokens.toLocaleString()
					})}
				</div>
			</div>
			<button
				class="lumina-discovery__start-chat-btn"
				onclick={onStartChat}
				disabled={stagedTokenCount > maxTokens}
			>
				<span use:iconAction={"message-square"}></span>
				{$tStore('discovery.startChat', { count: stagedItems.length })}
			</button>
		</div>
</div>

<style>
	.lumina-discovery__staging-area {
		border-top: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
	}

	.lumina-discovery__staging-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.lumina-discovery__staging-title {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-normal);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.lumina-discovery__clear-staging-btn {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		padding: 4px;
		transition: color 0.2s;
	}

	.lumina-discovery__clear-staging-btn:hover {
		color: var(--text-error);
	}

	.lumina-discovery__staging-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		max-height: 80px;
		overflow-y: auto;
	}

	.lumina-discovery__staging-chip {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		padding: 4px 8px;
		border-radius: 12px;
		font-size: 11px;
		color: var(--text-normal);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.lumina-discovery__staging-chip-text {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-discovery__staging-chip-remove {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		padding: 0;
		font-size: 10px;
	}

	.lumina-discovery__staging-chip-remove:hover {
		color: var(--text-error);
	}

	.lumina-discovery__staging-footer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 4px;
	}

	.lumina-discovery__staging-progress-wrapper {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-discovery__staging-progress-bar {
		height: 4px;
		background: var(--interactive-accent);
		border-radius: 2px;
		transition: width 0.3s ease, background-color 0.3s ease;
	}

	.lumina-discovery__staging-progress-bar.is-danger {
		background: var(--text-error);
	}

	.lumina-discovery__staging-progress-text {
		font-size: 10px;
		color: var(--text-muted);
		text-align: right;
	}

	.lumina-discovery__staging-progress-text.is-danger {
		color: var(--text-error);
		font-weight: 600;
	}

	.lumina-discovery__start-chat-btn {
		background: var(--interactive-accent);
		color: white;
		border: none;
		border-radius: 6px;
		padding: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		transition: opacity 0.2s;
	}

	.lumina-discovery__start-chat-btn:hover {
		opacity: 0.9;
	}

	.lumina-discovery__start-chat-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: var(--background-modifier-border);
		color: var(--text-muted);
	}
</style>