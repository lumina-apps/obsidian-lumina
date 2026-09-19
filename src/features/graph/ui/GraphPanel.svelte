<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { TFile, type EventRef } from 'obsidian';
	import type LuminaPlugin from '../../../main';
	import { isRagEnabled } from '../../../core/store/settingsStore';
	import { indexingState } from '../../../core/store/ragStore';
	import { graphState, updateGraphState } from '../graphStore';
	import { buildGraphData, invalidateEdgeCache, type GraphData } from '../graphDataBuilder';
	import GraphControls from './GraphControls.svelte';
	import GraphCanvas from './GraphCanvas.svelte';
	import { tStore } from '../../../shared/locales/index';
	import { debugLogger } from '../../../shared/debugLogger';

	let { plugin }: { plugin: LuminaPlugin } = $props();

	let graphData = $state<GraphData | null>(null);
	let activeFileListener: EventRef | null = null;
	let lastParamsStr = '';
	let lastFocusPath: string | null = null;

	let debounceTimer: number | null = null;
	let currentAbortController: AbortController | null = null;
	let latestRequestId = 0;

	onMount(() => {
		const activeFile = plugin.app.workspace.getActiveFile();
		if (activeFile) lastFocusPath = activeFile.path;

		// Listen to active leaf changes to update 'local' mode focus
		activeFileListener = plugin.app.workspace.on('active-leaf-change', () => {
			if ($graphState.mode === 'local') {
				const newActiveFile = plugin.app.workspace.getActiveFile();
				if (newActiveFile && newActiveFile.path !== lastFocusPath) {
					lastFocusPath = newActiveFile.path;
					queueRebuild(true);
				}
			}
		});

		// Initial build
		queueRebuild(true);

		return () => {
			if (debounceTimer !== null) {
				window.clearTimeout(debounceTimer);
			}
			if (currentAbortController) {
				currentAbortController.abort();
			}
			if (activeFileListener) {
				plugin.app.workspace.offref(activeFileListener);
			}
			invalidateEdgeCache();
		};
	});

	// Watch for store changes (minSimilarity, maxK, mode, localDepth) to rebuild graph
	$effect(() => {
		const m = $graphState.mode;
		const sim = $graphState.minSimilarity;
		const k = $graphState.maxK;
		const d = $graphState.localDepth;
		const status = $indexingState.status;
		const ready = status === 'ready';
		
		if (status === 'indexing' || status === 'loading-model') {
			invalidateEdgeCache();
		}
		
		if (ready) {
			const paramsStr = JSON.stringify({ m, sim, k, d });
			if (paramsStr !== lastParamsStr) {
				lastParamsStr = paramsStr;
				untrack(() => {
					if (m === 'local') {
						const activeFile = plugin.app.workspace.getActiveFile();
						if (activeFile) lastFocusPath = activeFile.path;
					}
					queueRebuild(false);
				});
			}
		}
	});

	function queueRebuild(immediate: boolean = false) {
		if (debounceTimer !== null) {
			window.clearTimeout(debounceTimer);
			debounceTimer = null;
		}

		if (immediate) {
			void executeRebuild();
		} else {
			debounceTimer = window.setTimeout(() => {
				debounceTimer = null;
				void executeRebuild();
			}, 250);
		}
	}

	async function executeRebuild() {
		if (!$isRagEnabled || $indexingState.status !== 'ready') {
			graphData = null;
			return;
		}

		if (!plugin.indexer || plugin.indexer.indexedParentChunks.length === 0) {
			graphData = { nodes: [], links: [] };
			return;
		}

		if (currentAbortController) {
			currentAbortController.abort();
		}
		const abortController = new AbortController();
		currentAbortController = abortController;
		const requestId = ++latestRequestId;

		let focusPath: string | null = null;
		if ($graphState.mode === 'local') {
			focusPath = lastFocusPath;
		}

		try {
			const data = await buildGraphData(
				plugin.indexer.indexedParentChunks,
				plugin.indexer.indexedChildChunks,
				$graphState.minSimilarity,
				$graphState.maxK,
				$graphState.mode,
				focusPath,
				$graphState.localDepth,
				abortController.signal
			);

			if (requestId === latestRequestId && !abortController.signal.aborted) {
				graphData = data;
			}
		} catch (e) {
			if (abortController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
				return;
			}
			debugLogger.logError('graph', e instanceof Error ? e : new Error(`Graph rebuild failed: ${e}`));
			if (requestId === latestRequestId) {
				updateGraphState({ errorMessage: String(e) });
			}
		}
	}

	async function handleNodeClick(nodeId: string) {
		try {
			const file = plugin.app.vault.getAbstractFileByPath(nodeId);
			if (file instanceof TFile) {
				const leaf = plugin.app.workspace.getLeaf(false);
				await leaf.openFile(file);
			}
		} catch (e) {
			debugLogger.logError('graph', e instanceof Error ? e : new Error(`Failed to open node file ${nodeId}: ${e}`));
		}
	}
</script>

<div class="lumina-graph-panel">
	{#if !$isRagEnabled}
		<div class="lumina-graph-panel__empty">
			<div class="lumina-graph-panel__empty-icon">🔍</div>
			<p>{$tStore('discovery.emptyStateText')}</p>
			<p class="lumina-graph-panel__empty-sub">{$tStore('discovery.emptyStateSub')}</p>
		</div>
	{:else if $indexingState.status !== 'ready'}
		<div class="lumina-graph-panel__empty">
			<div class="spinner"></div>
			<p style="margin-top: 12px;">{$tStore('graph.indexing')}</p>
		</div>
	{:else if !graphData}
		<div class="lumina-graph-panel__empty">
			<div class="spinner"></div>
			<p style="margin-top: 12px;">{$tStore('graph.initializing')}</p>
		</div>
	{:else if graphData.nodes.length === 0 && !$graphState.isCalculating}
		<div class="lumina-graph-panel__empty">
			<GraphControls {plugin} {graphData} />
			<p>{$tStore('graph.noNodes')}</p>
		</div>
	{:else}
		<GraphControls {plugin} {graphData} />
		
		{#if $graphState.isCalculating}
			<div class="lumina-graph-panel__overlay">
				<div class="spinner"></div>
				<span style="margin-top: 8px;">{$tStore('graph.calculating')}</span>
			</div>
		{/if}

		{#if $graphState.errorMessage}
			<div class="lumina-graph-panel__error">
				{$graphState.errorMessage}
			</div>
		{/if}

		<GraphCanvas {graphData} onNodeClick={handleNodeClick} />
	{/if}
</div>

<style>
	.lumina-graph-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--background-primary);
		font-family: var(--font-interface);
		position: relative;
	}

	.lumina-graph-panel__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 20px;
		text-align: center;
		color: var(--text-muted);
	}

	.lumina-graph-panel__empty-icon {
		font-size: 32px;
		margin-bottom: 12px;
	}

	.lumina-graph-panel__empty-sub {
		font-size: 12px;
		opacity: 0.8;
		margin-top: 4px;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--background-modifier-border);
		border-top-color: var(--interactive-accent);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.lumina-graph-panel__overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: rgba(var(--background-primary-rgb), 0.8);
		padding: 20px;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		z-index: 50;
		color: var(--text-muted);
		border: 1px solid var(--background-modifier-border);
	}

	.lumina-graph-panel__error {
		position: absolute;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--background-modifier-error);
		color: var(--text-on-accent);
		padding: 8px 16px;
		border-radius: 6px;
		z-index: 50;
		font-size: 13px;
	}
</style>
