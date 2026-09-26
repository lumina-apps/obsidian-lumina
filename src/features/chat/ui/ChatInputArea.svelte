<script lang="ts">
	import { tick } from "svelte";
	import { setIcon } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import type { Readable } from "svelte/store";
	import type { TranslationKeys } from "../../../shared/locales/locale.types";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import type { LLMProviderConfig, FavoriteModel } from "../../../shared/types/settings.types";
	import ContextSelector from "./ContextSelector.svelte";
	import SlashCommandSelector from "./SlashCommandSelector.svelte";
	import McpQuickPopup from "./McpQuickPopup.svelte";
	import ModelPickerPopup from "./ModelPickerPopup.svelte";
	import PromptPickerPopup from "./PromptPickerPopup.svelte";
	import ChatInputToolbar from "./ChatInputToolbar.svelte";
	import { getAttachmentIcon } from "../utils/fileAttachmentUtils";
	import { resizeTextarea } from "../../../shared/utils/textareaUtils";
	import { buildSlashCommands } from "../utils/slashCommandUtils";
	import { activeProject } from "../../../core/store/projectStore";
	import { settingsStore } from "../../../core/store/settingsStore";
	import { estimateInputTokensDetails, calculateFolderSize } from "../utils/inputUtils";
	import {
		createKeydownHandler,
		createInputHandler,
		createContextMentionInserter,
		createContextSelectHandler,
		createSlashSelectHandler,
	} from "./composables/useInputHandler";
	import {
		createFileSelectHandler,
		createDropHandler,
		createDragOverHandler,
		createPasteHandler,
		createRemoveAttachment,
	} from "./composables/useFileAttachment";
	import { handleMcpPopupToggle } from "./composables/useInputPopups";
	import { useActiveFileTracker, type ActiveFileInfo } from "./composables/useActiveFileTracker";

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
		isCliSelected = false,
		providers = [],
		favoriteModels = [],
		selectedProviderId = "",
		selectedModelId = "",
		tStore,
		inputText = $bindable(""),
		attachments = $bindable<ContextAttachment[]>([]),
		textareaEl = $bindable<HTMLTextAreaElement | null>(null),
		onToggleActiveNote,
		onToggleAgentExecutionMode,
		onSelectModel,
		onToggleFavorite,
		onSendMessage,
		onCancelStream,
		onClearChat,
		onToggleRagMode,
		onOpenSettings,
		onToggleWebSearch,
		onExportChat,
		onRegenerateLast,
		onCompressContext,
	} = $props<{
		plugin: LuminaPlugin;
		isLoading: boolean;
		hasProvider: boolean;
		sendHint: string;
		sessionTokenStats: { totalTokens: number };
		includeActiveNote: boolean;
		agentEnabled: boolean;
		agentExecutionMode: "read" | "edit";
		isCliSelected?: boolean;
		providers: LLMProviderConfig[];
		favoriteModels?: FavoriteModel[];
		selectedProviderId: string;
		selectedModelId: string;
		tStore: TStore;
		inputText: string;
		attachments: ContextAttachment[];
		textareaEl: HTMLTextAreaElement | null;
		onToggleActiveNote: () => void;
		onToggleAgentExecutionMode: () => void;
		onSelectModel: (providerId: string, modelId: string) => void;
		onToggleFavorite?: (providerId: string, modelId: string) => void;
		onSendMessage: () => void;
		onCancelStream: () => void;
		onClearChat: () => void;
		onToggleRagMode: () => void;
		onOpenSettings: () => void;
		onToggleWebSearch: () => void;
		onExportChat: () => void;
		onRegenerateLast: () => void;
		onCompressContext: () => void;
	}>();

	// ── UI state (팝업 표시 여부 및 검색 쿼리) ───────────────────────────────
	let showContextSelector = $state(false);
	let contextSearchQuery = $state("");
	let mentionStartIndex = $state(-1);

	let showSlashSelector = $state(false);
	let slashSearchQuery = $state("");
	let slashStartIndex = $state(-1);

	let showMcpPopup = $state(false);
	let showModelPicker = $state(false);
	let showPromptPicker = $state(false);

	// ── 시스템 프롬프트 파생 값 ──────────────────────────────────────────────
	const systemPrompts = $derived($settingsStore?.chat.systemPrompts ?? []);
	const activePromptId = $derived($activeProject?.systemPromptId || "default");

	// ── 활성 파일 추적 (실시간 토큰 계산용 Composable) ───────────────────────
	const activeTracker = useActiveFileTracker(
		() => plugin,
		(info) => {
			activeFileInfo = info;
		},
	);
	let activeFileInfo = $state<ActiveFileInfo | null>(activeTracker.getInitialActiveFile());

	// ── 실시간 입력 예상 토큰 계산 ────────────────────────────────────────────
	// ── 실시간 입력 예상 토큰 계산 ────────────────────────────────────────────
	const tokenEstimation = $derived.by(() => {
		return estimateInputTokensDetails({
			inputText,
			attachments,
			includeActiveNote,
			activeFileInfo,
			getFileSize: (path) => {
				const file = plugin.app.vault.getAbstractFileByPath(path);
				return file && "stat" in file && typeof file.stat.size === "number"
					? file.stat.size
					: undefined;
			},
			getFolderSize: (path, maxBytes) => {
				return calculateFolderSize(plugin.app, path, maxBytes);
			},
		});
	});

	async function handlePromptSelect(promptId: string): Promise<void> {
		const project = $activeProject;
		if (!project) return;
		const pIndex = plugin.settings.projects.list.findIndex((p) => p.id === project.id);
		if (pIndex !== -1) {
			plugin.settings.projects.list[pIndex].systemPromptId = promptId;
			await plugin.saveSettings();
		}
	}

	// ── 공통 리사이즈 래퍼 ─────────────────────────────────────────────────
	function onResize() {
		resizeTextarea(textareaEl);
	}

	// ── 슬래시 명령어 가로채기 및 전송 핸들러 ─────────────────────────────
	function handleSendMessage() {
		const text = inputText.trim();
		if (text.startsWith("/") && attachments.length === 0) {
			const cmdId = text.slice(1).trim().toLowerCase();
			const matched = slashCommands.find((c) => c.id.toLowerCase() === cmdId);
			if (matched) {
				inputText = "";
				tick().then(() => {
					onResize();
					textareaEl?.focus();
				});
				matched.action();
				return;
			}
		}
		onSendMessage();
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
		get isLoading() {
			return isLoading;
		},
		get onSendMessage() {
			return handleSendMessage;
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

	const handleFileSelect = createFileSelectHandler(fileCtx);
	const handleDrop = createDropHandler(fileCtx);
	const handleDragOver = createDragOverHandler();
	const handlePaste = createPasteHandler(fileCtx);

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
			(v) => {
				showModelPicker = v;
			},
			(v) => {
				showPromptPicker = v;
			},
			onToggleWebSearch,
			onExportChat,
			onRegenerateLast,
			onCompressContext,
			onToggleAgentExecutionMode,
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
	<ChatInputToolbar
		{isCliSelected}
		{agentEnabled}
		{agentExecutionMode}
		{includeActiveNote}
		{sendHint}
		estimatedInputTokens={tokenEstimation.tokens}
		estimatedTokensDisplayText={tokenEstimation.displayText}
		isTokenOverLimit={tokenEstimation.isOverLimit}
		{sessionTokenStats}
		{tStore}
		onInsertContextMention={insertContextMention}
		onFileSelect={handleFileSelect}
		onToggleMcpPopup={toggleMcpPopup}
		onToggleAgentExecutionMode={onToggleAgentExecutionMode}
		onToggleActiveNote={onToggleActiveNote}
	/>

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
					onFocusTextarea={() => textareaEl?.focus()}
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

			{#if showModelPicker}
				<ModelPickerPopup
					{providers}
					favoriteModels={favoriteModels.length > 0 ? favoriteModels : ($settingsStore?.connections.favoriteModels ?? [])}
					{selectedProviderId}
					{selectedModelId}
					onSelect={onSelectModel}
					{onToggleFavorite}
					onClose={(focusTextarea) => {
						showModelPicker = false;
						if (focusTextarea) textareaEl?.focus();
					}}
				/>
			{/if}

			{#if showPromptPicker}
				<PromptPickerPopup
					prompts={systemPrompts}
					{activePromptId}
					onSelect={(promptId) => void handlePromptSelect(promptId)}
					onClose={(focusTextarea) => {
						showPromptPicker = false;
						if (focusTextarea) textareaEl?.focus();
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
					disabled={!hasProvider}
					rows="1"
					onkeydown={handleKeydown}
					oninput={handleInput}
					onpaste={handlePaste}
					onfocus={() => activeTracker.updateActiveFile()}
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
						onclick={handleSendMessage}
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
