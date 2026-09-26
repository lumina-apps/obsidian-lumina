<script lang="ts">
	import { setIcon } from "obsidian";
	import type { Readable } from "svelte/store";
	import type { TranslationKeys } from "../../../shared/locales/locale.types";

	type TStore = Readable<
		(key: TranslationKeys, params?: Record<string, string | number>) => string
	>;

	let {
		isCliSelected = false,
		agentEnabled = false,
		agentExecutionMode = "read",
		includeActiveNote,
		sendHint,
		estimatedInputTokens = 0,
		estimatedTokensDisplayText = "",
		isTokenOverLimit = false,
		sessionTokenStats,
		tStore,
		onInsertContextMention,
		onFileSelect,
		onToggleMcpPopup,
		onToggleAgentExecutionMode,
		onToggleActiveNote,
	} = $props<{
		isCliSelected?: boolean;
		agentEnabled: boolean;
		agentExecutionMode: "read" | "edit";
		includeActiveNote: boolean;
		sendHint: string;
		estimatedInputTokens?: number;
		estimatedTokensDisplayText?: string;
		isTokenOverLimit?: boolean;
		sessionTokenStats: { totalTokens: number };
		tStore: TStore;
		onInsertContextMention: () => void;
		onFileSelect: (e: Event) => void;
		onToggleMcpPopup: () => void;
		onToggleAgentExecutionMode: () => void;
		onToggleActiveNote: () => void;
	}>();

	let fileInputEl: HTMLInputElement | null = $state(null);

	function triggerFileInput() {
		fileInputEl?.click();
	}

	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
		return {
			update(newIconId: string) {
				node.empty();
				setIcon(node, newIconId);
			},
		};
	}
</script>

<div class="lumina-chat__input-toolbar">
	<div class="lumina-chat__toolbar-group">
		<button
			class="lumina-chat__toolbar-btn"
			aria-label={$tStore("chat.addContext")}
			title={$tStore("chat.addContext")}
			use:icon={"lumina-at-sign"}
			onclick={onInsertContextMention}
			type="button"
		></button>
		<button
			class="lumina-chat__toolbar-btn"
			aria-label={$tStore("chat.uploadFile")}
			use:icon={"paperclip"}
			onclick={triggerFileInput}
			type="button"
		></button>
		{#if !isCliSelected}
			<button
				class="lumina-chat__toolbar-btn"
				class:is-agent-active={agentEnabled}
				aria-label="Agent & MCP Tools"
				title="Agent & MCP Tools"
				use:icon={"bot"}
				onclick={onToggleMcpPopup}
				type="button"
			></button>
		{/if}
	</div>

	<input
		type="file"
		multiple
		class="lumina-chat__hidden-file-input"
		bind:this={fileInputEl}
		onchange={onFileSelect}
	/>

	<div class="lumina-chat__toolbar-right">
		{#if estimatedTokensDisplayText || estimatedInputTokens > 0}
			<span
				class="lumina-chat__token-stats"
				title={isTokenOverLimit
					? ($tStore("chat.tokenOverLimitTooltip") || "Context exceeds 100k tokens (capped estimate)")
					: ($tStore("chat.estimatedTokensTooltip") || "Estimated input tokens for this prompt (approx.)")}
			>
				{estimatedTokensDisplayText || `~${estimatedInputTokens.toLocaleString()} tokens`}
			</span>
		{/if}
		{#if sessionTokenStats.totalTokens > 0}
			<span
				class="lumina-chat__token-stats"
				title={$tStore("chat.sessionUsage")}
			>
				{$tStore("chat.sessionTokens", {
					tokens: sessionTokenStats.totalTokens.toLocaleString(),
				})}
			</span>
		{/if}
		<span class="lumina-chat__hint-inline">{sendHint}</span>
		{#if agentEnabled || isCliSelected}
			<button
				class="lumina-chat__context-badge"
				class:is-active={agentExecutionMode === "edit"}
				onclick={onToggleAgentExecutionMode}
				aria-label={isCliSelected
					? (agentExecutionMode === "edit"
						? ($tStore("chat.cliMode.editModeTooltip") || "Edit Mode: CLI agent can create and edit notes")
						: ($tStore("chat.cliMode.readModeTooltip") || "Read Mode: CLI agent is read-only and cannot modify notes"))
					: (agentExecutionMode === "edit"
						? ($tStore("settings.mcp.agentMode.editMode") || "Toggle Agent Mode (Read/Edit)")
						: ($tStore("settings.mcp.agentMode.readMode") || "Toggle Agent Mode (Read/Edit)"))}
				title={isCliSelected
					? (agentExecutionMode === "edit"
						? ($tStore("chat.cliMode.editModeTooltip") || "Edit Mode: CLI agent can create and edit notes")
						: ($tStore("chat.cliMode.readModeTooltip") || "Read Mode: CLI agent is read-only and cannot modify notes"))
					: undefined}
				type="button"
			>
				<span use:icon={agentExecutionMode === "edit" ? "edit-2" : "eye"}></span>
				<span>{agentExecutionMode === "edit"
						? $tStore("settings.mcp.agentMode.editMode") || "Edit Mode"
						: $tStore("settings.mcp.agentMode.readMode") || "Read Mode"}</span>
			</button>
		{/if}
		<button
			class="lumina-chat__context-badge"
			class:is-active={includeActiveNote}
			aria-label={$tStore("settings.rag.autoIncludeActive.name")}
			onclick={onToggleActiveNote}
		>
			<span use:icon={includeActiveNote ? "file-text" : "file-minus"}></span>
			<span>{includeActiveNote
					? $tStore("settings.chat.context.includeNote") || "Include Note"
					: $tStore("settings.chat.context.excludeNote") || "Exclude Note"}</span>
		</button>
	</div>
</div>
