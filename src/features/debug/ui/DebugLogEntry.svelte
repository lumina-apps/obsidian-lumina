<script lang="ts">
	import { icon } from '../../../shared/utils/iconAction';
	import type {
		DebugLogEntry,
		LLMRequestLog,
		LLMResponseLog,
		RAGSearchLog,
		SystemLog,
		ErrorLog,
		MCPLog,
	} from '../../../shared/types/debug.types';
	import { formatTime, formatDuration, truncate, typeLabel } from '../utils/formatUtils';
	import { t } from '../../../shared/locales/helpers';
	import LLMRequestDetail from './details/LLMRequestDetail.svelte';
	import LLMResponseDetail from './details/LLMResponseDetail.svelte';
	import RAGSearchDetail from './details/RAGSearchDetail.svelte';
	import SystemLogDetail from './details/SystemLogDetail.svelte';
	import ErrorLogDetail from './details/ErrorLogDetail.svelte';
	import MCPLogDetail from './details/MCPLogDetail.svelte';

	let { entry, expanded, ontoggle }: {
		entry: DebugLogEntry;
		expanded: boolean;
		ontoggle: (id: string) => void;
	} = $props();

	function handleToggle() {
		ontoggle(entry.id);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			ontoggle(entry.id);
		}
	}
</script>

<div
	class="lumina-debug__entry lumina-debug__entry--{entry.type}"
	class:is-expanded={expanded}
	onclick={handleToggle}
	role="button"
	tabindex="0"
	onkeydown={handleKeydown}
>
	<!-- Entry Header (항상 표시) -->
	<div class="lumina-debug__entry-header">
		<span class="lumina-debug__entry-type lumina-debug__entry-type--{entry.type}">
			{typeLabel(entry.type)}
		</span>
		<span class="lumina-debug__entry-time">{formatTime(entry.timestamp)}</span>

		<!-- 타입별 요약 -->
		{#if entry.type === 'llm-request'}
			{@const e = entry as LLMRequestLog}
			<span class="lumina-debug__entry-summary">
				{e.model} · temp {e.temperature} · max {e.maxTokens}tok
				{#if e.ragChunks?.length}
					· RAG {e.ragChunks.length}{t('uiMessages.debugChunks')}
				{/if}
			</span>
		{:else if entry.type === 'llm-response'}
			{@const e = entry as LLMResponseLog}
			<span class="lumina-debug__entry-summary">
				{formatDuration(e.durationMs)}
				{#if e.usage}
					· {e.usage.inputTokens}in / {e.usage.outputTokens}out
				{/if}
				{#if e.stopReason}
					· {e.stopReason}
				{/if}
			</span>
		{:else if entry.type === 'rag'}
			{@const e = entry as RAGSearchLog}
			<span class="lumina-debug__entry-summary">
				"{truncate(e.query, 40)}" · {e.chunks.length}{t('uiMessages.debugChunks')} · {formatDuration(e.durationMs)}
			</span>
		{:else if entry.type === 'system'}
			{@const e = entry as SystemLog}
			<span class="lumina-debug__entry-summary">{e.event} — {truncate(e.message, 60)}</span>
		{:else if entry.type === 'error'}
			{@const e = entry as ErrorLog}
			<span class="lumina-debug__entry-summary lumina-debug__entry-summary--error">
				[{e.domain}] {truncate(e.message, 80)}
			</span>
		{:else if entry.type === 'mcp'}
			{@const e = entry as MCPLog}
			<span class="lumina-debug__entry-summary">
				{e.action} — {truncate(e.message, 60)}
			</span>
		{/if}

		<span
			class="lumina-debug__entry-chevron"
			use:icon={expanded ? 'chevron-up' : 'chevron-down'}
		></span>
	</div>

	<!-- Entry Detail (펼쳤을 때 타입별 컴포넌트) -->
	{#if expanded}
		<div class="lumina-debug__entry-body">
			{#if entry.type === 'llm-request'}
				<LLMRequestDetail entry={entry as LLMRequestLog} />
			{:else if entry.type === 'llm-response'}
				<LLMResponseDetail entry={entry as LLMResponseLog} />
			{:else if entry.type === 'rag'}
				<RAGSearchDetail entry={entry as RAGSearchLog} />
			{:else if entry.type === 'system'}
				<SystemLogDetail entry={entry as SystemLog} />
			{:else if entry.type === 'error'}
				<ErrorLogDetail entry={entry as ErrorLog} />
			{:else if entry.type === 'mcp'}
				<MCPLogDetail entry={entry as MCPLog} />
			{/if}
		</div>
	{/if}
</div>

<style>
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

	/* Entry Body */
	.lumina-debug__entry-body {
		padding: 0 12px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--background-modifier-border);
		margin-top: 0;
	}
</style>