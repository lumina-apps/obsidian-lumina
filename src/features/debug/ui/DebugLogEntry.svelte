<script lang="ts">
	import { setIcon } from 'obsidian';
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