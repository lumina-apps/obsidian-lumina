<script lang="ts">
	import { setIcon } from "obsidian";
	import type { Readable } from "svelte/store";
	import type { TranslationKeys } from "../../../shared/locales/locale.types";
	import type { ReasoningEffort } from "../../../shared/types/llm.types";
	import { FILE_INPUT_ACCEPT } from "../utils/fileAttachmentUtils";

	type TStore = Readable<
		(key: TranslationKeys, params?: Record<string, string | number>) => string
	>;

	let {
		isCliSelected = false,
		hideAgentControls = false,
		splitModelCount = 1,
		agentEnabled = false,
		agentExecutionMode = "read",
		includeActiveNote,
		activeNoteStatus = { status: "none", name: "", path: "" },
		sendHint,
		estimatedInputTokens = 0,
		estimatedTokensDisplayText = "",
		isTokenOverLimit = false,
		sessionTokenStats,
		tStore,
		showReasoningControl = false,
		reasoningEffort = "auto",
		reasoningBudgetTokens = 0,
		reasoningSupportsCustomBudget = false,
		isReasoningPopupOpen = false,
		onInsertContextMention,
		onFileSelect,
		onToggleMcpPopup,
		onToggleReasoningPopup,
		onToggleAgentExecutionMode,
		onToggleActiveNote,
	} = $props<{
		isCliSelected?: boolean;
		hideAgentControls?: boolean;
		splitModelCount?: number;
		agentEnabled: boolean;
		agentExecutionMode: "read" | "edit";
		includeActiveNote: boolean;
		activeNoteStatus?: {
			status: "ready" | "none" | "excluded";
			name: string;
			path: string;
		};
		sendHint: string;
		estimatedInputTokens?: number;
		estimatedTokensDisplayText?: string;
		isTokenOverLimit?: boolean;
		sessionTokenStats: {
			totalTokens: number;
			inputTokens?: number;
			outputTokens?: number;
			cacheReadTokens?: number;
			cacheCreationTokens?: number;
		};
		tStore: TStore;
		showReasoningControl?: boolean;
		reasoningEffort?: ReasoningEffort;
		reasoningBudgetTokens?: number;
		reasoningSupportsCustomBudget?: boolean;
		isReasoningPopupOpen?: boolean;
		onInsertContextMention: () => void;
		onFileSelect: (e: Event) => void;
		onToggleMcpPopup: () => void;
		onToggleReasoningPopup?: (e: MouseEvent) => void;
		onToggleAgentExecutionMode: () => void;
		onToggleActiveNote: () => void;
	}>();

	const activeNoteLabel = $derived.by(() => {
		if (!includeActiveNote) {
			return $tStore("settings.chat.context.excludeNote") || "Exclude Note";
		}
		if (activeNoteStatus.status === "ready") {
			return activeNoteStatus.name;
		}
		if (activeNoteStatus.status === "excluded") {
			return $tStore("settings.chat.context.activeNoteExcluded") || "Excluded Note";
		}
		return $tStore("settings.chat.context.activeNoteNone") || "No Active Note";
	});

	const activeNoteTooltip = $derived.by(() => {
		if (!includeActiveNote) {
			return activeNoteStatus.status === "ready"
				? `${$tStore("settings.rag.autoIncludeActive.name")} (${activeNoteStatus.path})`
				: $tStore("settings.rag.autoIncludeActive.name");
		}
		if (activeNoteStatus.status === "ready") {
			return $tStore("settings.chat.context.includedActiveNoteTooltip", {
				path: activeNoteStatus.path,
			});
		}
		if (activeNoteStatus.status === "excluded") {
			return $tStore("settings.chat.context.excludedActiveNoteTooltip", {
				path: activeNoteStatus.path,
			});
		}
		return $tStore("settings.chat.context.noActiveNoteTooltip");
	});

	const activeNoteIcon = $derived(
		includeActiveNote
			? activeNoteStatus.status === "ready"
				? "file-text"
				: "file-x"
			: "file-minus",
	);

	const cacheReuseInfo = $derived.by(() => {
		const input = sessionTokenStats.inputTokens ?? 0;
		const reused = sessionTokenStats.cacheReadTokens ?? 0;
		if (reused <= 0 || input <= 0) {
			return null;
		}
		const percent = Math.min(100, Math.round((reused / input) * 100));
		return { percent };
	});

	const sessionUsageTooltip = $derived.by(() => {
		const input = sessionTokenStats.inputTokens ?? 0;
		const output = sessionTokenStats.outputTokens ?? 0;
		const reused = sessionTokenStats.cacheReadTokens ?? 0;
		const written = sessionTokenStats.cacheCreationTokens ?? 0;
		if (sessionTokenStats.totalTokens <= 0) {
			return $tStore("chat.sessionUsage");
		}
		let tooltip: string;
		if (reused > 0 && input > 0) {
			const percent = Math.min(100, Math.round((reused / input) * 100));
			tooltip = $tStore("chat.sessionUsageCachedTooltip", {
				total: sessionTokenStats.totalTokens.toLocaleString(),
				input: input.toLocaleString(),
				reused: reused.toLocaleString(),
				percent,
				output: output.toLocaleString(),
			});
		} else if (input > 0 || output > 0) {
			tooltip = $tStore("chat.sessionUsageDetailedTooltip", {
				total: sessionTokenStats.totalTokens.toLocaleString(),
				input: input.toLocaleString(),
				output: output.toLocaleString(),
			});
		} else {
			tooltip = $tStore("chat.sessionUsage");
		}
		if (written > 0) {
			tooltip += $tStore("chat.sessionUsageCachedWriteSuffix", {
				written: written.toLocaleString(),
			});
		}
		return tooltip;
	});

	const reasoningBadgeLabel = $derived.by(() => {
		const base = $tStore(`settings.chat.reasoning.short.${reasoningEffort}` as TranslationKeys);
		const isEffortActive = reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high";
		if (reasoningSupportsCustomBudget && reasoningBudgetTokens > 0 && isEffortActive) {
			const budgetLabel = reasoningBudgetTokens >= 1000
				? `${Math.round(reasoningBudgetTokens / 1000)}k`
				: String(reasoningBudgetTokens);
			return `${base}·${budgetLabel}`;
		}
		return base;
	});

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
		{#if !isCliSelected && !hideAgentControls}
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
		{#if showReasoningControl}
			<button
				class="lumina-chat__reasoning-btn"
				class:is-active={reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high"}
				class:is-off={reasoningEffort === "off"}
				class:is-open={isReasoningPopupOpen}
				aria-label={$tStore("settings.chat.reasoning.toolbarTooltip")}
				aria-expanded={isReasoningPopupOpen}
				title={$tStore("settings.chat.reasoning.toolbarTooltip")}
				onclick={(e) => onToggleReasoningPopup?.(e)}
				type="button"
			>
				<span class="lumina-chat__reasoning-icon" use:icon={"brain"}></span>
				<span>{reasoningBadgeLabel}</span>
			</button>
		{/if}
	</div>

	<input
		type="file"
		multiple
		accept={FILE_INPUT_ACCEPT}
		class="lumina-chat__hidden-file-input"
		bind:this={fileInputEl}
		onchange={onFileSelect}
	/>

	<div class="lumina-chat__toolbar-right">
		{#if estimatedTokensDisplayText || estimatedInputTokens > 0}
			{@const estTooltip = isTokenOverLimit
				? ($tStore("chat.tokenOverLimitTooltip") || "Context exceeds 100k tokens (capped estimate)")
				: ($tStore("chat.estimatedTokensTooltip") || "Estimated input tokens for this prompt (approx.)")}
			<span
				class="lumina-chat__token-stats"
				aria-label={estTooltip}
				title={estTooltip}
			>
				{estimatedTokensDisplayText || `~${estimatedInputTokens.toLocaleString()} tokens`}{#if splitModelCount > 1}&nbsp;{$tStore("splitChat.modelsCountSuffix", { count: splitModelCount })}{/if}
			</span>
		{/if}
		{#if sessionTokenStats.totalTokens > 0}
			<span
				class="lumina-chat__token-stats"
				aria-label={sessionUsageTooltip}
				title={sessionUsageTooltip}
			>
				{$tStore("chat.sessionTokens", {
					tokens: sessionTokenStats.totalTokens.toLocaleString(),
				})}{#if cacheReuseInfo}&nbsp;·&nbsp;<span class="lumina-chat__token-cache-badge">{$tStore("chat.cacheReusedBadge", { percent: cacheReuseInfo.percent })}</span>{/if}
			</span>
		{/if}
		<span class="lumina-chat__hint-inline">{sendHint}</span>
		{#if (agentEnabled || isCliSelected) && !hideAgentControls}
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
			class:is-active={includeActiveNote && activeNoteStatus.status === "ready"}
			class:is-unavailable={includeActiveNote && activeNoteStatus.status !== "ready"}
			aria-label={activeNoteTooltip}
			title={activeNoteTooltip}
			onclick={onToggleActiveNote}
			type="button"
		>
			<span use:icon={activeNoteIcon}></span>
			<span class="lumina-chat__context-badge-label">{activeNoteLabel}</span>
		</button>
	</div>
</div>
