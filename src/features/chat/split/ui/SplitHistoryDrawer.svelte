<script lang="ts">
	import { activeProjectId } from "../../../../core/store/projectStore";
	import { debugLogger } from "../../../../shared/debugLogger";
	import type { tStore } from "../../../../shared/locales/index";
	import {
		SVG_CHECK,
		SVG_CLOSE,
		SVG_EDIT,
		SVG_EXPORT,
		SVG_REFRESH,
		SVG_SEARCH,
		SVG_TRASH,
	} from "../../../../shared/svgIcons";
	import type { SplitSessionSummary } from "../../../../shared/types/splitChat.types";
	import { formatDate } from "../../../../shared/utils/dateUtils";
	import { normalizeError } from "../../../../shared/utils/errorUtils";
	import type { SplitChatController } from "../splitChatController";

	let {
		ctrl,
		currentSessionId,
		refreshTick = 0,
		tStore: tS,
		onSelectSession,
		onNewComparison,
		onClose,
	}: {
		ctrl: SplitChatController;
		currentSessionId: string | null;
		refreshTick?: number;
		tStore: typeof tStore;
		onSelectSession: (sessionId: string) => Promise<void>;
		onNewComparison: () => void;
		onClose: () => void;
	} = $props();

	let sessions = $state<SplitSessionSummary[]>([]);
	let loading = $state(true);
	let searchQuery = $state("");
	let editingSessionId = $state<string | null>(null);
	let editTitleInput = $state("");

	const filteredSessions = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return sessions;
		return sessions.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				s.modelLabels.some((m) => m.toLowerCase().includes(q)),
		);
	});

	async function loadSessions(): Promise<void> {
		loading = true;
		try {
			sessions = await ctrl.fetchHistorySessions();
		} catch (e: unknown) {
			debugLogger.logError("split-history", normalizeError(e));
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void $activeProjectId;
		void refreshTick;
		void loadSessions();
	});

	function focusInput(node: HTMLInputElement): void {
		requestAnimationFrame(() => {
			node.focus();
			node.select();
		});
	}

	function startRename(e: Event, session: SplitSessionSummary): void {
		e.stopPropagation();
		editingSessionId = session.id;
		editTitleInput = session.title;
	}

	async function saveRename(sessionId: string): Promise<void> {
		const nextTitle = editTitleInput.trim();
		if (!nextTitle) {
			cancelRename();
			return;
		}
		const ok = await ctrl.renameHistorySession(sessionId, nextTitle);
		if (ok) {
			sessions = sessions.map((s) =>
				s.id === sessionId ? { ...s, title: nextTitle } : s,
			);
		}
		editingSessionId = null;
		editTitleInput = "";
	}

	function cancelRename(): void {
		editingSessionId = null;
		editTitleInput = "";
	}

	async function handleDelete(e: Event, sessionId: string): Promise<void> {
		e.stopPropagation();
		if (window.confirm($tS("splitChat.historyDeleteConfirm"))) {
			const ok = await ctrl.deleteHistorySession(sessionId);
			if (ok) {
				await loadSessions();
			}
		}
	}

	async function handleExport(e: Event, sessionId: string): Promise<void> {
		e.stopPropagation();
		await ctrl.exportHistorySession(sessionId);
	}
</script>

<aside class="lumina-split-drawer">
	<div class="lumina-split-drawer__header">
		<h3>{$tS("splitChat.historyTitle")}</h3>
		<div class="lumina-split-drawer__header-actions">
			<button
				type="button"
				class="lumina-split-drawer__icon-btn"
				onclick={() => void loadSessions()}
				aria-label={$tS("common.refresh")}
				title={$tS("common.refresh")}
			>
				<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					{@html SVG_REFRESH}
				</svg>
			</button>
			<button
				type="button"
				class="lumina-split-drawer__icon-btn"
				onclick={onClose}
				aria-label={$tS("common.cancel")}
			>
				<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					{@html SVG_CLOSE}
				</svg>
			</button>
		</div>
	</div>

	<div class="lumina-split-drawer__controls">
		<button
			type="button"
			class="lumina-split-drawer__new-btn"
			onclick={onNewComparison}
		>
			+ {$tS("splitChat.newComparison")}
		</button>

		<div class="lumina-split-drawer__search-box">
			<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lumina-split-drawer__search-icon">
				{@html SVG_SEARCH}
			</svg>
			<input
				type="text"
				class="lumina-split-drawer__search-input"
				placeholder={$tS("splitChat.historySearchPlaceholder")}
				bind:value={searchQuery}
			/>
			{#if searchQuery}
				<button
					type="button"
					class="lumina-split-drawer__search-clear"
					onclick={() => (searchQuery = "")}
					aria-label="Clear"
				>
					<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						{@html SVG_CLOSE}
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<div class="lumina-split-drawer__list lumina-scrollbar-thin">
		{#if loading}
			<div class="lumina-split-drawer__empty">{$tS("common.loading")}</div>
		{:else if filteredSessions.length === 0}
			<div class="lumina-split-drawer__empty">
				{searchQuery ? $tS("common.noResults") : $tS("splitChat.historyEmpty")}
			</div>
		{:else}
			{#each filteredSessions as session (session.id)}
				<div
					class="lumina-split-drawer__item"
					class:is-active={currentSessionId === session.id}
					role="button"
					tabindex="0"
					onclick={() => {
						if (editingSessionId !== session.id) {
							void onSelectSession(session.id);
						}
					}}
					onkeydown={(e) => {
						if (editingSessionId !== session.id && e.key === "Enter") {
							void onSelectSession(session.id);
						}
					}}
				>
					{#if editingSessionId === session.id}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="lumina-split-drawer__rename-box"
							role="presentation"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
						>
							<input
								use:focusInput
								type="text"
								class="lumina-split-drawer__rename-input"
								bind:value={editTitleInput}
								onkeydown={(e) => {
									e.stopPropagation();
									if (e.key === "Enter") {
										e.preventDefault();
										void saveRename(session.id);
									} else if (e.key === "Escape") {
										e.preventDefault();
										cancelRename();
									}
								}}
							/>
							<button
								type="button"
								class="lumina-split-drawer__action-btn"
								onclick={(e) => {
									e.stopPropagation();
									void saveRename(session.id);
								}}
								aria-label={$tS("common.save")}
							>
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									{@html SVG_CHECK}
								</svg>
							</button>
							<button
								type="button"
								class="lumina-split-drawer__action-btn"
								onclick={(e) => {
									e.stopPropagation();
									cancelRename();
								}}
								aria-label={$tS("common.cancel")}
							>
								<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									{@html SVG_CLOSE}
								</svg>
							</button>
						</div>
					{:else}
						<div class="lumina-split-drawer__item-top">
							<div class="lumina-split-drawer__item-main">
								<div class="lumina-split-drawer__item-title" title={session.title}>
									{session.title}
								</div>
								<div class="lumina-split-drawer__item-meta">
									<span>{formatDate(session.updatedAt)}</span>
									<span>·</span>
									<span>{$tS("splitChat.historyTurnsCount", { count: session.turnCount })}</span>
									{#if session.mode === "blind"}
										<span title={$tS("splitChat.modeBlind")}>🎭</span>
									{/if}
									{#if session.hasWinner}
										<span title={$tS("splitChat.winnerBadge")}>🏆</span>
									{/if}
								</div>
							</div>

							<div class="lumina-split-drawer__actions">
								<button
									type="button"
									class="lumina-split-drawer__action-btn"
									onclick={(e) => startRename(e, session)}
									aria-label={$tS("settings.chat.history.rename")}
								>
									<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										{@html SVG_EDIT}
									</svg>
								</button>
								<button
									type="button"
									class="lumina-split-drawer__action-btn"
									onclick={(e) => handleExport(e, session.id)}
									aria-label={$tS("splitChat.exportComparison")}
								>
									<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										{@html SVG_EXPORT}
									</svg>
								</button>
								<button
									type="button"
									class="lumina-split-drawer__action-btn lumina-split-drawer__action-btn--delete"
									onclick={(e) => handleDelete(e, session.id)}
									aria-label={$tS("common.delete")}
								>
									<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										{@html SVG_TRASH}
									</svg>
								</button>
							</div>
						</div>

						{#if session.modelLabels.length > 0}
							<div class="lumina-split-drawer__models">
								{#each session.modelLabels.slice(0, 4) as modelLabel}
									<span class="lumina-split-drawer__model-pill" title={modelLabel}>
										{modelLabel}
									</span>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</aside>

<style>
	.lumina-split-drawer {
		width: 264px;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--background-secondary);
		border-right: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
	}

	.lumina-split-drawer__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-split-drawer__header h3 {
		margin: 0;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-normal);
	}

	.lumina-split-drawer__header-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.lumina-split-drawer__icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}

	.lumina-split-drawer__icon-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-split-drawer__controls {
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-split-drawer__new-btn {
		all: unset;
		box-sizing: border-box;
		width: 100%;
		text-align: center;
		padding: 6px 10px;
		border-radius: 7px;
		font-size: 12px;
		font-weight: 600;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		cursor: pointer;
	}

	.lumina-split-drawer__new-btn:hover {
		opacity: 0.92;
	}

	.lumina-split-drawer__search-box {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border-radius: 6px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
	}

	.lumina-split-drawer__search-box:focus-within {
		border-color: var(--interactive-accent);
	}

	.lumina-split-drawer__search-icon {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.lumina-split-drawer__search-input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text-normal);
		font-size: 12px;
		padding: 0;
	}

	.lumina-split-drawer__search-clear {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 2px;
		display: inline-flex;
	}

	.lumina-split-drawer__list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.lumina-split-drawer__empty {
		text-align: center;
		padding: 28px 12px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.lumina-split-drawer__item {
		padding: 8px 10px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: var(--background-primary);
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 6px;
		transition: all 0.15s ease;
	}

	.lumina-split-drawer__item:hover {
		border-color: var(--background-modifier-border);
	}

	.lumina-split-drawer__item.is-active {
		border-color: color-mix(in srgb, var(--interactive-accent) 45%, transparent);
		background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary));
	}

	.lumina-split-drawer__item-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 6px;
	}

	.lumina-split-drawer__item-main {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.lumina-split-drawer__item-title {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lumina-split-drawer__item-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10.5px;
		color: var(--text-muted);
	}

	.lumina-split-drawer__actions {
		display: flex;
		align-items: center;
		gap: 2px;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.lumina-split-drawer__item:hover .lumina-split-drawer__actions,
	:global(.is-mobile) .lumina-split-drawer__item .lumina-split-drawer__actions {
		opacity: 1;
	}

	.lumina-split-drawer__action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}

	.lumina-split-drawer__action-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-split-drawer__action-btn--delete:hover {
		background: var(--background-modifier-error-hover);
		color: var(--text-error);
	}

	.lumina-split-drawer__models {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.lumina-split-drawer__model-pill {
		font-size: 9.5px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		color: var(--text-muted);
		max-width: 110px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-split-drawer__rename-box {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
	}

	.lumina-split-drawer__rename-input {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		padding: 3px 6px;
		border-radius: 4px;
		border: 1px solid var(--interactive-accent);
		background: var(--background-primary);
		color: var(--text-normal);
	}
</style>
