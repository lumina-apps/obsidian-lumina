<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Notice, setIcon, MarkdownView, Keymap, TFile } from 'obsidian';
	import type LuminaPlugin from '../../../main';
	import { discoveryState, updateDiscoveryState, addToStaging, removeFromStaging, clearStaging } from '../../../core/store/discoveryStore';
	import { isRagEnabled, settingsStore } from '../../../core/store/settingsStore';
	import { indexingState, indexingProgress, estimatedTimeRemaining, showIndexingIndicator } from '../../../core/store/ragStore';
	import { addPendingAttachment, activeSidebarTab } from '../../../core/store/chatStore';
	import { searchVault, extractRecommendedTags } from '../search';
	import type { SearchResult } from '../../../shared/types/rag.types';
	import { tStore } from '../../../shared/locales/index';

	let { plugin, isActive }: { plugin: LuminaPlugin, isActive: boolean } = $props();

	// 로컬 상태
	let searchQuery = $state('');
	let filterQuery = $state('');
	let searchResults = $state<SearchResult[]>([]);
	let isSearching = $state(false);

	// Context 모드용 타이머 (디바운스)
	let contextTimer: ReturnType<typeof setTimeout> | null = null;
	// 검색 모드용 타이머
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	// 컴포넌트 마운트 시 활성 파일 초기화 (만약 store가 아직 업데이트되지 않았다면)
	onMount(() => {
		if (!$discoveryState.activeFile) {
			const active = plugin.app.workspace.getActiveFile();
			if (active && active.extension === 'md') {
				updateDiscoveryState({ activeFile: active });
			}
		}
	});

	// Context 갱신 로직 (활성 노트가 변경될 때)
	async function updateContext() {
		if (!isActive || !$isRagEnabled || $indexingState.status !== 'ready') return;
		const file = $discoveryState.activeFile;
		
		if (!file) {
			updateDiscoveryState({ similarNotes: [], duplicateNote: null, recommendedTags: [], lastSearchedFilePath: null });
			return;
		}

		try {
			updateDiscoveryState({ isSearching: true });
			
			if (plugin.indexer) {
				const allChunks = plugin.indexer.indexedChunks;
				// 현재 파일 자신은 제외
				
				let results: SearchResult[] = [];

				const otherChunks = filterChunks(allChunks.filter(c => c.path !== file.path));

				if (otherChunks.length > 0) {
					// 현재 파일이 이미 인덱스에 있다면 그 임베딩을 그대로 활용
					const myFirstChunk = allChunks.find(c => c.path === file.path && c.chunkIndex === 0);
					
					if (myFirstChunk && myFirstChunk.embedding) {
						// 기존 임베딩이 있으면 API 호출 없이 바로 벡터 검색 수행
						results = await searchVault("", otherChunks, async () => [myFirstChunk.embedding!], 20, 0.55);
					} else {
						// 방금 복사/생성되어 아직 인덱스에 없는 경우
						const content = await plugin.app.vault.read(file);
						const cleanContent = plugin.indexer.preprocessMarkdown(content);
						const queryContext = cleanContent.substring(0, plugin.settings.rag.chunkSize || 512);

						if (queryContext.trim()) {
							results = await searchVault(queryContext, otherChunks, (texts) => plugin.indexer!.embed(texts), 20, 0.55);
						}
					}

					// 파일 경로 기준으로 중복 청크 제거 (동일 파일의 다른 청크가 중복 노출되는 것 방지)
					const uniqueResults: SearchResult[] = [];
					const seenPaths = new Set<string>();
					for (const r of results) {
						if (!seenPaths.has(r.chunk.path)) {
							seenPaths.add(r.chunk.path);
							uniqueResults.push(r);
						}
					}
					// 상위 8개 고유 문서만 노출
					results = uniqueResults.slice(0, 8);
				}
				
				// 매우 유사한 노트(0.90 이상) 찾기
				const duplicate = results.find(r => r.score >= 0.90) || null;
				
				// 태그 추출 (유사도가 높은 문서 기반)
				const tags = extractRecommendedTags(results);

				updateDiscoveryState({
					similarNotes: results,
					duplicateNote: duplicate,
					recommendedTags: tags,
					lastSearchedFilePath: file.path,
					isSearching: false
				});
			} else {
				updateDiscoveryState({ isSearching: false });
			}
		} catch (err) {
			console.error("[Lumina] Context 업데이트 실패:", err);
			updateDiscoveryState({ isSearching: false });
		}
	}

	// 사용자가 명시적으로 검색어를 입력했을 때
	async function performSearch() {
		if (!$isRagEnabled || $indexingState.status !== 'ready' || !searchQuery.trim()) {
			searchResults = [];
			return;
		}
		
		try {
			isSearching = true;
			updateDiscoveryState({ isSearching: true });
			if (plugin.indexer) {
				const chunks = filterChunks(plugin.indexer.indexedChunks);
				const results = await searchVault(searchQuery, chunks, (texts) => plugin.indexer!.embed(texts), 15, 0.60);
				searchResults = results;
			}
		} catch (err) {
			console.error("[Lumina] Semantic Search 실패:", err);
		} finally {
			isSearching = false;
			updateDiscoveryState({ isSearching: false });
		}
	}

	// activeFile 및 인덱싱 상태 감지 (디바운스 적용)
	$effect(() => {
		const file = $discoveryState.activeFile;
		const status = $indexingState.status;
		if (isActive && file && status === 'ready') {
			if (contextTimer) clearTimeout(contextTimer);
			contextTimer = setTimeout(() => {
				updateContext();
			}, 1000); // 1초 디바운스
		}
		return () => {
			if (contextTimer) clearTimeout(contextTimer);
		};
	});

	// searchQuery 및 filterQuery 감지 (디바운스 적용)
	$effect(() => {
		const q = searchQuery;
		const fq = filterQuery; // 의존성 추가
		const status = $indexingState.status;
		
		if (searchTimer) clearTimeout(searchTimer);
		if (contextTimer) clearTimeout(contextTimer);

		if (q.trim() && status === 'ready') {
			searchTimer = setTimeout(() => {
				performSearch();
			}, 500);
		} else if (!q.trim() && status === 'ready') {
			searchResults = [];
			// 검색어가 없으면 컨텍스트 모드로 돌아가므로 필터 갱신을 위해 updateContext 호출
			if (isActive && $discoveryState.activeFile) {
				contextTimer = setTimeout(() => {
					updateContext();
				}, 500);
			}
		}
		return () => {
			if (searchTimer) clearTimeout(searchTimer);
			if (contextTimer) clearTimeout(contextTimer);
		};
	});

	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
		return {
			update(newIconId: string) {
				node.empty();
				setIcon(node, newIconId);
			}
		};
	}

	async function insertLink(path: string) {
		let editor = plugin.app.workspace.activeEditor?.editor;
		
		// 사이드바 포커스로 인해 activeEditor가 null일 수 있으므로,
		// 열려있는 마크다운 뷰 중 아무거나 가져와 에디터를 찾습니다.
		if (!editor) {
			const mdView = plugin.app.workspace.getLeavesOfType("markdown")
				.map(leaf => leaf.view as MarkdownView)
				.find(view => view.editor);
			if (mdView) editor = mdView.editor;
		}

		if (editor) {
			const cursor = editor.getCursor();
			// 링크 삽입 (파일명만)
			const fileName = path.replace(/\.md$/, '').split('/').pop();
			editor.replaceRange(`[[${fileName}]]`, cursor);
		} else {
			new Notice($tStore('discovery.noActiveEditor'));
		}
	}

	async function insertTag(tag: string) {
		const file = $discoveryState.activeFile;
		if (!file) return;
		
		await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (!frontmatter.tags) {
				frontmatter.tags = [];
			}
			const tagValue = tag.replace('#', '');
			if (Array.isArray(frontmatter.tags)) {
				if (!frontmatter.tags.includes(tagValue)) frontmatter.tags.push(tagValue);
			} else {
				// tags is a string
				frontmatter.tags = [frontmatter.tags, tagValue];
			}
		});
	}

	async function openFile(path: string, e?: MouseEvent, chunkText?: string) {
		const newLeaf = e ? (Keymap.isModEvent(e) || e.button === 1) : false;
		const file = plugin.app.vault.getAbstractFileByPath(path);
		if (file) {
			// 사이드바 리프(현재 리프)에서 openFile을 호출하면 무시될 수 있으므로,
			// 가장 최근에 사용된 마크다운 리프를 찾거나 없으면 새 탭을 생성합니다.
			let targetLeaf = null;
			
			if (newLeaf) {
				targetLeaf = plugin.app.workspace.getLeaf('tab');
			} else {
				const recentLeaf = plugin.app.workspace.getMostRecentLeaf();
				if (recentLeaf && recentLeaf.getViewState().type === 'markdown') {
					targetLeaf = recentLeaf;
				} else {
					const mdLeaves = plugin.app.workspace.getLeavesOfType('markdown');
					if (mdLeaves.length > 0) {
						targetLeaf = mdLeaves[0];
					} else {
						targetLeaf = plugin.app.workspace.getLeaf('tab');
					}
				}
			}

			let line = 0;
			if (chunkText && file instanceof TFile && file.extension === 'md') {
				try {
					const content = await plugin.app.vault.read(file);
					const searchStr = chunkText.substring(0, 30);
					const index = content.indexOf(searchStr);
					if (index !== -1) {
						line = content.substring(0, index).split('\n').length - 1;
					}
				} catch (err) {
					console.error("[Lumina] 스크롤 위치 탐색 실패", err);
				}
			}
			
			// @ts-ignore
			await targetLeaf.openFile(file, { eState: { line } });
		} else {
			plugin.app.workspace.openLinkText(path, '', newLeaf as boolean);
		}
	}

	async function openInSplit(path: string) {
		plugin.app.workspace.openLinkText(path, '', 'split');
	}

	async function startChatWithStaged() {
		for (const item of $discoveryState.stagedItems) {
			const fileName = item.chunk.path.replace(/\.md$/, '').split('/').pop() || item.chunk.path;
			addPendingAttachment({
				type: 'file',
				path: item.chunk.path,
				name: fileName
			});
		}
		clearStaging();
		$activeSidebarTab = 'chat';
		await plugin.activateChatView();
	}

	let stagedTokenCount = $derived($discoveryState.stagedItems.reduce((acc, item) => acc + Math.floor(item.chunk.text.length / 4), 0));
	let maxTokens = $derived(plugin.settings.chat.maxContextTokens || 128000);

	function filterChunks(chunks: any[]) {
		const q = filterQuery.trim();
		if (!q) return chunks;
		return chunks.filter(c => {
			if (q.startsWith('#')) {
				const cache = plugin.app.metadataCache.getCache(c.path);
				const tags = cache?.tags?.map((t: any) => t.tag) || [];
				const fmTags = cache?.frontmatter?.tags;
				const cleanQ = q.replace('#', '');
				return tags.includes(q) || (Array.isArray(fmTags) && fmTags.includes(cleanQ));
			} else {
				return c.path.toLowerCase().includes(q.toLowerCase());
			}
		});
	}
</script>

<div class="lumina-discovery">
	{#if !$isRagEnabled}
		<div class="lumina-discovery__empty">
			<div class="lumina-discovery__empty-icon">🔍</div>
			<p>{$tStore('discovery.emptyStateText')}</p>
			<p class="lumina-discovery__empty-sub">{$tStore('discovery.emptyStateSub')}</p>
			<button class="lumina-discovery__setup-btn" onclick={() => {
				// @ts-ignore
				plugin.app.setting.open();
				// @ts-ignore
				plugin.app.setting.openTabById('lumina');
			}}>
				⚙️ {$tStore('common.settings')}
			</button>
		</div>
	{:else}
		<!-- Search Bar -->
		<div class="lumina-discovery__search-bar">
			<span class="lumina-discovery__search-icon" use:icon={"search"}></span>
			<input 
				type="text" 
				class="lumina-discovery__search-input" 
				placeholder={$tStore('discovery.searchPlaceholder')}
				bind:value={searchQuery}
			/>
			{#if searchQuery}
				<button class="lumina-discovery__clear-btn" aria-label="Clear Search" onclick={() => searchQuery = ''}>
					<span use:icon={"x"}></span>
				</button>
			{/if}
		</div>
		<div class="lumina-discovery__search-bar" style="margin-top: 4px;">
			<span class="lumina-discovery__search-icon" use:icon={"filter"}></span>
			<input 
				type="text" 
				class="lumina-discovery__search-input" 
				placeholder={$tStore('discovery.filterPlaceholder')}
				bind:value={filterQuery}
			/>
			{#if filterQuery}
				<button class="lumina-discovery__clear-btn" aria-label="Clear Filter" onclick={() => filterQuery = ''}>
					<span use:icon={"x"}></span>
				</button>
			{/if}
		</div>

		<!-- RAG Progress Banner Fixed -->
		{#if $showIndexingIndicator}
			<div class="lumina-discovery__rag-banner">
				<div class="lumina-discovery__rag-banner-content">
					{#if $indexingState.status === "loading-model"}
						<strong>{$tStore("settings.rag.init.loadingModel") || "RAG 모델 다운로드 중..."}</strong>
						<span>{$tStore("settings.rag.init.loadingModelDesc") || ""}</span>
					{:else}
						<strong>{$tStore("settings.rag.init.indexingVault") || "내 노트 인덱싱 중..."}</strong>
						<span>
							{($tStore("settings.rag.init.indexingProgressText") || "")
								.replace("{{processed}}", $indexingState.processedFiles.toString())
								.replace("{{total}}", $indexingState.totalFiles.toString())
								.replace("{{pct}}", $indexingProgress.toString())}
							{#if $estimatedTimeRemaining !== null}
								{$tStore("settings.rag.init.remainingTimePrefix") || ""}{$estimatedTimeRemaining < 60
									? ($tStore("settings.rag.init.remainingTimeSec") || "").replace("{{sec}}", $estimatedTimeRemaining.toString())
									: ($tStore("settings.rag.init.remainingTimeMinSec") || "")
											.replace("{{min}}", Math.floor($estimatedTimeRemaining / 60).toString())
											.replace("{{sec}}", ($estimatedTimeRemaining % 60).toString())}
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
							{#each searchResults as result}
								{@const isStaged = $discoveryState.stagedItems.some(i => i.chunk.id === result.chunk.id)}
								<div class="lumina-discovery__card">
									<div class="lumina-discovery__card-header" onclick={(e) => openFile(result.chunk.path, e, result.chunk.text)} onauxclick={(e) => openFile(result.chunk.path, e, result.chunk.text)} role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') openFile(result.chunk.path, undefined, result.chunk.text); }}>
										<span class="lumina-discovery__card-title">{result.chunk.path.replace(/\.md$/, '').split('/').pop()}</span>
										<span class="lumina-discovery__card-score">{Math.round(result.score * 100)}%</span>
									</div>
									<div class="lumina-discovery__card-snippet" onclick={(e) => openFile(result.chunk.path, e, result.chunk.text)} onauxclick={(e) => openFile(result.chunk.path, e, result.chunk.text)} role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') openFile(result.chunk.path, undefined, result.chunk.text); }}>{result.chunk.text.substring(0, 150)}...</div>
									<div class="lumina-discovery__card-actions">
										<button class="lumina-discovery__action-btn" onclick={() => insertLink(result.chunk.path)}>
											<span use:icon={"link"}></span> {$tStore('discovery.insertLink')}
										</button>
										<button class="lumina-discovery__action-btn" onclick={() => openInSplit(result.chunk.path)}>
											<span use:icon={"columns"}></span> {$tStore('discovery.openInSplit')}
										</button>
										{#if isStaged}
											<button class="lumina-discovery__action-btn is-staged" onclick={() => removeFromStaging(result.chunk.id)}>
												<span use:icon={"minus-circle"}></span> {$tStore('common.remove')}
											</button>
										{:else}
											<button class="lumina-discovery__action-btn" onclick={() => addToStaging(result)}>
												<span use:icon={"plus-circle"}></span> {$tStore('common.add')}
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{:else}
					<!-- Context 모드 -->
					{#if $discoveryState.isSearching && $discoveryState.similarNotes.length === 0 && !$discoveryState.duplicateNote && $discoveryState.recommendedTags.length === 0}
						<div class="lumina-discovery__loading"><div class="spinner"></div></div>
					{:else}
						<div class="lumina-discovery__context-view" class:is-updating={$discoveryState.isSearching}>
							
							<!-- 중복/매우 유사한 노트 경고 -->
							{#if $discoveryState.duplicateNote}
								<div class="lumina-discovery__warning-box">
									<div class="lumina-discovery__warning-title">
										<span use:icon={"alert-triangle"} style="display: flex; align-items: center;"></span>
										<span>{$tStore('discovery.duplicateWarning')}</span>
									</div>
									<div class="lumina-discovery__warning-link" onclick={(e) => openFile($discoveryState.duplicateNote!.chunk.path, e)} onauxclick={(e) => openFile($discoveryState.duplicateNote!.chunk.path, e)} role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') openFile($discoveryState.duplicateNote!.chunk.path); }}>
										[[{$discoveryState.duplicateNote.chunk.path.replace(/\.md$/, '').split('/').pop()}]]
									</div>
								</div>
							{/if}

							<!-- 추천 태그 -->
							{#if $discoveryState.recommendedTags.length > 0}
								<div class="lumina-discovery__section">
									<div class="lumina-discovery__section-title">
										<span use:icon={"tags"}></span> {$tStore('discovery.recommendedTags')}
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
										<span use:icon={"network"}></span> {$tStore('discovery.relatedNotes')}
									</div>
									<div class="lumina-discovery__results-list">
										{#each $discoveryState.similarNotes as result}
											{@const isStaged = $discoveryState.stagedItems.some(i => i.chunk.id === result.chunk.id)}
											<div class="lumina-discovery__card">
												<div class="lumina-discovery__card-header" onclick={(e) => openFile(result.chunk.path, e, result.chunk.text)} onauxclick={(e) => openFile(result.chunk.path, e, result.chunk.text)} role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') openFile(result.chunk.path, undefined, result.chunk.text); }}>
													<span class="lumina-discovery__card-title">{result.chunk.path.replace(/\.md$/, '').split('/').pop()}</span>
													<span class="lumina-discovery__card-score">{Math.round(result.score * 100)}%</span>
												</div>
												<div class="lumina-discovery__card-snippet" onclick={(e) => openFile(result.chunk.path, e, result.chunk.text)} onauxclick={(e) => openFile(result.chunk.path, e, result.chunk.text)} role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') openFile(result.chunk.path, undefined, result.chunk.text); }}>{result.chunk.text.substring(0, 100)}...</div>
												<div class="lumina-discovery__card-actions">
													<button class="lumina-discovery__action-btn" onclick={() => insertLink(result.chunk.path)}>
														<span use:icon={"link"}></span> {$tStore('discovery.insertLink')}
													</button>
													<button class="lumina-discovery__action-btn" onclick={() => openInSplit(result.chunk.path)}>
														<span use:icon={"columns"}></span> {$tStore('discovery.openInSplit')}
													</button>
													{#if isStaged}
														<button class="lumina-discovery__action-btn is-staged" onclick={() => removeFromStaging(result.chunk.id)}>
															<span use:icon={"minus-circle"}></span> {$tStore('common.remove')}
														</button>
													{:else}
														<button class="lumina-discovery__action-btn" onclick={() => addToStaging(result)}>
															<span use:icon={"plus-circle"}></span> {$tStore('common.add')}
														</button>
													{/if}
												</div>
											</div>
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
			<div class="lumina-discovery__staging-area">
				<div class="lumina-discovery__staging-header">
					<div class="lumina-discovery__staging-title">
						<span use:icon={"layers"}></span> {$tStore('discovery.stagedContext')} ({$discoveryState.stagedItems.length})
					</div>
					<button class="lumina-discovery__clear-staging-btn" onclick={clearStaging} aria-label="Clear All">
						<span use:icon={"trash-2"}></span>
					</button>
				</div>
				<div class="lumina-discovery__staging-chips">
					{#each $discoveryState.stagedItems as item}
						<div class="lumina-discovery__staging-chip">
							<span class="lumina-discovery__staging-chip-text">{item.chunk.path.replace(/\.md$/, '').split('/').pop()}</span>
							<button class="lumina-discovery__staging-chip-remove" aria-label="Remove" onclick={() => removeFromStaging(item.chunk.id)}>
								<span use:icon={"x"}></span>
							</button>
						</div>
					{/each}
				</div>
				<div class="lumina-discovery__staging-footer">
					<div class="lumina-discovery__staging-progress-wrapper">
						<div class="lumina-discovery__staging-progress-bar" style="width: {Math.min(100, (stagedTokenCount / maxTokens) * 100)}%" class:is-danger={stagedTokenCount > maxTokens}></div>
						<div class="lumina-discovery__staging-progress-text" class:is-danger={stagedTokenCount > maxTokens}>
							{$tStore('discovery.approxTokens', { current: stagedTokenCount.toLocaleString(), max: maxTokens.toLocaleString() })}
						</div>
					</div>
					<button class="lumina-discovery__start-chat-btn" onclick={startChatWithStaged} disabled={stagedTokenCount > maxTokens}>
						<span use:icon={"message-square"}></span> {$tStore('discovery.startChat', { count: $discoveryState.stagedItems.length })}
					</button>
				</div>
			</div>
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
