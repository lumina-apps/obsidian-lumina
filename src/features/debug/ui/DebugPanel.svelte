<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import type LuminaPlugin from '../../../main';
	import { debugLogger } from '../../../shared/debugLogger';
	import { t } from '../../../shared/locales/helpers';
	import type { DebugLogEntry, DebugLogType } from '../../../shared/types/debug.types';
	import DebugHeader from './DebugHeader.svelte';
	import DebugFilterBar from './DebugFilterBar.svelte';
	import DebugEmptyState from './DebugEmptyState.svelte';
	import DebugLogEntryComp from './DebugLogEntry.svelte';

	let { plugin }: { plugin: LuminaPlugin } = $props();

	// ── 상태 ──────────────────────────────────────────────────────────────────
	let entries = $state<DebugLogEntry[]>([]);
	let expandedIds = $state<Set<string>>(new Set());
	let filterType = $state<DebugLogType | 'all'>('all');
	let autoScroll = $state(true);
	let logContainerEl: HTMLElement | null = $state(null);
	let unsubLog: (() => void) | null = null;
	let unsubClear: (() => void) | null = null;

	// ── 계산된 값 ─────────────────────────────────────────────────────────────
	const filteredEntries = $derived(
		filterType === 'all'
			? entries
			: entries.filter((e) => e.type === filterType),
	);

	const allFilteredExpanded = $derived(
		filteredEntries.length > 0 &&
			filteredEntries.every((e) => expandedIds.has(e.id)),
	);

	const anyFilteredExpanded = $derived(
		filteredEntries.some((e) => expandedIds.has(e.id)),
	);

	// ── 구독 ──────────────────────────────────────────────────────────────────
	onMount(() => {
		entries = [...debugLogger.getEntries()];

		unsubLog = debugLogger.onLog((entry) => {
			entries = [...entries, entry];
			if (entries.length > 200) entries = entries.slice(-200);
			if (autoScroll) scrollToBottom();
		});

		unsubClear = debugLogger.onClear(() => {
			entries = [];
		});
	});

	onDestroy(() => {
		unsubLog?.();
		unsubClear?.();
	});

	// ── 스크롤 ────────────────────────────────────────────────────────────────
	function scrollToBottom() {
		tick().then(() => {
			if (logContainerEl) {
				logContainerEl.scrollTop = logContainerEl.scrollHeight;
			}
		});
	}

	// ── 펼치기/접기 ──────────────────────────────────────────────────────────
	function toggleExpand(id: string) {
		const next = new Set(expandedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedIds = next;
	}

	function expandAll() {
		const next = new Set(expandedIds);
		for (const e of filteredEntries) {
			next.add(e.id);
		}
		expandedIds = next;
	}

	function collapseAll() {
		const next = new Set(expandedIds);
		for (const e of filteredEntries) {
			next.delete(e.id);
		}
		expandedIds = next;
	}

	// ── 액션 ──────────────────────────────────────────────────────────────────
	function clearLogs() {
		if (confirm(t('uiMessages.debugDelAllMsg'))) {
			debugLogger.clear();
		}
	}

	function exportLogs() {
		const blob = new Blob([JSON.stringify(entries, null, 2)], {
			type: 'application/json',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `lumina-devlog-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function toggleAutoScroll() {
		autoScroll = !autoScroll;
	}

	function handleFilterChange(value: DebugLogType | 'all') {
		filterType = value;
	}
</script>

<div class="lumina-debug">
	<DebugHeader
		entryCount={entries.length}
		{autoScroll}
		onToggleAutoScroll={toggleAutoScroll}
		onExport={exportLogs}
		onClear={clearLogs}
	/>

	<DebugFilterBar
		{filterType}
		filteredCount={filteredEntries.length}
		{allFilteredExpanded}
		{anyFilteredExpanded}
		onFilterChange={handleFilterChange}
		onExpandAll={expandAll}
		onCollapseAll={collapseAll}
	/>

	<div class="lumina-debug__log-list" bind:this={logContainerEl}>
		{#if filteredEntries.length === 0}
			<DebugEmptyState debugMode={plugin.settings.misc.debugMode} />
		{:else}
			{#each filteredEntries as entry (entry.id)}
				<DebugLogEntryComp
					{entry}
					expanded={expandedIds.has(entry.id)}
					ontoggle={toggleExpand}
				/>
			{/each}
		{/if}
	</div>
</div>

<style>
	/* ── Layout ── */
	.lumina-debug {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--background-primary);
		font-family: var(--font-interface);
		font-size: 12px;
	}

	/* ── Log List ── */
	.lumina-debug__log-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0;
	}

	.lumina-debug__log-list::-webkit-scrollbar {
		width: 4px;
	}

	.lumina-debug__log-list::-webkit-scrollbar-thumb {
		background: var(--background-modifier-border);
		border-radius: 2px;
	}

	/* ── 모든 자식 컴포넌트에 공유되는 스타일 (global로 적용) ── */

	:global(.lumina-debug__header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	:global(.lumina-debug__title) {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 700;
		color: var(--text-normal);
	}

	:global(.lumina-debug__title-icon) {
		color: var(--text-muted);
		display: flex;
		align-items: center;
	}

	:global(.lumina-debug__count) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		font-size: 10px;
		font-weight: 700;
		border-radius: 9px;
		background: var(--background-modifier-border);
		color: var(--text-muted);
	}

	:global(.lumina-debug__actions) {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	:global(.lumina-debug__action-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 5px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
		padding: 0;
	}

	:global(.lumina-debug__action-btn:hover:not(:disabled)) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.lumina-debug__action-btn.is-active) {
		background: rgba(var(--color-accent-1), 0.15);
		color: var(--interactive-accent);
	}

	:global(.lumina-debug__action-btn--danger:hover:not(:disabled)) {
		background: rgba(var(--color-red-rgb), 0.12);
		color: var(--color-red);
	}

	:global(.lumina-debug__action-btn:disabled) {
		opacity: 0.3;
		cursor: default;
	}

	/* ── Filter Bar ── */
	:global(.lumina-debug__filters) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 10px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
		gap: 8px;
	}

	:global(.lumina-debug__filter-group) {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	:global(.lumina-debug__filter-actions) {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	:global(.lumina-debug__filter-btn) {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 4px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	:global(.lumina-debug__filter-btn:hover) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.lumina-debug__filter-btn.is-active) {
		background: var(--background-modifier-border);
		color: var(--text-normal);
		border-color: var(--background-modifier-border-hover);
	}

	/* ── Empty State ── */
	:global(.lumina-debug__empty) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 180px;
		gap: 8px;
		color: var(--text-muted);
		text-align: center;
		padding: 0 20px;
	}

	:global(.lumina-debug__empty p) {
		margin: 0;
		font-size: 12px;
	}

	:global(.lumina-debug__empty-sub) {
		font-size: 10px;
		opacity: 0.7;
	}

	/* ── Entry ── */
	:global(.lumina-debug__entry) {
		border-bottom: 1px solid var(--background-modifier-border);
		cursor: pointer;
		transition: background 0.1s ease;
	}

	:global(.lumina-debug__entry:hover) {
		background: var(--background-secondary);
	}

	:global(.lumina-debug__entry.is-expanded) {
		background: var(--background-secondary);
	}

	:global(.lumina-debug__entry-header) {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		min-height: 32px;
	}

	/* Type Badge */
	:global(.lumina-debug__entry-type) {
		flex-shrink: 0;
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.05em;
		padding: 1px 5px;
		border-radius: 3px;
		font-family: var(--font-monospace);
	}

	:global(.lumina-debug__entry-type--llm-request) {
		background: rgba(99, 102, 241, 0.15);
		color: #818cf8;
	}

	:global(.lumina-debug__entry-type--llm-response) {
		background: rgba(34, 197, 94, 0.15);
		color: #4ade80;
	}

	:global(.lumina-debug__entry-type--rag) {
		background: rgba(234, 179, 8, 0.15);
		color: #facc15;
	}

	:global(.lumina-debug__entry-type--system) {
		background: rgba(148, 163, 184, 0.15);
		color: var(--text-muted);
	}

	:global(.lumina-debug__entry-type--error) {
		background: rgba(239, 68, 68, 0.15);
		color: #f87171;
	}

	:global(.lumina-debug__entry-type--mcp) {
		background: rgba(168, 85, 247, 0.15);
		color: #c084fc;
	}

	:global(.lumina-debug__entry-time) {
		flex-shrink: 0;
		font-size: 10px;
		font-family: var(--font-monospace);
		color: var(--text-faint);
	}

	:global(.lumina-debug__entry-summary) {
		flex: 1;
		font-size: 11px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.lumina-debug__entry-summary--error) {
		color: #f87171;
	}

	:global(.lumina-debug__entry-chevron) {
		flex-shrink: 0;
		color: var(--text-faint);
		width: 14px;
		height: 14px;
		display: flex;
		align-items: center;
	}

	/* ── Entry Body ── */
	:global(.lumina-debug__entry-body) {
		padding: 0 12px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--background-modifier-border);
		margin-top: 0;
	}

	/* ── Section ── */
	:global(.lumina-debug__section) {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	:global(.lumina-debug__section-title) {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
		padding-top: 6px;
	}

	:global(.lumina-debug__section-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 8px;
	}

	:global(.lumina-debug__copy-btn) {
		background: none;
		border: none;
		padding: 4px;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
	}

	:global(.lumina-debug__copy-btn:hover) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	/* ── Table ── */
	:global(.lumina-debug__table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 11px;
	}

	:global(.lumina-debug__table td) {
		padding: 2px 6px 2px 0;
		vertical-align: top;
		user-select: text;
		-webkit-user-select: text;
	}

	:global(.lumina-debug__table td:first-child) {
		width: 120px;
		color: var(--text-faint);
		font-size: 10px;
		font-weight: 600;
		flex-shrink: 0;
	}

	:global(.lumina-debug__table td:last-child) {
		color: var(--text-normal);
		font-family: var(--font-monospace);
		word-break: break-all;
	}

	/* ── Pre ── */
	:global(.lumina-debug__pre) {
		margin: 0;
		padding: 6px 8px;
		background: var(--background-primary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		font-size: 10.5px;
		font-family: var(--font-monospace);
		color: var(--text-muted);
		white-space: pre-wrap;
		word-break: break-all;
		line-height: 1.5;
		max-height: 240px;
		overflow-y: auto;
		user-select: text;
		-webkit-user-select: text;
	}

	:global(.lumina-debug__pre--error) {
		color: #f87171;
		background: rgba(239, 68, 68, 0.05);
		border-color: rgba(239, 68, 68, 0.2);
	}

	/* ── Messages ── */
	:global(.lumina-debug__message-item) {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 6px;
	}

	:global(.lumina-debug__message-role) {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 1px 5px;
		border-radius: 3px;
		align-self: flex-start;
	}

	:global(.lumina-debug__message-role--user) {
		background: rgba(99, 102, 241, 0.15);
		color: #818cf8;
	}

	:global(.lumina-debug__message-role--assistant) {
		background: rgba(34, 197, 94, 0.12);
		color: #4ade80;
	}

	:global(.lumina-debug__message-role--system) {
		background: rgba(148, 163, 184, 0.12);
		color: var(--text-muted);
	}

	/* ── RAG Chunks ── */
	:global(.lumina-debug__rag-chunk) {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 6px;
	}

	:global(.lumina-debug__rag-chunk-header) {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	:global(.lumina-debug__rag-rank) {
		font-size: 9px;
		font-weight: 700;
		color: var(--text-faint);
		font-family: var(--font-monospace);
	}

	:global(.lumina-debug__rag-score) {
		font-size: 9px;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 3px;
		background: rgba(234, 179, 8, 0.12);
		color: #facc15;
		font-family: var(--font-monospace);
	}

	:global(.lumina-debug__rag-path) {
		font-size: 10px;
		color: var(--text-muted);
		font-style: italic;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Misc ── */
	:global(.lumina-debug__mono) {
		font-family: var(--font-monospace);
		font-size: 10px;
	}

	:global(.lumina-debug__error-text) {
		color: #f87171;
	}
</style>