<script lang="ts">
	import { tick } from "svelte";
	import { setIcon } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import type { Readable } from "svelte/store";
	import type { TranslationKeys } from "../../../shared/locales/locale.types";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import ContextSelector from "./ContextSelector.svelte";
	import SlashCommandSelector from "./SlashCommandSelector.svelte";
	import McpQuickPopup from "./McpQuickPopup.svelte";
	import { getAttachmentIcon } from "../utils/fileAttachmentUtils";
	import { resizeTextarea } from "../utils/textareaUtils";
	import { buildSlashCommands } from "../utils/slashCommandUtils";
	import {
		createKeydownHandler,
		createInputHandler,
		createContextMentionInserter,
		createContextSelectHandler,
		createSlashSelectHandler,
	} from "./composables/useInputHandler";
	import {
		createFileInputTrigger,
		createFileSelectHandler,
		createDropHandler,
		createDragOverHandler,
		createPasteHandler,
		createRemoveAttachment,
	} from "./composables/useFileAttachment";
	import { handleMcpPopupToggle } from "./composables/useInputPopups";

	type TStore = Readable<
		(key: TranslationKeys, params?: Record<string, string | number>) => string
	>;

	let {
		plugin,
		isLoading,
		hasProvider,
		sendHint,
		sessionTokenStats,
		includeActiveNote,
		agentEnabled = false,
		agentExecutionMode = "read",
		tStore,
		inputText = $bindable(""),
		attachments = $bindable<ContextAttachment[]>([]),
		textareaEl = $bindable<HTMLTextAreaElement | null>(null),
		onToggleActiveNote,
		onToggleAgentExecutionMode,
		onSendMessage,
		onCancelStream,
		onClearChat,
		onToggleRagMode,
		onOpenSettings,
	} = $props<{
		plugin: LuminaPlugin;
		isLoading: boolean;
		hasProvider: boolean;
		sendHint: string;
		sessionTokenStats: { totalTokens: number; estimatedCost: number };
		includeActiveNote: boolean;
		agentEnabled: boolean;
		agentExecutionMode: "read" | "edit";
		tStore: TStore;
		inputText: string;
		attachments: ContextAttachment[];
		textareaEl: HTMLTextAreaElement | null;
		onToggleActiveNote: () => void;
		onToggleAgentExecutionMode: () => void;
		onSendMessage: () => void;
		onCancelStream: () => void;
		onClearChat: () => void;
		onToggleRagMode: () => void;
		onOpenSettings: () => void;
	}>();

	// ── UI state (컴포넌트 내에 유지) ──────────────────────────────────────
	let showContextSelector = $state(false);
	let contextSearchQuery = $state("");
	let mentionStartIndex = $state(-1);

	let showSlashSelector = $state(false);
	let slashSearchQuery = $state("");
	let slashStartIndex = $state(-1);

	let showMcpPopup = $state(false);
	let fileInputEl: HTMLInputElement | null = $state(null);

	// ── 공통 리사이즈 래퍼 ─────────────────────────────────────────────────
	function onResize() {
		resizeTextarea(textareaEl);
	}

	// ── 입력 핸들러들 (composable) ─────────────────────────────────────────
	const handleKeydown = createKeydownHandler({
		get plugin() {
			return plugin;
		},
		get showSlashSelector() {
			return showSlashSelector;
		},
		get showContextSelector() {
			return showContextSelector;
		},
		get onSendMessage() {
			return onSendMessage;
		},
	});

	const handleInput = createInputHandler({
		getTextareaEl: () => textareaEl,
		setShowContextSelector: (v) => {
			showContextSelector = v;
		},
		setContextSearchQuery: (v) => {
			contextSearchQuery = v;
		},
		setMentionStartIndex: (v) => {
			mentionStartIndex = v;
		},
		setShowSlashSelector: (v) => {
			showSlashSelector = v;
		},
		setSlashSearchQuery: (v) => {
			slashSearchQuery = v;
		},
		setSlashStartIndex: (v) => {
			slashStartIndex = v;
		},
	});

	const insertContextMention = createContextMentionInserter({
		getTextareaEl: () => textareaEl,
		getInputText: () => inputText,
		setInputText: (v) => {
			inputText = v;
		},
		afterInsert: handleInput,
	});

	const handleContextSelect = createContextSelectHandler({
		get attachments() {
			return attachments;
		},
		setAttachments: (a) => {
			attachments = a;
		},
		get mentionStartIndex() {
			return mentionStartIndex;
		},
		getTextareaEl: () => textareaEl,
		getInputText: () => inputText,
		setInputText: (v) => {
			inputText = v;
		},
		afterSelect: () => {
			showContextSelector = false;
			mentionStartIndex = -1;
		},
	});

	const handleSlashCommandSelect = createSlashSelectHandler({
		get slashStartIndex() {
			return slashStartIndex;
		},
		getTextareaEl: () => textareaEl,
		getInputText: () => inputText,
		setInputText: (v) => {
			inputText = v;
		},
		afterSelect: () => {
			showSlashSelector = false;
			slashStartIndex = -1;
		},
	});

	// ── 파일 첨부 핸들러들 (composable) ────────────────────────────────────
	const tProxy = (key: string, vars?: Record<string, string | number>) => {
		let text = $tStore(key);
		if (vars) {
			for (const [k, v] of Object.entries(vars)) {
				text = text.replace(`{{${k}}}`, v);
			}
		}
		return text;
	};

	const fileCtx = {
		get plugin() {
			return plugin;
		},
		get attachments() {
			return attachments;
		},
		setAttachments: (a: ContextAttachment[]) => {
			attachments = a;
		},
		t: tProxy,
		onResizeTextarea: onResize,
	};

	const triggerFileInput = createFileInputTrigger(() => fileInputEl);
	const handleFileSelect = createFileSelectHandler(fileCtx);
	const handleDrop = createDropHandler(fileCtx);
	const handleDragOver = createDragOverHandler();
	const handlePaste = createPasteHandler(fileCtx);
	/** createRemoveAttachment는 attachments를 클로저로 참조하므로,
	 *  $derived로 attachments 변경 시 재생성한다. */
	const removeAttachmentFn = $derived(
		createRemoveAttachment(attachments, (a: ContextAttachment[]) => {
			attachments = a;
		}),
	);
	function removeAttachment(index: number) {
		removeAttachmentFn(index);
	}

	// ── 슬래시 명령어 빌드 ─────────────────────────────────────────────────
	const slashCommands = $derived(
		buildSlashCommands(
			plugin,
			tProxy,
			onClearChat,
			onToggleRagMode,
			onOpenSettings,
			(v) => {
				showMcpPopup = v;
			},
		),
	);

	// ── MCP 팝업 토글 ──────────────────────────────────────────────────────
	const toggleMcpPopup = handleMcpPopupToggle((v) => {
		if (typeof v === "function") {
			showMcpPopup = v(showMcpPopup);
		} else {
			showMcpPopup = v;
		}
	});

	// ── Obsidian 아이콘 액션 ──────────────────────────────────────────────
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="lumina-chat__input-area"
	ondrop={handleDrop}
	ondragover={handleDragOver}
>
	<div class="lumina-chat__input-toolbar">
		<div class="lumina-chat__toolbar-group">
			<button
				class="lumina-chat__toolbar-btn"
				aria-label={$tStore("chat.addContext")}
				use:icon={"lumina-at-sign"}
				onclick={insertContextMention}
				type="button">Add Context</button
			>
			<button
				class="lumina-chat__toolbar-btn"
				aria-label={$tStore("chat.uploadFile")}
				use:icon={"paperclip"}
				onclick={triggerFileInput}
				type="button"
			></button>
			<button
				class="lumina-chat__toolbar-btn"
				class:is-agent-active={agentEnabled}
				aria-label="Agent & MCP Tools"
				use:icon={"bot"}
				onclick={toggleMcpPopup}
				type="button"
			></button>
		</div>

		<input
			type="file"
			multiple
			class="lumina-chat__hidden-file-input"
			bind:this={fileInputEl}
			onchange={handleFileSelect}
		/>

		<div class="lumina-chat__toolbar-right">
			{#if sessionTokenStats.totalTokens > 0}
				<span
					class="lumina-chat__token-stats"
					title={$tStore("chat.sessionUsage")}
				>
					{$tStore("chat.sessionTokens", {
						tokens: sessionTokenStats.totalTokens.toLocaleString(),
					})}
					{#if sessionTokenStats.estimatedCost > 0}
						{$tStore("chat.sessionCost", {
							cost: sessionTokenStats.estimatedCost.toFixed(4),
						})}
					{/if}
				</span>
			{/if}
			<span class="lumina-chat__hint-inline">{sendHint}</span>
			{#if agentEnabled}
				<button
					class="lumina-chat__context-badge"
					class:is-active={agentExecutionMode === "edit"}
					onclick={onToggleAgentExecutionMode}
					aria-label={$tStore("settings.mcp.agentMode.editMode") ||
						"Toggle Agent Mode (Read/Edit)"}
				>
					<span use:icon={agentExecutionMode === "edit" ? "edit-2" : "eye"}
					></span>
					<span
						>{agentExecutionMode === "edit"
							? $tStore("settings.mcp.agentMode.editMode") || "Edit Mode"
							: $tStore("settings.mcp.agentMode.readMode") || "Read Mode"}</span
					>
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

	<div class="lumina-chat__textarea-wrap">
		<div class="lumina-chat__input-container">
			{#if attachments.length > 0}
				<div class="lumina-chat__attachments">
					{#each attachments as att, i}
						<div class="lumina-chat__attachment-chip">
							<span
								class="lumina-chat__attachment-icon"
								use:icon={getAttachmentIcon(att.type)}
							></span>
							<span class="lumina-chat__attachment-name">{att.name}</span>
							<button
								class="lumina-chat__attachment-remove"
								onclick={() => removeAttachment(i)}
								aria-label="Remove"
								type="button"
							>
								<span use:icon={"x"}></span>
							</button>
						</div>
					{/each}
				</div>
			{/if}

			{#if showContextSelector}
				<ContextSelector
					{plugin}
					searchQuery={contextSearchQuery}
					onSelect={handleContextSelect}
					onClose={(focusTextarea) => {
						showContextSelector = false;
						if (focusTextarea) textareaEl?.focus();
					}}
				/>
			{/if}

			{#if showSlashSelector}
				<SlashCommandSelector
					commands={slashCommands}
					searchQuery={slashSearchQuery}
					onSelect={handleSlashCommandSelect}
					onClose={(focusTextarea) => {
						showSlashSelector = false;
						if (focusTextarea) textareaEl?.focus();
					}}
				/>
			{/if}

			{#if showMcpPopup}
				<McpQuickPopup
					{plugin}
					onClose={(focusTextarea) => {
						showMcpPopup = false;
						if (focusTextarea) textareaEl?.focus();
					}}
					onOpenSettings={() => {
						showMcpPopup = false;
						onOpenSettings();
					}}
				/>
			{/if}

			<div class="lumina-chat__input-row">
				<textarea
					bind:this={textareaEl}
					bind:value={inputText}
					class="lumina-chat__textarea"
					placeholder={hasProvider
						? $tStore("errors.chatPlaceholder")
						: $tStore("errors.llmConnectRequired")}
					disabled={!hasProvider || isLoading}
					rows="1"
					onkeydown={handleKeydown}
					oninput={handleInput}
					onpaste={handlePaste}
				></textarea>

				{#if inputText.length > 0 && !isLoading}
					<button
						class="lumina-chat__clear-btn"
						aria-label={$tStore("chat.clearInput")}
						onclick={() => {
							inputText = "";
							tick().then(() => {
								onResize();
								textareaEl?.focus();
							});
						}}
						type="button"
						use:icon={"x"}
					></button>
				{/if}

				{#if isLoading}
					<button
						class="lumina-chat__send-btn lumina-chat__send-btn--cancel"
						onclick={onCancelStream}
						aria-label={$tStore("errors.cancelStreaming")}
						use:icon={"lumina-square"}
					></button>
				{:else}
					<button
						class="lumina-chat__send-btn"
						class:is-active={inputText.trim().length > 0 ||
							attachments.length > 0}
						onclick={onSendMessage}
						disabled={(!inputText.trim() && attachments.length === 0) ||
							!hasProvider}
						aria-label={$tStore("errors.send")}
						use:icon={"lumina-send"}
					></button>
				{/if}
			</div>
		</div>
	</div>
</div>
