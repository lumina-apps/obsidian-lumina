<script lang="ts">
	import { graphState, updateGraphState } from '../graphStore';
	import { tStore } from '../../../shared/locales/index';
	import { iconAction } from '../../../shared/utils/domUtils';
	import type LuminaPlugin from '../../../main';
	import type { GraphData } from '../graphDataBuilder';
	import { generateCanvasForRagGraph } from '../../canvas/canvasGenerator';

	let { plugin, graphData }: { plugin: LuminaPlugin; graphData: GraphData | null } = $props();

	let expanded = $state(false);
	let searchValue = $state($graphState.searchQuery);
	let isExporting = $state(false);

	$effect(() => {
		updateGraphState({ searchQuery: searchValue });
	});

	function toggleMode() {
		updateGraphState({ mode: $graphState.mode === 'local' ? 'global' : 'local' });
	}

	async function handleExportToCanvas() {
		if (!graphData || graphData.nodes.length === 0 || isExporting) return;
		isExporting = true;
		try {
			await generateCanvasForRagGraph(
				plugin.app,
				graphData,
				{
					showSimilarityLabel: false,
					showGroups: plugin.settings.canvas.showFolderGroups,
				},
				plugin.settings.canvas.outputPath,
			);
		} finally {
			isExporting = false;
		}
	}
</script>

<div class="lumina-graph-controls" class:expanded>
	<div class="lumina-graph-controls__header" onclick={() => expanded = !expanded} role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') expanded = !expanded; }}>
		<div class="lumina-graph-controls__title">
			<span use:iconAction={"settings"} style="width:14px; height:14px; display:inline-block;"></span>
			{$tStore('graph.settings')}
		</div>
		<div class="lumina-graph-controls__toggle">
			<span use:iconAction={expanded ? "chevron-up" : "chevron-down"} style="width:16px; height:16px; display:inline-block;"></span>
		</div>
	</div>

	{#if expanded}
		<div class="lumina-graph-controls__body">
			<!-- Mode Toggle -->
			<div class="lumina-graph-controls__segment">
				<button 
					class="lumina-graph-controls__segment-btn" 
					class:active={$graphState.mode === 'global'}
					onclick={() => updateGraphState({ mode: 'global' })}
				>
					{$tStore('graph.globalMode')}
				</button>
				<button 
					class="lumina-graph-controls__segment-btn" 
					class:active={$graphState.mode === 'local'}
					onclick={() => updateGraphState({ mode: 'local' })}
				>
					{$tStore('graph.localMode')}
				</button>
			</div>

			<!-- Search Bar -->
			<div class="lumina-graph-controls__search">
				<span class="lumina-graph-controls__search-icon" use:iconAction={"search"}></span>
				<input
					type="text"
					class="lumina-graph-controls__search-input"
					placeholder={$tStore('graph.searchPlaceholder')}
					bind:value={searchValue}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							if (e.isComposing) return; // 한글 등 IME 조합 중 엔터 처리 무시
							e.currentTarget.blur();
						}
					}}
				/>
				{#if searchValue}
					<button class="lumina-graph-controls__clear-btn" aria-label={$tStore('graph.clearSearch')} onclick={() => searchValue = ''}>
						<span use:iconAction={"x"} style="width:14px; height:14px; display:inline-block;"></span>
					</button>
				{/if}
			</div>

			<!-- Similarity Slider -->
			<div class="lumina-graph-controls__slider-row">
				<div class="lumina-graph-controls__slider-label">
					<span>{$tStore('graph.similarity')}</span>
					<span>{$graphState.minSimilarity.toFixed(2)}</span>
				</div>
				<input 
					type="range" 
					min="0.4" max="0.99" step="0.01" 
					value={$graphState.minSimilarity}
					oninput={(e) => updateGraphState({ minSimilarity: parseFloat(e.currentTarget.value) })}
				/>
			</div>

			<!-- Max Links Slider -->
			<div class="lumina-graph-controls__slider-row">
				<div class="lumina-graph-controls__slider-label">
					<span>{$tStore('graph.maxLinks')}</span>
					<span>{$graphState.maxK}</span>
				</div>
				<input 
					type="range" 
					min="1" max="20" step="1" 
					value={$graphState.maxK}
					oninput={(e) => updateGraphState({ maxK: parseInt(e.currentTarget.value) })}
				/>
			</div>

			{#if $graphState.mode === 'local'}
				<!-- Local Depth Slider -->
				<div class="lumina-graph-controls__slider-row">
					<div class="lumina-graph-controls__slider-label">
						<span>{$tStore('graph.localDepth')}</span>
						<span>{$graphState.localDepth}</span>
					</div>
					<input 
						type="range" 
						min="1" max="5" step="1" 
						value={$graphState.localDepth}
						oninput={(e) => updateGraphState({ localDepth: parseInt(e.currentTarget.value) })}
					/>
				</div>
			{/if}

			<!-- Export to Canvas -->
			<button
				class="lumina-graph-controls__export-btn"
				onclick={handleExportToCanvas}
				disabled={isExporting || !graphData || graphData.nodes.length === 0}
			>
				<span use:iconAction={"share-2"} style="width:14px; height:14px; display:inline-block; flex-shrink:0;"></span>
				{isExporting ? $tStore('graph.exporting') : $tStore('graph.exportToCanvas')}
			</button>
		</div>
	{/if}
</div>

<style>
	.lumina-graph-controls {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 260px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		z-index: 10;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		font-family: var(--font-interface);
		color: var(--text-normal);
		display: flex;
		flex-direction: column;
	}

	.lumina-graph-controls__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		cursor: pointer;
		user-select: none;
	}

	.lumina-graph-controls__title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
	}

	.lumina-graph-controls__toggle {
		color: var(--text-muted);
		display: flex;
		align-items: center;
	}

	.lumina-graph-controls__body {
		padding: 12px;
		border-top: 1px solid var(--background-modifier-border);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.lumina-graph-controls__segment {
		display: flex;
		background: var(--background-primary);
		border-radius: 6px;
		padding: 2px;
		border: 1px solid var(--background-modifier-border);
	}

	.lumina-graph-controls__segment-btn {
		flex: 1;
		background: transparent;
		border: none;
		padding: 4px 0;
		font-size: 12px;
		color: var(--text-muted);
		border-radius: 4px;
		cursor: pointer;
		text-align: center;
	}

	.lumina-graph-controls__segment-btn.active {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		font-weight: 600;
	}

	.lumina-graph-controls__search {
		display: flex;
		align-items: center;
		padding: 4px 8px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		border-radius: 6px;
		gap: 6px;
	}

	.lumina-graph-controls__search-icon {
		color: var(--text-muted);
		display: flex;
		width: 14px;
		height: 14px;
	}

	.lumina-graph-controls__search-input {
		flex: 1;
		border: none;
		background: transparent;
		outline: none;
		font-size: 12px;
		color: var(--text-normal);
		padding: 0;
	}

	.lumina-graph-controls__clear-btn {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		padding: 2px;
	}

	.lumina-graph-controls__slider-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 4px;
	}

	.lumina-graph-controls__slider-label {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--text-muted);
	}

	input[type=range] {
		width: 100%;
		margin: 4px 0 0 0;
		accent-color: var(--interactive-accent);
	}

	.lumina-graph-controls__export-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		padding: 6px 10px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		border: none;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s ease;
	}

	.lumina-graph-controls__export-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.lumina-graph-controls__export-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
