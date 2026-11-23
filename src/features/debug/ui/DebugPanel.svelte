<script lang="ts">
	import { Notice, Platform, normalizePath } from 'obsidian';
	import { onMount, onDestroy, tick } from 'svelte';
	import type LuminaPlugin from '../../../main';
	import { debugLogger, MAX_DEBUG_ENTRIES } from '../../../shared/debugLogger';
	import { t } from '../../../shared/locales/helpers';
	import type { DebugLogEntry, DebugLogType } from '../../../shared/types/debug.types';
	import { copyToClipboard } from '../../../shared/utils/clipboardUtils';
	import { confirmWithModal } from '../../../shared/utils/modal';
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
			if (entries.length > MAX_DEBUG_ENTRIES) entries = entries.slice(-MAX_DEBUG_ENTRIES);
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
	async function clearLogs() {
		if (await confirmWithModal(plugin.app, t('uiMessages.debugDelAll'), t('uiMessages.debugDelAllMsg'))) {
			debugLogger.clear();
		}
	}

	async function exportLogs() {
		const json = JSON.stringify(entries, null, 2);
		const fileName = `lumina-devlog-${Date.now()}.json`;

		// 모바일 WKWebView에서는 <a download>가 동작하지 않으므로 볼트 파일 저장 후 클립보드 폴백
		if (Platform.isMobile) {
			const targetPath = normalizePath(fileName);
			try {
				await plugin.app.vault.create(targetPath, json);
				new Notice(t('uiMessages.noteSaved', { path: targetPath }));
			} catch {
				await copyToClipboard(json, t('uiMessages.copiedToClipboard'));
			}
			return;
		}

		const blob = new Blob([json], {
			type: 'application/json',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		a.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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