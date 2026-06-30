<script lang="ts">
	import { tStore } from '../../../../shared/locales/index';
	import { iconAction } from '../../../../shared/utils/domUtils';
	import { extractFileName } from '../../../../shared/utils/fileUtils';
	import DiscoveryCard from '../DiscoveryCard.svelte';
	import type { SearchResult } from '../../../../shared/types/rag.types';
	import type { DiscoveryState } from '../../../../core/store/discoveryStore';

	let {
		discoveryState,
		isUpdating,
		stagedItems,
		onInsertTag,
		onOpenFile,
		onInsertLink,
		onOpenInSplit,
		onToggleStage,
	} = $props<{
		discoveryState: DiscoveryState;
		isUpdating: boolean;
		stagedItems: SearchResult[];
		onInsertTag: (tag: string) => void;
		onOpenFile: (path: string, e?: MouseEvent) => void;
		onInsertLink: (path: string) => void;
		onOpenInSplit: (path: string) => void;
		onToggleStage: (result: SearchResult) => void;
	}>();
</script>

<div class="lumina-discovery__context-view" class:is-updating={isUpdating}>
	<!-- 중복 노트 경고 -->
	{#if discoveryState.duplicateNote}
		{@const dupPath = discoveryState.duplicateNote.chunk.path}
		<div class="lumina-discovery__warning-box">
			<div class="lumina-discovery__warning-title">
				<span use:iconAction={"alert-triangle"} style="display: flex; align-items: center;"></span>
				<span>{$tStore('discovery.duplicateWarning')}</span>
			</div>
			<div
				class="lumina-discovery__warning-link"
				onclick={(e) => onOpenFile(dupPath, e)}
				onauxclick={(e) => onOpenFile(dupPath, e)}
				role="button"
				tabindex="0"
				onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') onOpenFile(dupPath); }}
			>
				[[{extractFileName(dupPath)}]]
			</div>
		</div>
	{/if}

	<!-- 추천 태그 -->
	{#if discoveryState.recommendedTags.length > 0}
		<div class="lumina-discovery__section">
			<div class="lumina-discovery__section-title">
				<span use:iconAction={"tags"}></span> {$tStore('discovery.recommendedTags')}
			</div>
			<div class="lumina-discovery__tags">
				{#each discoveryState.recommendedTags as tagObj}
					<button class="lumina-discovery__tag-chip" onclick={() => onInsertTag(tagObj.tag)}>
						{tagObj.tag} <span class="lumina-discovery__tag-score">({Math.round(tagObj.score * 100)}%)</span> +
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- 유사 문서 목록 -->
	{#if discoveryState.similarNotes.length > 0}
		<div class="lumina-discovery__section">
			<div class="lumina-discovery__section-title">
				<span use:iconAction={"network"}></span> {$tStore('discovery.relatedNotes')}
			</div>
			<div class="lumina-discovery__results-list">
				{#each discoveryState.similarNotes as result (result.chunk.id)}
					<DiscoveryCard
						{result}
						isStaged={stagedItems.some((i: SearchResult) => i.chunk.id === result.chunk.id)}
						onOpen={onOpenFile}
						onInsertLink={onInsertLink}
						onOpenInSplit={onOpenInSplit}
						onToggleStage={onToggleStage}
					/>
				{/each}
			</div>
		</div>
	{:else if discoveryState.activeFile}
		<div class="lumina-discovery__no-results">
			<span>{$tStore('discovery.noResults')}</span>
		</div>
	{/if}
</div>

<style>
	.is-updating {
		opacity: 0.5;
		transition: opacity 0.2s ease;
	}

	.lumina-discovery__context-view {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.lumina-discovery__warning-box {
		background: rgba(var(--color-red-rgb), 0.1);
		border: 1px solid var(--color-red);
		padding: 12px;
		border-radius: 6px;
		color: var(--text-normal);
	}

	.lumina-discovery__warning-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		font-size: 13px;
		margin-bottom: 6px;
		color: var(--text-error);
	}

	.lumina-discovery__warning-link {
		font-size: 13px;
		cursor: pointer;
		text-decoration: underline;
		font-family: var(--font-monospace);
	}

	.lumina-discovery__section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.lumina-discovery__section-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.lumina-discovery__tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.lumina-discovery__tag-chip {
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		padding: 4px 10px;
		border-radius: 12px;
		font-size: 11px;
		color: var(--text-normal);
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.lumina-discovery__tag-chip:hover {
		background: var(--interactive-accent);
		color: white;
		border-color: var(--interactive-accent);
	}

	.lumina-discovery__tag-score {
		opacity: 0.6;
		font-size: 10px;
	}

	.lumina-discovery__results-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.lumina-discovery__no-results {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		font-size: 13px;
		gap: 8px;
		padding: 20px 0;
	}
</style>
