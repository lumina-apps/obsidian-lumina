<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type LuminaPlugin from '../../../main';
	import {
		discoveryState,
		updateDiscoveryState,
		addToStaging,
		removeFromStaging,
		clearStaging
	} from '../../../core/store/discoveryStore';
	import { isRagEnabled, settingsStore } from '../../../core/store/settingsStore';
	import { indexingState, showIndexingIndicator } from '../../../core/store/ragStore';
	import {
		addPendingAttachment,
		activeSidebarTab,
		sessionModelId,
		sessionProviderId
	} from '../../../core/store/chatStore';
	import { searchVault } from '../search';
	import type { SearchResult } from '../../../shared/types/rag.types';
	import { tStore } from '../../../shared/locales/index';
	import { getEffectiveContextLimit } from '../../../shared/utils/modelUtils';
	import { extractFileName, insertTagIntoFrontmatter } from '../../../shared/utils/fileUtils';
	import { openNoteFile } from '../utils/openNoteFile';
	import { buildContextFromActiveFile, applyContextResult } from '../utils/discoveryContext';
	import { estimateFileTokens } from '../utils/stagingUtils';
	import DiscoveryStagingArea from './DiscoveryStagingArea.svelte';
	import { activateView } from '../../../core/views/viewHelper';
	import { CHAT_VIEW_TYPE } from '../../../shared/constants/viewTypes';

	// Components
	import DiscoverySearchBar from './components/DiscoverySearchBar.svelte';
	import DiscoveryRagBanner from './components/DiscoveryRagBanner.svelte';
	import DiscoveryEmptyState from './components/DiscoveryEmptyState.svelte';
	import DiscoveryContextView from './components/DiscoveryContextView.svelte';
	import DiscoverySearchResults from './components/DiscoverySearchResults.svelte';

	// Utils
	import { filterParentChunks } from '../utils/searchUtils';
	import { insertLinkToActiveEditor } from '../../../shared/utils/editorUtils';
	import { Notice, Keymap, type TFile } from 'obsidian';
	import { debugLogger } from '../../../shared/debugLogger';
	import { normalizeError } from '../../../shared/utils/errorUtils';

	let { plugin, isActive }: { plugin: LuminaPlugin; isActive: boolean } = $props();

	// ── 로컬 상태 ──
	let searchQuery = $state('');
	let filterQuery = $state('');
	let searchResults = $state<SearchResult[]>([]);
	let isSearching = $state(false);
	let hasBeenReady = $state(false);
	let contextTimer: ReturnType<typeof setTimeout> | null = null;
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	let lastContextKey = $state<string | null>(null);
	let contextSeq = 0;
	let searchSeq = 0;

	// ── Derived ──
	let stagedTokenCount = $derived(
		$discoveryState.stagedItems.reduce((acc, item) => acc + item.tokens, 0)
	);
	const activeProject = $derived(
		plugin.settings.projects?.list?.find(p => p.id === plugin.settings.projects?.activeProjectId)
	);
	const fallbackModelId = $derived(activeProject?.defaultModelId);
	const fallbackProviderId = $derived(activeProject?.defaultProviderId);

	const currentProvider = $derived(
		(plugin.settings.connections?.providers ?? []).find(p => p.id === ($sessionProviderId ?? fallbackProviderId))
	);
	const maxTokens = $derived(
		getEffectiveContextLimit(
			$sessionModelId ?? fallbackModelId,
			$settingsStore?.chat,
			currentProvider?.type
		)
	);

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

	// ready 상태 감지
	$effect(() => {
		if ($indexingState.status === 'ready') {
			hasBeenReady = true;
		}
	});

	// ── Context 갱신 (활성 노트 변경 / 필터 변경 시) ──
	async function updateContext(file: TFile, currentFilter: string, key: string) {
		if (!isActive || !$isRagEnabled) return;
		const currentSeq = ++contextSeq;
		lastContextKey = key;

		try {
			updateDiscoveryState({ isSearching: true });
			const result = await buildContextFromActiveFile(plugin, file, currentFilter);
			// 최신 요청이고 현재 활성 파일이 맞을 때만 상태 적용 (비동기 경쟁 방지)
			if (currentSeq === contextSeq && $discoveryState.activeFile?.path === file.path) {
				applyContextResult(result, file.path);
			}
		} catch (err) {
			debugLogger.logError('rag', normalizeError(err, `Context 업데이트 실패: ${err}`));
			if (currentSeq === contextSeq) {
				lastContextKey = null; // 오류 발생 시 다음 번에 재시도 가능하도록 복원
				updateDiscoveryState({ isSearching: false });
			}
		}
	}

	// ── 사용자 검색어 기반 시맨틱 검색 ──
	async function performSearch(queryToSearch: string, currentFilter: string) {
		if (!$isRagEnabled || !queryToSearch.trim()) {
			searchResults = [];
			return;
		}

		const currentSeq = ++searchSeq;
		isSearching = true;

		try {
			if (plugin.indexer) {
				const chunks = filterParentChunks(plugin.app, plugin.indexer.indexedParentChunks, currentFilter);
				const allowedPaths = currentFilter ? Array.from(new Set(chunks.map(c => c.path))) : null;
				const results = await searchVault(
					queryToSearch,
					chunks,
					plugin.indexer.oramaDb,
					texts => plugin.indexer!.embed(texts),
					15,
					0.60,
					0.5,
					allowedPaths
				);
				if (currentSeq === searchSeq) {
					searchResults = results;
				}
			}
		} catch (err) {
			debugLogger.logError('rag', normalizeError(err, `Semantic Search 실패: ${err}`));
			if (currentSeq === searchSeq) {
				new Notice($tStore('discovery.searchFailed'));
			}
		} finally {
			if (currentSeq === searchSeq) {
				isSearching = false;
			}
		}
	}

	// ── $effect: activeFile/isActive/filterQuery/인덱싱 상태 감지 (Context 모드) ──
	$effect(() => {
		const file = $discoveryState.activeFile;
		const status = $indexingState.status;
		const active = isActive;
		const filter = filterQuery;
		const canSearch = status === 'ready' || hasBeenReady;

		if (contextTimer) clearTimeout(contextTimer);

		if (!file) {
			const state = untrack(() => $discoveryState);
			if (
				state.similarNotes.length > 0 ||
				state.duplicateNote !== null ||
				state.recommendedTags.length > 0 ||
				state.lastSearchedFilePath !== null
			) {
				updateDiscoveryState({
					similarNotes: [],
					duplicateNote: null,
					recommendedTags: [],
					lastSearchedFilePath: null
				});
			}
			lastContextKey = null;
			return;
		}

		if (active && canSearch) {
			const mtime = file.stat?.mtime ?? 0;
			const currentKey = `${file.path}|${filter}|${mtime}`;
			if (currentKey !== lastContextKey) {
				contextTimer = setTimeout(() => {
					void updateContext(file, filter, currentKey);
				}, 600);
			}
		}

		return () => {
			if (contextTimer) clearTimeout(contextTimer);
		};
	});

	// ── $effect: searchQuery/filterQuery 감지 (검색 모드) ──
	$effect(() => {
		const q = searchQuery;
		const filter = filterQuery;
		const status = $indexingState.status;
		const canSearch = status === 'ready' || hasBeenReady;

		if (searchTimer) clearTimeout(searchTimer);

		if (q.trim() && canSearch) {
			searchTimer = setTimeout(() => {
				void performSearch(q, filter);
			}, 400);
		} else if (!q.trim()) {
			searchResults = [];
			isSearching = false;
		}

		return () => {
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	// ── 핸들러 함수 ──
	function handleInsertLink(path: string) {
		const success = insertLinkToActiveEditor(plugin.app, path, $discoveryState.activeFile?.path);
		if (!success) {
			new Notice($tStore('discovery.noActiveEditor'));
		}
	}

	async function handleInsertTag(tag: string) {
		const file = $discoveryState.activeFile;
		if (!file) return;
		try {
			await insertTagIntoFrontmatter(plugin.app, file, tag);
			updateDiscoveryState({
				recommendedTags: $discoveryState.recommendedTags.filter(t => t.tag !== tag)
			});
			new Notice($tStore('discovery.tagInserted', { tag }));
		} catch (err) {
			debugLogger.logError('rag', normalizeError(err, `태그 추가 실패: ${err}`));
			new Notice($tStore('discovery.tagInsertFailed'));
		}
	}

	async function handleOpenFile(path: string, e?: MouseEvent, chunkText?: string) {
		if (e && e.button !== 0 && e.button !== 1) return;
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

	async function handleToggleStage(result: SearchResult) {
		const path = result.chunk.path;
		const isStaged = $discoveryState.stagedItems.some(i => i.path === path);
		if (isStaged) {
			removeFromStaging(path);
		} else {
			const fileName = extractFileName(path);
			const tokens = await estimateFileTokens(plugin, path);
			addToStaging({ path, name: fileName, tokens });
		}
	}

	async function startChatWithStaged() {
		for (const item of $discoveryState.stagedItems) {
			addPendingAttachment({
				type: 'file',
				path: item.path,
				name: item.name,
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
			{#if $indexingState.status === 'error'}
				<div class="lumina-discovery__error-box">
					<span class="lumina-discovery__error-title">
						{$tStore('discovery.indexError')}
					</span>
					{#if $indexingState.errorMessage}
						<span class="lumina-discovery__error-detail">{$indexingState.errorMessage}</span>
					{/if}
				</div>
			{:else if $indexingState.status === 'ready' || hasBeenReady}
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

	.lumina-discovery__error-box {
		margin: 12px 4px;
		padding: 12px;
		background: rgba(var(--color-red-rgb), 0.1);
		border: 1px solid var(--color-red);
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.lumina-discovery__error-title {
		font-weight: 600;
		font-size: 13px;
		color: var(--text-error);
	}

	.lumina-discovery__error-detail {
		font-size: 12px;
		color: var(--text-muted);
		word-break: break-all;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>