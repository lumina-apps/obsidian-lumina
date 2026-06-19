<script lang="ts">
	import { onMount } from 'svelte';
	import { Notice, MarkdownView, Keymap } from 'obsidian';
	import type LuminaPlugin from '../../../main';
	import { discoveryState, updateDiscoveryState, addToStaging, removeFromStaging, clearStaging } from '../../../core/store/discoveryStore';
	import { isRagEnabled } from '../../../core/store/settingsStore';
	import { indexingState, indexingProgress, estimatedTimeRemaining, showIndexingIndicator } from '../../../core/store/ragStore';
	import { addPendingAttachment, activeSidebarTab } from '../../../core/store/chatStore';
	import { searchVault } from '../search';
	import type { SearchResult, DocumentChunk } from '../../../shared/types/rag.types';
	import { tStore } from '../../../shared/locales/index';
	import { iconAction } from '../../../shared/utils/domUtils';
	import { extractFileName } from '../../../shared/utils/fileUtils';
	import { openNoteFile } from '../utils/openNoteFile';
	import { buildContextFromActiveFile, applyContextResult } from '../utils/discoveryContext';
	import DiscoveryCard from './DiscoveryCard.svelte';
	import DiscoveryStagingArea from './DiscoveryStagingArea.svelte';

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
				const chunks = filterChunks(plugin.indexer.indexedChunks, filterQuery);
				searchResults = await searchVault(searchQuery, chunks, texts => plugin.indexer!.embed(texts), 15, 0.60);
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

	// ── 유틸리티 함수 ──
	function filterChunks(chunks: DocumentChunk[], q: string): DocumentChunk[] {
		const trimmed = q.trim();
		if (!trimmed) return chunks;
		return chunks.filter(c => {
			if (trimmed.startsWith('#')) {
				const cache = plugin.app.metadataCache.getCache(c.path);
				const tags = cache?.tags?.map(t => t.tag) ?? [];
				const fmTags = cache?.frontmatter?.tags;
				const cleanQ = trimmed.replace('#', '');
				return tags.includes(trimmed) || (Array.isArray(fmTags) && fmTags.includes(cleanQ));
			}
			return c.path.toLowerCase().includes(trimmed.toLowerCase());
		});
	}

	async function insertLink(path: string) {
		let editor = plugin.app.workspace.activeEditor?.editor;

		if (!editor) {
			const mdView = plugin.app.workspace.getLeavesOfType('markdown')
				.map(leaf => leaf.view as MarkdownView)
				.find(view => view.editor);
			if (mdView) editor = mdView.editor;
		}

		if (editor) {
			const cursor = editor.getCursor();
			const fileName = extractFileName(path);
			editor.replaceRange(`[[${fileName}]]`, cursor);
		} else {
			new Notice($tStore('discovery.noActiveEditor'));
		}
	}

	async function insertTag(tag: string) {
		const file = $discoveryState.activeFile;
		if (!file) return;

		await plugin.app.fileManager.processFrontMatter(file, frontmatter => {
			if (!frontmatter.tags) {
				frontmatter.tags = [];
			}
			const tagValue = tag.replace('#', '');
			if (Array.isArray(frontmatter.tags)) {
				if (!frontmatter.tags.includes(tagValue)) frontmatter.tags.push(tagValue);
			} else {
				frontmatter.tags = [frontmatter.tags, tagValue];
			}
		});
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

	async function openInSplit(path: string) {
		plugin.app.workspace.openLinkText(path, '', 'split');
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
		await plugin.activateChatView();
	}

	function toggleStage(result: SearchResult) {
		const isStaged = $discoveryState.stagedItems.some(i => i.chunk.id === result.chunk.id);
		if (isStaged) {
			removeFromStaging(result.chunk.id);
		} else {
			addToStaging(result);
		}
	}

	function handleSettingsOpen() {
		// @ts-ignore - Obsidian setting API
		plugin.app.setting.open();
		// @ts-ignore
		plugin.app.setting.openTabById('lumina');
	}
</script>

<div class="lumina-discovery">
	{#if !$isRagEnabled}
		<div class="lumina-discovery__empty">
			<div class="lumina-discovery__empty-icon">🔍</div>
			<p>{$tStore('discovery.emptyStateText')}</p>
			<p class="lumina-discovery__empty-sub">{$tStore('discovery.emptyStateSub')}</p>
			<button class="lumina-discovery__setup-btn" onclick={handleSettingsOpen}>
				⚙️ {$tStore('common.settings')}
			</button>
		</div>
	{:else}
		<!-- Search Bar -->
		<div class="lumina-discovery__search-bar">
			<span class="lumina-discovery__search-icon" use:iconAction={"search"}></span>
			<input
				type="text"
				class="lumina-discovery__search-input"
				placeholder={$tStore('discovery.searchPlaceholder')}
				bind:value={searchQuery}
			/>
			{#if searchQuery}
				<button class="lumina-discovery__clear-btn" aria-label="Clear Search" onclick={() => searchQuery = ''}>
					<span use:iconAction={"x"}></span>
				</button>
			{/if}
		</div>
		<div class="lumina-discovery__search-bar" style="margin-top: 4px;">
			<span class="lumina-discovery__search-icon" use:iconAction={"filter"}></span>
			<input
				type="text"
				class="lumina-discovery__search-input"
				placeholder={$tStore('discovery.filterPlaceholder')}
				bind:value={filterQuery}
			/>
			{#if filterQuery}
				<button class="lumina-discovery__clear-btn" aria-label="Clear Filter" onclick={() => filterQuery = ''}>
					<span use:iconAction={"x"}></span>
				</button>
			{/if}
		</div>

		<!-- RAG Progress Banner -->
		{#if $showIndexingIndicator}
			<div class="lumina-discovery__rag-banner">
				<div class="lumina-discovery__rag-banner-content">
					{#if $indexingState.status === 'loading-model'}
						<strong>{$tStore('settings.rag.init.loadingModel') || 'RAG 모델 다운로드 중...'}</strong>
						<span>{$tStore('settings.rag.init.loadingModelDesc') || ''}</span>
					{:else}
						<strong>{$tStore('settings.rag.init.indexingVault') || '내 노트 인덱싱 중...'}</strong>
						<span>
							{($tStore('settings.rag.init.indexingProgressText') || '')
								.replace('{{processed}}', $indexingState.processedFiles.toString())
								.replace('{{total}}', $indexingState.totalFiles.toString())
								.replace('{{pct}}', $indexingProgress.toString())}
							{#if $estimatedTimeRemaining !== null}
								{$tStore('settings.rag.init.remainingTimePrefix') || ''}{$estimatedTimeRemaining < 60
									? ($tStore('settings.rag.init.remainingTimeSec') || '').replace('{{sec}}', $estimatedTimeRemaining.toString())
									: ($tStore('settings.rag.init.remainingTimeMinSec') || '')
											.replace('{{min}}', Math.floor($estimatedTimeRemaining / 60).toString())
											.replace('{{sec}}', ($estimatedTimeRemaining % 60).toString())}
							{/if}
						</span>
					{/if}
				</div>
			</div>
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
						<div class="lumina-discovery__results-list" class:is-updating={isSearching}>
							{#each searchResults as result (result.chunk.id)}
								<DiscoveryCard
									{result}
									isStaged={$discoveryState.stagedItems.some(i => i.chunk.id === result.chunk.id)}
									onOpen={handleOpenFile}
									onInsertLink={insertLink}
									onOpenInSplit={openInSplit}
									onToggleStage={toggleStage}
								/>
							{/each}
						</div>
					{/if}
				{:else}
					<!-- Context 모드 -->
					{#if $discoveryState.isSearching && $discoveryState.similarNotes.length === 0 && !$discoveryState.duplicateNote && $discoveryState.recommendedTags.length === 0}
						<div class="lumina-discovery__loading"><div class="spinner"></div></div>
					{:else}
						<div class="lumina-discovery__context-view" class:is-updating={$discoveryState.isSearching}>

							<!-- 중복 노트 경고 -->
							{#if $discoveryState.duplicateNote}
								{@const dupPath = $discoveryState.duplicateNote.chunk.path}
								<div class="lumina-discovery__warning-box">
									<div class="lumina-discovery__warning-title">
										<span use:iconAction={"alert-triangle"} style="display: flex; align-items: center;"></span>
										<span>{$tStore('discovery.duplicateWarning')}</span>
									</div>
									<div class="lumina-discovery__warning-link" onclick={(e) => handleOpenFile(dupPath, e)} onauxclick={(e) => handleOpenFile(dupPath, e)} role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') handleOpenFile(dupPath); }}>
										[[{extractFileName(dupPath)}]]
									</div>
								</div>
							{/if}

							<!-- 추천 태그 -->
							{#if $discoveryState.recommendedTags.length > 0}
								<div class="lumina-discovery__section">
									<div class="lumina-discovery__section-title">
										<span use:iconAction={"tags"}></span> {$tStore('discovery.recommendedTags')}
									</div>
									<div class="lumina-discovery__tags">
										{#each $discoveryState.recommendedTags as tagObj}
											<button class="lumina-discovery__tag-chip" onclick={() => insertTag(tagObj.tag)}>
												{tagObj.tag} <span class="lumina-discovery__tag-score">({Math.round(tagObj.score * 100)}%)</span> +
											</button>
										{/each}
									</div>
								</div>
							{/if}

							<!-- 유사 문서 목록 -->
							{#if $discoveryState.similarNotes.length > 0}
								<div class="lumina-discovery__section">
									<div class="lumina-discovery__section-title">
										<span use:iconAction={"network"}></span> {$tStore('discovery.relatedNotes')}
									</div>
									<div class="lumina-discovery__results-list">
										{#each $discoveryState.similarNotes as result (result.chunk.id)}
											<DiscoveryCard
												{result}
												isStaged={$discoveryState.stagedItems.some(i => i.chunk.id === result.chunk.id)}
												onOpen={handleOpenFile}
												onInsertLink={insertLink}
												onOpenInSplit={openInSplit}
												onToggleStage={toggleStage}
											/>
										{/each}
									</div>
								</div>
							{:else if $discoveryState.activeFile}
								<div class="lumina-discovery__no-results">
									<span>{$tStore('discovery.noResults')}</span>
								</div>
							{/if}

						</div>
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

	.lumina-discovery__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 20px;
		text-align: center;
		color: var(--text-muted);
	}

	.lumina-discovery__empty-icon {
		font-size: 32px;
		margin-bottom: 12px;
	}

	.lumina-discovery__empty-sub {
		font-size: 12px;
		opacity: 0.8;
		margin-top: 4px;
	}

	.lumina-discovery__setup-btn {
		margin-top: 16px;
		padding: 6px 12px;
		background: transparent;
		border: 1px solid var(--interactive-accent);
		color: var(--interactive-accent);
		border-radius: 6px;
		cursor: pointer;
	}

	.lumina-discovery__search-bar {
		display: flex;
		align-items: center;
		padding: 2px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		gap: 8px;
	}

	.lumina-discovery__search-icon {
		color: var(--text-muted);
		display: flex;
	}

	.lumina-discovery__search-input {
		flex: 1;
		border: none;
		background: transparent;
		outline: none;
		font-size: 13px;
		color: var(--text-normal);
	}

	.lumina-discovery__search-input::placeholder {
		color: var(--text-faint);
	}

	.lumina-discovery__clear-btn {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		padding: 4px;
	}

	.lumina-discovery__content {
		flex: 1;
		overflow-y: auto;
		padding: 8px 8px 16px;
	}

	.is-updating {
		opacity: 0.5;
		transition: opacity 0.2s ease;
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

	@keyframes lumina-pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.lumina-discovery__rag-banner {
		margin: 8px 8px 0;
		flex-shrink: 0;
		padding: 12px 16px;
		background: rgba(139, 92, 246, 0.08);
		border: 1px solid rgba(139, 92, 246, 0.3);
		border-radius: 8px;
		animation: lumina-pulse 2.5s ease-in-out infinite;
	}

	.lumina-discovery__rag-banner-content {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-discovery__rag-banner-content strong {
		color: var(--interactive-accent);
		font-size: 13px;
	}

	.lumina-discovery__rag-banner-content span {
		color: var(--text-muted);
		font-size: 12px;
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
</style>