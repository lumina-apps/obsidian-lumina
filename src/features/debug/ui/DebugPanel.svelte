<script lang="ts">
	import { onMount, onDestroy, tick } from "svelte";
	import { setIcon } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import { debugLogger } from "../../../shared/debugLogger";
	import { t } from "../../../shared/locales/helpers";
	import type {
		DebugLogEntry,
		LLMRequestLog,
		LLMResponseLog,
		RAGSearchLog,
		SystemLog,
		ErrorLog,
		MCPLog,
	} from "../../../shared/types/debug.types";

	let { plugin }: { plugin: LuminaPlugin } = $props();

	// ── 상태 ──────────────────────────────────────────────────────────────────
	let entries = $state<DebugLogEntry[]>([]);
	let expandedIds = $state<Set<string>>(new Set());
	let filterType = $state<
		"all" | "llm-request" | "llm-response" | "rag" | "system" | "error" | "mcp"
	>("all");
	let autoScroll = $state(true);
	let logContainerEl: HTMLElement | null = $state(null);
	let unsubLog: (() => void) | null = null;
	let unsubClear: (() => void) | null = null;

	// ── 계산된 값 ─────────────────────────────────────────────────────────────
	const filteredEntries = $derived(
		filterType === "all"
			? entries
			: entries.filter((e) => e.type === filterType),
	);

	const allFilteredExpanded = $derived(
		filteredEntries.length > 0 &&
			filteredEntries.every((e) => expandedIds.has(e.id))
	);

	const anyFilteredExpanded = $derived(
		filteredEntries.some((e) => expandedIds.has(e.id))
	);

	// ── 구독 ──────────────────────────────────────────────────────────────────
	onMount(() => {
		// 기존 로그 가져오기
		entries = [...debugLogger.getEntries()];

		// 새 로그 구독
		unsubLog = debugLogger.onLog((entry) => {
			entries = [...entries, entry];
			if (entries.length > 200) entries = entries.slice(-200);
			if (autoScroll) scrollToBottom();
		});

		// clear 구독
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
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `lumina-devlog-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			import("obsidian").then(({ Notice }) => {
				new Notice(t('uiMessages.copiedToClipboard') || "Copied to clipboard");
			});
		} catch (err) {
			console.error("Failed to copy", err);
		}
	}

	// ── 포맷 헬퍼 ────────────────────────────────────────────────────────────
	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString("ko-KR", { hour12: false });
	}

	function formatDuration(ms: number): string {
		return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
	}

	function truncate(str: string, max = 120): string {
		return str.length <= max ? str : str.slice(0, max) + "…";
	}

	function typeLabel(type: string): string {
		const map: Record<string, string> = {
			"llm-request": "REQUEST",
			"llm-response": "RESPONSE",
			rag: "RAG",
			system: "SYSTEM",
			error: "ERROR",
			mcp: "MCP",
		};
		return map[type] ?? type.toUpperCase();
	}

	// Svelte 액션: Obsidian setIcon
	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
		return {
			update(newId: string) {
				node.empty();
				setIcon(node, newId);
			},
		};
	}
</script>

<div class="lumina-debug">
	<!-- Header -->
	<div class="lumina-debug__header">
		<div class="lumina-debug__title">
			<span class="lumina-debug__title-icon" use:icon={"bug"}></span>
			<span>DevLog</span>
			{#if entries.length > 0}
				<span class="lumina-debug__count">{entries.length}</span>
			{/if}
		</div>

		<div class="lumina-debug__actions">
			<!-- Auto-scroll toggle -->
			<button
				class="lumina-debug__action-btn"
				class:is-active={autoScroll}
				aria-label="{t('uiMessages.debugAutoScroll')} {autoScroll ? 'ON' : 'OFF'}"
				onclick={() => (autoScroll = !autoScroll)}
				type="button"
			>
				<span use:icon={"arrow-down-to-line"}></span>
			</button>

			<!-- Export -->
			<button
				class="lumina-debug__action-btn"
				aria-label={t('uiMessages.debugExport')}
				onclick={exportLogs}
				disabled={entries.length === 0}
				type="button"
			>
				<span use:icon={"download"}></span>
			</button>

			<!-- Clear -->
			<button
				class="lumina-debug__action-btn lumina-debug__action-btn--danger"
				aria-label={t('uiMessages.debugDelAll')}
				onclick={clearLogs}
				disabled={entries.length === 0}
				type="button"
			>
				<span use:icon={"trash-2"}></span>
			</button>
		</div>
	</div>

	<!-- Filter Bar -->
	<div class="lumina-debug__filters">
		<div class="lumina-debug__filter-group">
			{#each [{ value: "all", label: "All" }, { value: "llm-request", label: "Request" }, { value: "llm-response", label: "Response" }, { value: "rag", label: "RAG" }, { value: "system", label: "System" }, { value: "error", label: "Error" }, { value: "mcp", label: "MCP" }] as f}
				<button
					class="lumina-debug__filter-btn"
					class:is-active={filterType === f.value}
					onclick={() => (filterType = f.value as typeof filterType)}
					type="button"
				>
					{f.label}
				</button>
			{/each}
		</div>
		<div class="lumina-debug__filter-actions">
			<button
				class="lumina-debug__action-btn"
				aria-label={t('uiMessages.debugExpandAll')}
				onclick={expandAll}
				disabled={filteredEntries.length === 0 || allFilteredExpanded}
				type="button"
			>
				<span use:icon={"chevrons-down"}></span>
			</button>
			<button
				class="lumina-debug__action-btn"
				aria-label={t('uiMessages.debugCollapseAll')}
				onclick={collapseAll}
				disabled={!anyFilteredExpanded}
				type="button"
			>
				<span use:icon={"chevrons-up"}></span>
			</button>
		</div>
	</div>

	<!-- Log List -->
	<div class="lumina-debug__log-list" bind:this={logContainerEl}>
		{#if filteredEntries.length === 0}
			<div class="lumina-debug__empty">
				<span use:icon={"terminal"}></span>
				<p>{t('uiMessages.debugNoLogs')}</p>
				<p class="lumina-debug__empty-sub">
					{plugin.settings.misc.debugMode
						? t('uiMessages.debugWaitLlm')
						: t('uiMessages.debugTurnOn')}
				</p>
			</div>
		{:else}
			{#each filteredEntries as entry (entry.id)}
				{@const expanded = expandedIds.has(entry.id)}
				<div
					class="lumina-debug__entry lumina-debug__entry--{entry.type}"
					class:is-expanded={expanded}
					onclick={() => toggleExpand(entry.id)}
					role="button"
					tabindex="0"
					onkeydown={(e) => e.key === "Enter" && toggleExpand(entry.id)}
				>
					<!-- Entry Header (항상 표시) -->
					<div class="lumina-debug__entry-header">
						<span
							class="lumina-debug__entry-type lumina-debug__entry-type--{entry.type}"
						>
							{typeLabel(entry.type)}
						</span>
						<span class="lumina-debug__entry-time"
							>{formatTime(entry.timestamp)}</span
						>

						<!-- 타입별 요약 -->
						{#if entry.type === "llm-request"}
							{@const e = entry as LLMRequestLog}
							<span class="lumina-debug__entry-summary">
								{e.model} · temp {e.temperature} · max {e.maxTokens}tok
								{#if e.ragChunks?.length}
									· RAG {e.ragChunks.length}{t('uiMessages.debugChunks')}{/if}
							</span>
						{:else if entry.type === "llm-response"}
							{@const e = entry as LLMResponseLog}
							<span class="lumina-debug__entry-summary">
								{formatDuration(e.durationMs)}
								{#if e.usage}
									· {e.usage.inputTokens}in / {e.usage.outputTokens}out{/if}
								{#if e.stopReason}
									· {e.stopReason}{/if}
							</span>
						{:else if entry.type === "rag"}
							{@const e = entry as RAGSearchLog}
							<span class="lumina-debug__entry-summary">
								"{truncate(e.query, 40)}" · {e.chunks.length}{t('uiMessages.debugChunks')} · {formatDuration(
									e.durationMs,
								)}
							</span>
						{:else if entry.type === "system"}
							{@const e = entry as SystemLog}
							<span class="lumina-debug__entry-summary"
								>{e.event} — {truncate(e.message, 60)}</span
							>
						{:else if entry.type === "error"}
							{@const e = entry as ErrorLog}
							<span
								class="lumina-debug__entry-summary lumina-debug__entry-summary--error"
							>
								[{e.domain}] {truncate(e.message, 80)}
							</span>
						{:else if entry.type === "mcp"}
							{@const e = entry as MCPLog}
							<span class="lumina-debug__entry-summary">
								{e.action} — {truncate(e.message, 60)}
							</span>
						{/if}

						<span
							class="lumina-debug__entry-chevron"
							use:icon={expanded ? "chevron-up" : "chevron-down"}
						></span>
					</div>

					<!-- Entry Detail (펼쳤을 때) -->
					{#if expanded}
						<div class="lumina-debug__entry-body">
							{#if entry.type === "llm-request"}
								{@const e = entry as LLMRequestLog}
								<!-- Model Config -->
								<section class="lumina-debug__section">
									<div class="lumina-debug__section-title">Model Config</div>
									<table class="lumina-debug__table">
										<tbody>
											<tr><td>model</td><td>{e.model}</td></tr>
											<tr><td>provider</td><td>{e.provider}</td></tr>
											<tr><td>temperature</td><td>{e.temperature}</td></tr>
											<tr><td>max_tokens</td><td>{e.maxTokens}</td></tr>
											{#if e.topP !== undefined}<tr
													><td>top_p</td><td>{e.topP}</td></tr
												>{/if}
											<tr><td>stream</td><td>{e.stream}</td></tr>
											{#if e.estimatedInputTokens !== undefined}
												<tr
													><td>est. input tokens</td><td
														>{e.estimatedInputTokens}</td
													></tr
												>
											{/if}
										</tbody>
									</table>
								</section>

								<!-- System Prompt -->
								<section class="lumina-debug__section">
									<div class="lumina-debug__section-title">System Prompt</div>
									<pre class="lumina-debug__pre">{e.systemPrompt}</pre>
								</section>

								<!-- Messages -->
								<section class="lumina-debug__section">
									<div class="lumina-debug__section-title">
										Messages ({e.messages.length})
									</div>
									{#each e.messages as msg, i}
										<div class="lumina-debug__message-item">
											<span
												class="lumina-debug__message-role lumina-debug__message-role--{msg.role}"
												>{msg.role}</span
											>
											<pre class="lumina-debug__pre">{msg.content}</pre>
										</div>
									{/each}
								</section>

								<!-- RAG Chunks -->
								{#if e.ragChunks && e.ragChunks.length > 0}
									<section class="lumina-debug__section">
										<div class="lumina-debug__section-title">
											RAG Context ({e.ragChunks.length} chunks injected)
										</div>
										{#each e.ragChunks as chunk, i}
											<div class="lumina-debug__rag-chunk">
												<div class="lumina-debug__rag-chunk-header">
													<span class="lumina-debug__rag-score"
														>score {chunk.score.toFixed(3)}</span
													>
													<span class="lumina-debug__rag-path"
														>{chunk.filePath}</span
													>
												</div>
												<pre class="lumina-debug__pre">{chunk.fullContent}</pre>
											</div>
										{/each}
									</section>
								{/if}
							{:else if entry.type === "llm-response"}
								{@const e = entry as LLMResponseLog}
								<!-- Stats -->
								<section class="lumina-debug__section">
									<div class="lumina-debug__section-title">Stats</div>
									<table class="lumina-debug__table">
										<tbody>
											<tr
												><td>duration</td><td>{formatDuration(e.durationMs)}</td
												></tr
											>
											{#if e.usage}
												<tr
													><td>input tokens</td><td>{e.usage.inputTokens}</td
													></tr
												>
												<tr
													><td>output tokens</td><td>{e.usage.outputTokens}</td
													></tr
												>
												<tr
													><td>total tokens</td><td>{e.usage.totalTokens}</td
													></tr
												>
											{/if}
											{#if e.stopReason}<tr
													><td>stop_reason</td><td>{e.stopReason}</td></tr
												>{/if}
											<tr
												><td>request_id</td><td class="lumina-debug__mono"
													>{e.requestId}</td
												></tr
											>
										</tbody>
									</table>
								</section>

								<!-- Response Content -->
								<section class="lumina-debug__section">
									<div class="lumina-debug__section-title">Response</div>
									<pre class="lumina-debug__pre">{e.content}</pre>
								</section>
							{:else if entry.type === "rag"}
								{@const e = entry as RAGSearchLog}
								<section class="lumina-debug__section">
									<div class="lumina-debug__section-title">Search Info</div>
									<table class="lumina-debug__table">
										<tbody>
											<tr><td>query</td><td>{e.query}</td></tr>
											<tr><td>top-K</td><td>{e.topK}</td></tr>
											<tr><td>results</td><td>{e.chunks.length}</td></tr>
											<tr
												><td>duration</td><td>{formatDuration(e.durationMs)}</td
												></tr
											>
										</tbody>
									</table>
								</section>

								{#if e.chunks.length > 0}
									<section class="lumina-debug__section">
										<div class="lumina-debug__section-title">Chunks</div>
										{#each e.chunks as chunk, i}
											<div class="lumina-debug__rag-chunk">
												<div class="lumina-debug__rag-chunk-header">
													<span class="lumina-debug__rag-rank">#{i + 1}</span>
													<span class="lumina-debug__rag-score"
														>score {chunk.score.toFixed(3)}</span
													>
													<span class="lumina-debug__rag-path"
														>{chunk.filePath}</span
													>
												</div>
												<pre class="lumina-debug__pre">{chunk.fullContent}</pre>
											</div>
										{/each}
									</section>
								{/if}
							{:else if entry.type === "system"}
								{@const e = entry as SystemLog}
								<section class="lumina-debug__section">
									<table class="lumina-debug__table">
										<tbody>
											<tr><td>event</td><td>{e.event}</td></tr>
											<tr><td>message</td><td>{e.message}</td></tr>
										</tbody>
									</table>
									{#if e.meta}
										<div
											class="lumina-debug__section-title"
											style="margin-top:8px"
										>
											Meta
										</div>
										<pre class="lumina-debug__pre">{JSON.stringify(
												e.meta,
												null,
												2,
											)}</pre>
									{/if}
								</section>
							{:else if entry.type === "error"}
								{@const e = entry as ErrorLog}
								<section class="lumina-debug__section">
									<table class="lumina-debug__table">
										<tbody>
											<tr><td>domain</td><td>{e.domain}</td></tr>
											<tr
												><td>message</td><td class="lumina-debug__error-text"
													>{e.message}</td
												></tr
											>
										</tbody>
									</table>
									{#if e.stack}
										<div
											class="lumina-debug__section-title"
											style="margin-top:8px"
										>
											Stack Trace
										</div>
										<pre
											class="lumina-debug__pre lumina-debug__pre--error">{e.stack}</pre>
									{/if}
								</section>
							{:else if entry.type === "mcp"}
								{@const e = entry as MCPLog}
								<section class="lumina-debug__section">
									<table class="lumina-debug__table">
										<tbody>
											<tr><td>action</td><td>{e.action}</td></tr>
											<tr><td>message</td><td>{e.message}</td></tr>
										</tbody>
									</table>
									{#if e.data}
										<div class="lumina-debug__section-header">
											<div class="lumina-debug__section-title" style="margin-top:0">Data</div>
											<button class="lumina-debug__copy-btn" onclick={(evt) => { evt.stopPropagation(); copyToClipboard(typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2)); }} aria-label="Copy JSON" title="Copy JSON">
												<span use:icon={"copy"}></span>
											</button>
										</div>
										<pre class="lumina-debug__pre">{typeof e.data === 'string' ? e.data : JSON.stringify(
												e.data,
												null,
												2,
											)}</pre>
									{/if}
								</section>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.lumina-debug {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--background-primary);
		font-family: var(--font-interface);
		font-size: 12px;
	}

	/* ── Header ── */
	.lumina-debug__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	.lumina-debug__title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 700;
		color: var(--text-normal);
	}

	.lumina-debug__title-icon {
		color: var(--text-muted);
		display: flex;
		align-items: center;
	}

	.lumina-debug__count {
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

	.lumina-debug__actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.lumina-debug__action-btn {
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

	.lumina-debug__action-btn:hover:not(:disabled) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-debug__action-btn.is-active {
		background: rgba(var(--color-accent-1), 0.15);
		color: var(--interactive-accent);
	}

	.lumina-debug__action-btn--danger:hover:not(:disabled) {
		background: rgba(var(--color-red-rgb), 0.12);
		color: var(--color-red);
	}

	.lumina-debug__action-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	/* ── Filter Bar ── */
	.lumina-debug__filters {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 10px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
		gap: 8px;
	}

	.lumina-debug__filter-group {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.lumina-debug__filter-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.lumina-debug__filter-btn {
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

	.lumina-debug__filter-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-debug__filter-btn.is-active {
		background: var(--background-modifier-border);
		color: var(--text-normal);
		border-color: var(--background-modifier-border-hover);
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

	/* ── Empty State ── */
	.lumina-debug__empty {
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

	.lumina-debug__empty p {
		margin: 0;
		font-size: 12px;
	}

	.lumina-debug__empty-sub {
		font-size: 10px !important;
		opacity: 0.7;
	}

	/* ── Entry ── */
	.lumina-debug__entry {
		border-bottom: 1px solid var(--background-modifier-border);
		cursor: pointer;
		transition: background 0.1s ease;
	}

	.lumina-debug__entry:hover {
		background: var(--background-secondary);
	}

	.lumina-debug__entry.is-expanded {
		background: var(--background-secondary);
	}

	.lumina-debug__entry-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		min-height: 32px;
	}

	/* Type Badge */
	.lumina-debug__entry-type {
		flex-shrink: 0;
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.05em;
		padding: 1px 5px;
		border-radius: 3px;
		font-family: var(--font-monospace);
	}

	.lumina-debug__entry-type--llm-request {
		background: rgba(99, 102, 241, 0.15);
		color: #818cf8;
	}

	.lumina-debug__entry-type--llm-response {
		background: rgba(34, 197, 94, 0.15);
		color: #4ade80;
	}

	.lumina-debug__entry-type--rag {
		background: rgba(234, 179, 8, 0.15);
		color: #facc15;
	}

	.lumina-debug__entry-type--system {
		background: rgba(148, 163, 184, 0.15);
		color: var(--text-muted);
	}

	.lumina-debug__entry-type--error {
		background: rgba(239, 68, 68, 0.15);
		color: #f87171;
	}

	.lumina-debug__entry-type--mcp {
		background: rgba(168, 85, 247, 0.15);
		color: #c084fc;
	}

	.lumina-debug__entry-time {
		flex-shrink: 0;
		font-size: 10px;
		font-family: var(--font-monospace);
		color: var(--text-faint);
	}

	.lumina-debug__entry-summary {
		flex: 1;
		font-size: 11px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-debug__entry-summary--error {
		color: #f87171;
	}

	.lumina-debug__entry-chevron {
		flex-shrink: 0;
		color: var(--text-faint);
		width: 14px;
		height: 14px;
		display: flex;
		align-items: center;
	}

	/* ── Entry Body ── */
	.lumina-debug__entry-body {
		padding: 0 12px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--background-modifier-border);
		margin-top: 0;
	}

	/* ── Section ── */
	.lumina-debug__section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-debug__section-title {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
		padding-top: 6px;
	}

	.lumina-debug__section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 8px;
	}

	.lumina-debug__copy-btn {
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

	.lumina-debug__copy-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	/* ── Table ── */
	.lumina-debug__table {
		width: 100%;
		border-collapse: collapse;
		font-size: 11px;
	}

	.lumina-debug__table td {
		padding: 2px 6px 2px 0;
		vertical-align: top;
		user-select: text;
		-webkit-user-select: text;
	}

	.lumina-debug__table td:first-child {
		width: 120px;
		color: var(--text-faint);
		font-size: 10px;
		font-weight: 600;
		flex-shrink: 0;
	}

	.lumina-debug__table td:last-child {
		color: var(--text-normal);
		font-family: var(--font-monospace);
		word-break: break-all;
	}

	/* ── Pre ── */
	.lumina-debug__pre {
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

	.lumina-debug__pre--error {
		color: #f87171;
		background: rgba(239, 68, 68, 0.05);
		border-color: rgba(239, 68, 68, 0.2);
	}

	/* ── Messages ── */
	.lumina-debug__message-item {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 6px;
	}

	.lumina-debug__message-role {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 1px 5px;
		border-radius: 3px;
		align-self: flex-start;
	}

	.lumina-debug__message-role--user {
		background: rgba(99, 102, 241, 0.15);
		color: #818cf8;
	}

	.lumina-debug__message-role--assistant {
		background: rgba(34, 197, 94, 0.12);
		color: #4ade80;
	}

	.lumina-debug__message-role--system {
		background: rgba(148, 163, 184, 0.12);
		color: var(--text-muted);
	}

	/* ── RAG Chunks ── */
	.lumina-debug__rag-chunk {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 6px;
	}

	.lumina-debug__rag-chunk-header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.lumina-debug__rag-rank {
		font-size: 9px;
		font-weight: 700;
		color: var(--text-faint);
		font-family: var(--font-monospace);
	}

	.lumina-debug__rag-score {
		font-size: 9px;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 3px;
		background: rgba(234, 179, 8, 0.12);
		color: #facc15;
		font-family: var(--font-monospace);
	}

	.lumina-debug__rag-path {
		font-size: 10px;
		color: var(--text-muted);
		font-style: italic;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Misc ── */
	.lumina-debug__mono {
		font-family: var(--font-monospace);
		font-size: 10px;
	}

	.lumina-debug__error-text {
		color: #f87171 !important;
	}
</style>
