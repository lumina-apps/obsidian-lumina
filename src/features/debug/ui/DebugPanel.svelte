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


</style>