<script lang="ts">
	import { onMount } from "svelte";
	import type { ChatSession } from "../../../shared/types/chat.types";
	import type { ChatController } from "../chatController";
	import { currentSessionId } from "../../../core/store/chatStore";
	import { activeProjectId } from "../../../core/store/projectStore";
	import { tStore } from "../../../shared/locales/index";
	import { formatDate } from "../../../shared/utils/dateUtils";
	import { SVG_BACK_ARROW, SVG_REFRESH, SVG_TRASH, SVG_EXPORT } from "../../../shared/svgIcons";
	import { debugLogger } from "../../../shared/debugLogger";

	let { ctrl, onSessionSelect, onBack }: { ctrl: ChatController; onSessionSelect: () => void; onBack: () => void } = $props();

	let sessions: ChatSession[] = $state([]);
	let loading: boolean = $state(true);

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
		const success = await ctrl.restoreSession(sessionId);
		if (success) {
			onSessionSelect();
		}
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
		// activeProjectId가 변경될 때마다(또는 초기 마운트 시) 세션 목록 새로고침
		$activeProjectId;
		loadSessions();
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

	<div class="lumina-history__list">
		{#if loading}
			<div class="lumina-history__empty">{$tStore('common.loading')}</div>
		{:else if sessions.length === 0}
			<div class="lumina-history__empty">{$tStore('settings.chat.history.empty')}</div>
		{:else}
			{#each sessions as session (session.id)}
				<div
					class="lumina-history__item"
					class:is-active={$currentSessionId === session.id}
					role="button"
					tabindex="0"
					onclick={() => handleSelect(session.id)}
					onkeydown={(e) => e.key === 'Enter' && handleSelect(session.id)}
				>
					<div class="lumina-history__item-main">
						<div class="lumina-history__item-title">{session.title}</div>
						<div class="lumina-history__item-meta">
							<span>{formatDate(session.updatedAt)}</span>
							<span class="lumina-history__item-dot">•</span>
							<span>{session.modelId || $tStore('settings.chat.history.unknownModel')}</span>
						</div>
					</div>
					<div class="lumina-history__actions">
						<button class="lumina-history__action-btn" onclick={(e) => handleExport(e, session.id)} aria-label={$tStore('settings.chat.history.exportToolTip') || 'Export'}>
							<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								{@html SVG_EXPORT}
							</svg>
						</button>
						<button class="lumina-history__action-btn lumina-history__action-btn--delete" onclick={(e) => handleDelete(e, session.id)} aria-label={$tStore('common.delete')}>
							<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								{@html SVG_TRASH}
							</svg>
						</button>
					</div>
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
</style>