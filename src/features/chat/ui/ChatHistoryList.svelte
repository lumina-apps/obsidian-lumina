<script lang="ts">
	import { onMount } from "svelte";
	import type { ChatSession } from "../../../shared/types/chat.types";
	import type { ChatController } from "../chatController";
	import { currentSessionId } from "../../../core/store/chatStore";
	import { tStore } from "../../../shared/locales/index";

	let { ctrl, onSessionSelect, onBack }: { ctrl: ChatController, onSessionSelect: () => void, onBack: () => void } = $props();

	let sessions: ChatSession[] = $state([]);
	let loading: boolean = $state(true);

	async function loadSessions() {
		loading = true;
		try {
			sessions = await ctrl.fetchSessions();
		} catch (e) {
			console.error("Failed to fetch sessions", e);
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
		e.stopPropagation(); // 클릭 이벤트가 부모(handleSelect)로 전파되는 것 방지
		if (confirm($tStore('settings.chat.history.deleteConfirm') || "Are you sure you want to delete this chat history?")) {
			const success = await ctrl.removeSession(sessionId);
			if (success) {
				await loadSessions();
			}
		}
	}

	onMount(() => {
		loadSessions();
	});

	function formatDate(timestamp: number): string {
		const d = new Date(timestamp);
		return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
	}
</script>

<div class="lumina-history">
	<div class="lumina-history__header">
		<div class="lumina-history__header-title">
			<button class="lumina-history__back-btn" onclick={onBack} aria-label={$tStore('common.back')} type="button">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="19" y1="12" x2="5" y2="12"></line>
					<polyline points="12 19 5 12 12 5"></polyline>
				</svg>
			</button>
			<h3>{$tStore('settings.chat.history.title')}</h3>
		</div>
		<button class="lumina-history__refresh" onclick={loadSessions} aria-label={$tStore('common.refresh')}>
			<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="23 4 23 10 17 10"></polyline>
				<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
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
					<button class="lumina-history__delete" onclick={(e) => handleDelete(e, session.id)} aria-label={$tStore('common.delete')}>
						<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="3 6 5 6 21 6"></polyline>
							<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
						</svg>
					</button>
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

	.lumina-history__back-btn {
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

	.lumina-history__back-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-history__header h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.lumina-history__refresh {
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

	.lumina-history__refresh:hover {
		background: var(--background-modifier-hover);
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

	.lumina-history__delete {
		background: transparent;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		padding: 6px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: all 0.2s ease;
	}

	.lumina-history__item:hover .lumina-history__delete {
		opacity: 1;
	}

	.lumina-history__delete:hover {
		background: var(--background-modifier-error-hover);
		color: var(--text-error);
	}
</style>
