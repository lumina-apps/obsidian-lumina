<script lang="ts">
	import type { SearchResult } from '../../../shared/types/rag.types';
	import { tStore } from '../../../shared/locales/index';
	import { iconAction } from '../../../shared/utils/domUtils';
	import { extractFileName } from '../../../shared/utils/fileUtils';
	import TokenProgressBar from './TokenProgressBar.svelte';

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

	const safeTokenCount = $derived(Number.isFinite(stagedTokenCount) ? stagedTokenCount : 0);
	const isOverLimit = $derived(safeTokenCount > maxTokens);
</script>

<div class="lumina-discovery__staging-area">
	<!-- 헤더: 타이틀 + 전체 삭제 -->
	<div class="lumina-discovery__staging-header">
		<div class="lumina-discovery__staging-title">
			<span use:iconAction={"layers"}></span>
			{$tStore('discovery.stagedContext')} ({stagedItems.length})
		</div>
		<button
			class="lumina-discovery__clear-staging-btn"
			onclick={onClear}
			aria-label={$tStore('common.remove')}
		>
			<span use:iconAction={"trash-2"}></span>
		</button>
	</div>

	<!-- 칩 목록: stagedItems가 없으면 아무것도 렌더링하지 않음 -->
	{#if stagedItems.length > 0}
		<div class="lumina-discovery__staging-chips">
			{#each stagedItems as item (item.chunk.id)}
				<div class="lumina-discovery__staging-chip">
					<span class="lumina-discovery__staging-chip-text">
						{extractFileName(item.chunk.path)}
					</span>
					<button
						class="lumina-discovery__staging-chip-remove"
						aria-label={$tStore('common.remove')}
						onclick={() => onRemove(item.chunk.id)}
					>
						<span use:iconAction={"x"}></span>
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- 푸터: 토큰 진행률 + 채팅 시작 버튼 -->
	<div class="lumina-discovery__staging-footer">
		<TokenProgressBar
			current={safeTokenCount}
			max={maxTokens}
		/>

		<button
			class="lumina-discovery__start-chat-btn"
			onclick={onStartChat}
			disabled={isOverLimit || stagedItems.length === 0}
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