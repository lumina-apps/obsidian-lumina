<script lang="ts">
	import { onMount } from 'svelte';
	import type LuminaPlugin from '../../../main';
	import { discoveryState, updateDiscoveryState, addToStaging, removeFromStaging, clearStaging } from '../../../core/store/discoveryStore';
	import { isRagEnabled } from '../../../core/store/settingsStore';
	import { indexingState, showIndexingIndicator } from '../../../core/store/ragStore';
	import { addPendingAttachment, activeSidebarTab } from '../../../core/store/chatStore';
	import { searchVault } from '../search';
	import type { SearchResult } from '../../../shared/types/rag.types';
	import { tStore } from '../../../shared/locales/index';
	import { extractFileName, insertTagIntoFrontmatter } from '../../../shared/utils/fileUtils';
	import { openNoteFile } from '../utils/openNoteFile';
	import { buildContextFromActiveFile, applyContextResult } from '../utils/discoveryContext';
	import DiscoveryStagingArea from './DiscoveryStagingArea.svelte';
	import { activateView } from '../../../core/views/viewHelper';
	import { CHAT_VIEW_TYPE } from '../../chat/chatView';

	// Components
	import DiscoverySearchBar from './components/DiscoverySearchBar.svelte';
	import DiscoveryRagBanner from './components/DiscoveryRagBanner.svelte';
	import DiscoveryEmptyState from './components/DiscoveryEmptyState.svelte';
	import DiscoveryContextView from './components/DiscoveryContextView.svelte';
	import DiscoverySearchResults from './components/DiscoverySearchResults.svelte';

	// Utils
	import { filterParentChunks } from '../utils/searchUtils';
	import { insertLinkToActiveEditor } from '../../../shared/utils/editorUtils';
	import { Notice, Keymap } from 'obsidian';

	let { plugin, isActive }: { plugin: LuminaPlugin; isActive: boolean } = $props();

	// ── 로컬 상태 ──
	let searchQuery = $state('');
	let filterQuery = $state('');
	let searchResults = $state<SearchResult[]>([]);
	let isSearching = $state(false);
	let contextTimer: ReturnType<typeof setTimeout> | null = null;
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	let lastSearchedFilePath = $state<string | null>(null);

	// ── Derived ──
	let stagedTokenCount = $derived(
		$discoveryState.stagedItems.reduce((acc, item) => acc + Math.floor(item.chunk.text.length / 4), 0)
	);
	let maxTokens = $derived(plugin.settings.chat.maxContextTokens || 128000);

	// ── 마운트 시 활성 파일 초기화 ──
	onMount(() => {
		if (!$discoveryState.activeFile) {
			const active = plugin.app.workspace.getActiveFile();
			if (active && active.extension === 'md') {
				updateDiscoveryState({ activeFile: active });
			}
		}

		return () => {
			if (contextTimer) clearTimeout(contextTimer);
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	// ── Context 갱신 (활성 노트 변경 시) ──
	async function updateContext() {
		if (!isActive || !$isRagEnabled || $indexingState.status !== 'ready') return;
		const file = $discoveryState.activeFile;

		if (!file) {
			updateDiscoveryState({ similarNotes: [], duplicateNote: null, recommendedTags: [], lastSearchedFilePath: null });
			lastSearchedFilePath = null;
			return;
		}

		if (file.path === lastSearchedFilePath) return;
		lastSearchedFilePath = file.path;

		try {
			updateDiscoveryState({ isSearching: true });
			const result = await buildContextFromActiveFile(plugin, file, filterQuery);
			applyContextResult(result, file.path);
		} catch (err) {
			console.error('[Lumina] Context 업데이트 실패:', err);
			updateDiscoveryState({ isSearching: false });
		}
	}

	// ── 사용자 검색어 기반 시맨틱 검색 ──
	async function performSearch() {
		if (!$isRagEnabled || $indexingState.status !== 'ready' || !searchQuery.trim()) {
			searchResults = [];
			return;
		}

		try {
			isSearching = true;
			if (plugin.indexer) {
				const chunks = filterParentChunks(plugin.app, plugin.indexer.indexedParentChunks, filterQuery);
				searchResults = await searchVault(searchQuery, chunks, plugin.indexer.oramaDb, texts => plugin.indexer!.embed(texts), 15, 0.60);
			}
		} catch (err) {
			console.error('[Lumina] Semantic Search 실패:', err);
		} finally {
			isSearching = false;
		}
	}

	// ── $effect: activeFile/isActive/인덱싱 상태 감지 (Context 모드) ──
	$effect(() => {
		const file = $discoveryState.activeFile;
		const status = $indexingState.status;
		const active = isActive;

		if (contextTimer) clearTimeout(contextTimer);

		if (active && file && status === 'ready') {
			contextTimer = setTimeout(() => {
				updateContext();
			}, 1000);
		} else if (!active || !file || status !== 'ready') {
			lastSearchedFilePath = null;
		}

		return () => {
			if (contextTimer) clearTimeout(contextTimer);
		};
	});

	// ── $effect: searchQuery/filterQuery 감지 (검색 모드) ──
	$effect(() => {
		const q = searchQuery;
		const status = $indexingState.status;

		if (searchTimer) clearTimeout(searchTimer);

		if (q.trim() && status === 'ready') {
			searchTimer = setTimeout(() => {
				performSearch();
			}, 500);
		} else if (!q.trim()) {
			searchResults = [];
		}

		return () => {
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	// ── 핸들러 함수 ──
	function handleInsertLink(path: string) {
		const success = insertLinkToActiveEditor(plugin.app, path);
		if (!success) {
			new Notice($tStore('discovery.noActiveEditor'));
		}
	}

	async function handleInsertTag(tag: string) {
		const file = $discoveryState.activeFile;
		if (!file) return;
		await insertTagIntoFrontmatter(plugin.app, file, tag);
	}

	async function handleOpenFile(path: string, e?: MouseEvent, chunkText?: string) {
		const newLeaf: boolean = e ? !!(Keymap.isModEvent(e) || e.button === 1) : false;
		await openNoteFile({
			workspace: plugin.app.workspace,
			vault: plugin.app.vault,
			path,
			newLeaf,
			chunkText,
		});
	}

	async function handleOpenInSplit(path: string) {
		plugin.app.workspace.openLinkText(path, '', 'split');
	}

	function handleToggleStage(result: SearchResult) {
		const isStaged = $discoveryState.stagedItems.some(i => i.chunk.id === result.chunk.id);
		if (isStaged) {
			removeFromStaging(result.chunk.id);
		} else {
			addToStaging(result);
		}
	}

	async function startChatWithStaged() {
		for (const item of $discoveryState.stagedItems) {
			const fileName = extractFileName(item.chunk.path);
			addPendingAttachment({
				type: 'file',
				path: item.chunk.path,
				name: fileName,
			});
		}
		clearStaging();
		$activeSidebarTab = 'chat';
		await activateView(plugin.app.workspace, CHAT_VIEW_TYPE);
	}

</script>

<div class="lumina-discovery">
	{#if !$isRagEnabled}
		<DiscoveryEmptyState app={plugin.app} />
	{:else}
		<!-- Search Bar -->
		<DiscoverySearchBar bind:searchQuery bind:filterQuery />

		<!-- RAG Progress Banner -->
		{#if $showIndexingIndicator}
			<DiscoveryRagBanner />
		{/if}

		<div class="lumina-discovery__content">
			{#if $indexingState.status === 'ready'}
				{#if searchQuery.trim()}
					<!-- 검색 모드 -->
					{#if isSearching && searchResults.length === 0}
						<div class="lumina-discovery__loading"><div class="spinner"></div></div>
					{:else if searchResults.length === 0}
						<div class="lumina-discovery__no-results">
							<span>{$tStore('discovery.noResults')}</span>
						</div>
					{:else}
						<DiscoverySearchResults
							{searchResults}
							{searchQuery}
							{isSearching}
							stagedItems={$discoveryState.stagedItems}
							onOpenFile={handleOpenFile}
							onInsertLink={handleInsertLink}
							onOpenInSplit={handleOpenInSplit}
							onToggleStage={handleToggleStage}
						/>
					{/if}
				{:else}
					<!-- Context 모드 -->
					{#if $discoveryState.isSearching && $discoveryState.similarNotes.length === 0 && !$discoveryState.duplicateNote && $discoveryState.recommendedTags.length === 0}
						<div class="lumina-discovery__loading"><div class="spinner"></div></div>
					{:else}
						<DiscoveryContextView
							discoveryState={$discoveryState}
							isUpdating={$discoveryState.isSearching}
							stagedItems={$discoveryState.stagedItems}
							onInsertTag={handleInsertTag}
							onOpenFile={handleOpenFile}
							onInsertLink={handleInsertLink}
							onOpenInSplit={handleOpenInSplit}
							onToggleStage={handleToggleStage}
						/>
					{/if}
				{/if}
			{/if}
		</div>

		{#if $discoveryState.stagedItems.length > 0}
			<DiscoveryStagingArea
				stagedItems={$discoveryState.stagedItems}
				{stagedTokenCount}
				{maxTokens}
				onClear={clearStaging}
				onRemove={removeFromStaging}
				onStartChat={startChatWithStaged}
			/>
		{/if}
	{/if}
</div>

<style>
	.lumina-discovery {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--background-primary);
		font-family: var(--font-interface);
	}

	.lumina-discovery__content {
		flex: 1;
		overflow-y: auto;
		padding: 8px 8px 16px;
	}

	/* Scrollbar */
	.lumina-discovery__content::-webkit-scrollbar {
		width: 6px;
	}
	.lumina-discovery__content::-webkit-scrollbar-thumb {
		background: var(--background-modifier-border);
		border-radius: 3px;
	}

	.lumina-discovery__loading,
	.lumina-discovery__no-results {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		font-size: 13px;
		gap: 8px;
		padding: 20px 0;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--background-modifier-border);
		border-top-color: var(--interactive-accent);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>