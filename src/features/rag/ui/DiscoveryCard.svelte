<script lang="ts">
	import type { SearchResult } from '../../../shared/types/rag.types';
	import { tStore } from '../../../shared/locales/index';
	import { iconAction } from '../../../shared/utils/domUtils';
	import { extractFileName } from '../../../shared/utils/fileUtils';

	let {
		result,
		searchQuery = '',
		isStaged = false,
		onOpen,
		onInsertLink,
		onOpenInSplit,
		onToggleStage
	}: {
		result: SearchResult;
		searchQuery?: string;
		isStaged?: boolean;
		onOpen: (path: string, e?: MouseEvent, chunkText?: string) => void;
		onInsertLink: (path: string) => void;
		onOpenInSplit: (path: string) => void;
		onToggleStage: (result: SearchResult) => void;
	} = $props();

	function handleOpen(e: MouseEvent) {
		onOpen(result.chunk.path, e, result.bestChildText || result.chunk.text);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onOpen(result.chunk.path, undefined, result.bestChildText || result.chunk.text);
		}
	}

	function handleStage() {
		onToggleStage(result);
	}

	/** 표시용 연관도 점수. rawVectorScore(순수 코사인 유사도 0~1)를 우선 사용하고,
	 *  없을 경우 vectorScore 클램프 → score 순으로 fallback합니다. */
	let displayScore = $derived(
		result.rawVectorScore != null
			? result.rawVectorScore
			: result.vectorScore != null
				? Math.min(1, result.vectorScore)
				: result.score
	);

	let snippetText = $derived.by(() => {
		let text = result.bestChildText;
		if (!text) {
			const fullText = result.chunk.text;
			if (searchQuery.trim()) {
				const lowerText = fullText.toLowerCase();
				const queryTerms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 0);
				let bestIndex = 0;
				for (const term of queryTerms) {
					const idx = lowerText.indexOf(term);
					if (idx !== -1) {
						bestIndex = Math.max(0, idx - 50);
						break;
					}
				}
				text = fullText.substring(bestIndex, bestIndex + 300);
			} else {
				text = fullText;
			}
		}
		return text.substring(0, 150) + '...';
	});
</script>

<div class="lumina-discovery__card">
	<div
		class="lumina-discovery__card-header"
		onclick={handleOpen}
		onauxclick={handleOpen}
		role="button"
		tabindex="0"
		onkeydown={handleKeydown}
	>
		<span class="lumina-discovery__card-title">
			{extractFileName(result.chunk.path)}
		</span>
		<span class="lumina-discovery__card-score">{Math.round(displayScore * 100)}%</span>
	</div>
	<div
		class="lumina-discovery__card-snippet"
		onclick={handleOpen}
		onauxclick={handleOpen}
		role="button"
		tabindex="0"
		onkeydown={handleKeydown}
	>
		{snippetText}
	</div>
	<div class="lumina-discovery__card-actions">
		<button class="lumina-discovery__action-btn" onclick={() => onInsertLink(result.chunk.path)}>
			<span use:iconAction={"link"}></span> {$tStore('discovery.insertLink')}
		</button>
		<button class="lumina-discovery__action-btn" onclick={() => onOpenInSplit(result.chunk.path)}>
			<span use:iconAction={"columns"}></span> {$tStore('discovery.openInSplit')}
		</button>
		{#if isStaged}
			<button class="lumina-discovery__action-btn is-staged" onclick={handleStage}>
				<span use:iconAction={"minus-circle"}></span> {$tStore('common.remove')}
			</button>
		{:else}
			<button class="lumina-discovery__action-btn" onclick={handleStage}>
				<span use:iconAction={"plus-circle"}></span> {$tStore('common.add')}
			</button>
		{/if}
	</div>
</div>

<style>
	.lumina-discovery__card {
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 8px 10px 6px 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
	}

	.lumina-discovery__card:hover {
		border-color: var(--interactive-accent);
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.lumina-discovery__card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		cursor: pointer;
	}

	.lumina-discovery__card-title {
		font-weight: 600;
		font-size: 12px;
		color: var(--text-normal);
		word-break: break-all;
		line-height: 1.2;
	}

	.lumina-discovery__card-score {
		font-size: 10px;
		color: var(--interactive-accent);
		background: var(--background-primary-alt);
		padding: 2px 5px;
		border-radius: 4px;
		font-weight: 700;
	}

	.lumina-discovery__card-snippet {
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.3;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		cursor: pointer;
	}

	.lumina-discovery__card-actions {
		display: flex;
		justify-content: flex-end;
		gap: 4px;
		margin-top: 2px;
	}

	.lumina-discovery__action-btn {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		padding: 3px 6px;
		font-size: 10px;
		border-radius: 4px;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 4px;
		transition: all 0.2s;
	}

	.lumina-discovery__action-btn:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.lumina-discovery__action-btn.is-staged {
		color: var(--text-error);
		border-color: rgba(var(--color-red-rgb), 0.3);
	}

	.lumina-discovery__action-btn.is-staged:hover {
		background: rgba(var(--color-red-rgb), 0.1);
	}
</style>