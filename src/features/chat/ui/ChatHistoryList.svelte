<script lang="ts">
	import { onMount } from "svelte";
	import type { ChatSession } from "../../../shared/types/chat.types";
	import type { ChatController } from "../chatController";
	import { currentSessionId } from "../../../core/store/chatStore";
	import { activeProjectId } from "../../../core/store/projectStore";
	import { tStore } from "../../../shared/locales/index";
	import { formatDate } from "../../../shared/utils/dateUtils";
	import {
		SVG_BACK_ARROW,
		SVG_REFRESH,
		SVG_TRASH,
		SVG_EXPORT,
		SVG_EDIT,
		SVG_CHECK,
		SVG_CLOSE,
		SVG_SEARCH,
	} from "../../../shared/svgIcons";
	import { debugLogger } from "../../../shared/debugLogger";

	let {
		ctrl,
		onBeforeSelect,
		onSessionSelect,
		onBack,
	}: {
		ctrl: ChatController;
		onBeforeSelect?: () => Promise<void>;
		onSessionSelect: () => void;
		onBack: () => void;
	} = $props();

	let sessions: ChatSession[] = $state([]);
	let loading: boolean = $state(true);
	let searchQuery: string = $state("");
	let editingSessionId: string | null = $state(null);
	let editTitleInput: string = $state("");
	/** 마지막으로 목록을 불러온 프로젝트 ID (무한 effect 루프 방지 가드) */
	let lastLoadedProjectId: string | null = null;

	const filteredSessions = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return sessions;
		return sessions.filter((s) =>
			(s.title && s.title.toLowerCase().includes(q)) ||
			(s.modelId && s.modelId.toLowerCase().includes(q))
		);
	});

	async function loadSessions() {
		loading = true;
		try {
			sessions = await ctrl.fetchSessions();
		} catch (e) {
			debugLogger.logError('history', e instanceof Error ? e : new Error(String(e)));
		} finally {
			loading = false;
		}
	}

	async function handleSelect(sessionId: string) {
		if (editingSessionId) return;
		if (onBeforeSelect) {
			try {
				await onBeforeSelect();
			} catch (e) {
				debugLogger.logError('history', e instanceof Error ? e : new Error(String(e)));
			}
		}
		const success = await ctrl.restoreSession(sessionId);
		if (success) {
			onSessionSelect();
		}
	}

	function focusInput(node: HTMLInputElement) {
		requestAnimationFrame(() => {
			node.focus();
			node.select();
		});
	}

	function startRename(e: Event, session: ChatSession) {
		e.stopPropagation();
		editingSessionId = session.id;
		editTitleInput = session.title;
	}

	async function saveRename(sessionId: string) {
		const newTitle = editTitleInput.trim();
		if (!newTitle) {
			cancelRename();
			return;
		}
		const success = await ctrl.renameSession(sessionId, newTitle);
		if (success) {
			sessions = sessions.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s));
		}
		editingSessionId = null;
		editTitleInput = "";
	}

	function cancelRename() {
		editingSessionId = null;
		editTitleInput = "";
	}

	async function handleDelete(e: Event, sessionId: string) {
		e.stopPropagation();
		if (confirm($tStore('settings.chat.history.deleteConfirm') || "Are you sure you want to delete this chat history?")) {
			const success = await ctrl.removeSession(sessionId);
			if (success) {
				await loadSessions();
			}
		}
	}

	async function handleExport(e: Event, sessionId: string) {
		e.stopPropagation();
		await ctrl.history.exportSession(sessionId);
	}

	$effect(() => {
		// activeProjectId가 실제로 변경될 때만 목록을 새로고침.
		const pid = $activeProjectId;
		if (pid === lastLoadedProjectId) return;
		lastLoadedProjectId = pid;
		void loadSessions();
	});
</script>

<div class="lumina-history">
	<div class="lumina-history__header">
		<div class="lumina-history__header-title">
			<button class="lumina-history__icon-btn" onclick={onBack} aria-label={$tStore('common.back')} type="button">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					{@html SVG_BACK_ARROW}
				</svg>
			</button>
			<h3>{$tStore('settings.chat.history.title')}</h3>
		</div>
		<button class="lumina-history__icon-btn" onclick={loadSessions} aria-label={$tStore('common.refresh')}>
			<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				{@html SVG_REFRESH}
			</svg>
		</button>
	</div>

	<div class="lumina-history__search-wrap">
		<div class="lumina-history__search-box">
			<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lumina-history__search-icon">
				{@html SVG_SEARCH}
			</svg>
			<input
				type="text"
				class="lumina-history__search-input"
				placeholder={$tStore('settings.chat.history.searchPlaceholder') || 'Search by title or model...'}
				bind:value={searchQuery}
			/>
			{#if searchQuery}
				<button class="lumina-history__search-clear" onclick={() => (searchQuery = "")} aria-label="Clear">
					<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						{@html SVG_CLOSE}
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<div class="lumina-history__list">
		{#if loading}
			<div class="lumina-history__empty">{$tStore('common.loading')}</div>
		{:else if filteredSessions.length === 0}
			<div class="lumina-history__empty">
				{searchQuery ? $tStore('common.noResults') : $tStore('settings.chat.history.empty')}
			</div>
		{:else}
			{#each filteredSessions as session (session.id)}
				<div
					class="lumina-history__item"
					class:is-active={$currentSessionId === session.id}
					role="button"
					tabindex="0"
					onclick={() => {
						if (editingSessionId !== session.id) {
							void handleSelect(session.id);
						}
					}}
					onkeydown={(e) => {
						if (editingSessionId !== session.id && e.key === 'Enter') {
							void handleSelect(session.id);
						}
					}}
				>
					{#if editingSessionId === session.id}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="lumina-history__rename-box"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
							role="presentation"
						>
							<input
								use:focusInput
								type="text"
								class="lumina-history__rename-input"
								bind:value={editTitleInput}
								onkeydown={(e) => {
									e.stopPropagation();
									if (e.key === 'Enter') {
										e.preventDefault();
										void saveRename(session.id);
									} else if (e.key === 'Escape') {
										e.preventDefault();
										cancelRename();
									}
								}}
							/>
							<button
								class="lumina-history__action-btn"
								onclick={(e) => {
									e.stopPropagation();
									void saveRename(session.id);
								}}
								aria-label={$tStore('common.save')}
								type="button"
							>
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									{@html SVG_CHECK}
								</svg>
							</button>
							<button
								class="lumina-history__action-btn"
								onclick={(e) => {
									e.stopPropagation();
									cancelRename();
								}}
								aria-label={$tStore('common.cancel')}
								type="button"
							>
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									{@html SVG_CLOSE}
								</svg>
							</button>
						</div>
					{:else}
						<div class="lumina-history__item-main">
							<div class="lumina-history__item-title" title={session.title}>{session.title}</div>
							<div class="lumina-history__item-meta">
								<span>{formatDate(session.updatedAt)}</span>
								<span class="lumina-history__item-dot">•</span>
								<span>{session.modelId || $tStore('settings.chat.history.unknownModel')}</span>
							</div>
						</div>
						<div class="lumina-history__actions">
							<button class="lumina-history__action-btn" onclick={(e) => startRename(e, session)} aria-label={$tStore('settings.chat.history.rename') || 'Rename'}>
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									{@html SVG_EDIT}
								</svg>
							</button>
							<button class="lumina-history__action-btn" onclick={(e) => handleExport(e, session.id)} aria-label={$tStore('settings.chat.history.exportToolTip') || 'Export'}>
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									{@html SVG_EXPORT}
								</svg>
							</button>
							<button class="lumina-history__action-btn lumina-history__action-btn--delete" onclick={(e) => handleDelete(e, session.id)} aria-label={$tStore('common.delete')}>
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									{@html SVG_TRASH}
								</svg>
							</button>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.lumina-history {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--background-primary);
	}

	.lumina-history__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	.lumina-history__header-title {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* 공통 아이콘 버튼 (back, refresh) */
	.lumina-history__icon-btn {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.2s ease, color 0.2s ease;
	}

	.lumina-history__icon-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-history__header h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.lumina-history__list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-history__empty {
		text-align: center;
		padding: 32px 16px;
		color: var(--text-muted);
		font-size: 12px;
	}

	.lumina-history__item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-radius: 8px;
		background: transparent;
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-history__item:hover {
		background: var(--background-secondary);
	}

	.lumina-history__item.is-active {
		background: rgba(139, 92, 246, 0.08);
		border-color: rgba(139, 92, 246, 0.3);
	}

	.lumina-history__item-main {
		display: flex;
		flex-direction: column;
		gap: 4px;
		overflow: hidden;
	}

	.lumina-history__item-title {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lumina-history__item-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-history__item-dot {
		opacity: 0.5;
	}

	.lumina-history__actions {
		display: flex;
		align-items: center;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.lumina-history__item:hover .lumina-history__actions {
		opacity: 1;
	}

	.lumina-history__action-btn {
		background: transparent;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		padding: 6px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	}

	.lumina-history__action-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-history__action-btn--delete:hover {
		background: var(--background-modifier-error-hover);
		color: var(--text-error);
	}

	.lumina-history__search-wrap {
		padding: 8px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		flex-shrink: 0;
	}

	.lumina-history__search-box {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--background-modifier-form-field);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 4px 8px;
		transition: border-color 0.2s ease;
	}

	.lumina-history__search-box:focus-within {
		border-color: var(--interactive-accent);
	}

	.lumina-history__search-icon {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.lumina-history__search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-normal);
		font-size: 12px;
		padding: 0;
	}

	.lumina-history__search-clear {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
	}

	.lumina-history__search-clear:hover {
		color: var(--text-normal);
	}

	.lumina-history__rename-box {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
	}

	.lumina-history__rename-input {
		flex: 1;
		background: var(--background-modifier-form-field);
		border: 1px solid var(--interactive-accent);
		border-radius: 4px;
		color: var(--text-normal);
		font-size: 12px;
		padding: 4px 6px;
		outline: none;
	}
</style>