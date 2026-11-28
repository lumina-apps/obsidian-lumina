<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte";
	import { MarkdownView, setIcon, TFile } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import type { Readable } from "svelte/store";
	import type { TranslationKeys } from "../../../shared/locales/locale.types";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import type { ReasoningEffort } from "../../../shared/types/llm.types";
	import type { LLMProviderConfig, FavoriteModel, QuickAction, ProviderType } from "../../../shared/types/settings.types";
	import ContextSelector from "./ContextSelector.svelte";
	import SlashCommandSelector from "./SlashCommandSelector.svelte";
	import McpQuickPopup from "./McpQuickPopup.svelte";
	import ReasoningQuickPopup from "./ReasoningQuickPopup.svelte";
	import ModelPickerPopup from "./ModelPickerPopup.svelte";
	import PromptPickerPopup from "./PromptPickerPopup.svelte";
	import ChatInputToolbar from "./ChatInputToolbar.svelte";
	import {
		getModelReasoningSupport,
		isAnyModelReasoningSupported,
	} from "../../../core/llm-providers/reasoning-config";
	import { getAttachmentIcon, IMAGE_EXTS } from "../utils/fileAttachmentUtils";
	import { resizeTextarea } from "../../../shared/utils/textareaUtils";
	import { buildSlashCommands } from "../utils/slashCommandUtils";
	import { buildCustomPromptCommands } from "../utils/customSlashCommandUtils";
	import { activeProject } from "../../../core/store/projectStore";
	import { settingsStore } from "../../../core/store/settingsStore";
	import { estimateInputTokensDetails, calculateFolderSize } from "../utils/inputUtils";
	import { resolveActiveSystemPrompt } from "../promptBuilder";
	import {
		createKeydownHandler,
		createInputHandler,
		createContextMentionInserter,
		createContextSelectHandler,
		createSlashSelectHandler,
		createPromptTemplateInserter,
	} from "./composables/useInputHandler";
	import {
		createFileSelectHandler,
		createDropHandler,
		createDragOverHandler,
		createPasteHandler,
		createRemoveAttachment,
	} from "./composables/useFileAttachment";
	import { handleMcpPopupToggle } from "./composables/useInputPopups";
	import {
		setupMobileKeyboardViewport,
		type MobileKeyboardViewportController,
	} from "./composables/useMobileKeyboardViewport";
	import { openAttachment } from "./utils/messageActions";
	import { useActiveFileTracker, type ActiveFileInfo } from "./composables/useActiveFileTracker";
	import { isExcluded, isIncluded } from "../../../shared/utils/exclusions";
	import { extractFileName } from "../../../shared/utils/fileUtils";

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
		hideAgentControls = false,
		splitModelCount = 1,
		customPlaceholder = "",
		providers = [],
		favoriteModels = [],
		selectedProviderId = "",
		selectedModelId = "",
		reasoningTargetModels,
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
		onOpenSplitChat,
		onKeyboardOpen,
	} = $props<{
		plugin: LuminaPlugin;
		isLoading: boolean;
		hasProvider: boolean;
		sendHint: string;
		sessionTokenStats: {
			totalTokens: number;
			inputTokens?: number;
			outputTokens?: number;
			cacheReadTokens?: number;
			cacheCreationTokens?: number;
		};
		includeActiveNote: boolean;
		agentEnabled: boolean;
		agentExecutionMode: "read" | "edit";
		isCliSelected?: boolean;
		hideAgentControls?: boolean;
		splitModelCount?: number;
		customPlaceholder?: string;
		providers: LLMProviderConfig[];
		favoriteModels?: FavoriteModel[];
		selectedProviderId: string;
		selectedModelId: string;
		reasoningTargetModels?: Array<{ providerType?: ProviderType; modelId?: string }>;
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
		onOpenSplitChat?: () => void;
		onKeyboardOpen?: () => void;
	}>();

	let inputAreaEl: HTMLElement | null = $state(null);
	let keyboardViewportCtrl: MobileKeyboardViewportController | null = null;

	onMount(() => {
		keyboardViewportCtrl = setupMobileKeyboardViewport({
			getContainerEl: () => inputAreaEl,
			getInputEl: () => textareaEl,
			onKeyboardOpen: () => {
				onKeyboardOpen?.();
			},
		});
	});

	onDestroy(() => {
		keyboardViewportCtrl?.destroy();
		keyboardViewportCtrl = null;
	});

	// ── UI state (팝업 표시 여부 및 검색 쿼리) ───────────────────────────────
	let showContextSelector = $state(false);
	let contextSearchQuery = $state("");
	let mentionStartIndex = $state(-1);

	let showSlashSelector = $state(false);
	let slashSearchQuery = $state("");
	let slashStartIndex = $state(-1);

	let showMcpPopup = $state(false);
	let showReasoningPopup = $state(false);
	let showModelPicker = $state(false);
	let showPromptPicker = $state(false);

	// ── 시스템 프롬프트 파생 값 ──────────────────────────────────────────────
	const systemPrompts = $derived($settingsStore?.chat.systemPrompts ?? []);
	const activeSystemPrompt = $derived(
		resolveActiveSystemPrompt(systemPrompts, $activeProject?.systemPromptId)
	);
	const activePromptId = $derived(activeSystemPrompt?.id ?? "");

	// ── 활성 파일 추적 (실시간 토큰 계산용 Composable) ───────────────────────
	const activeTracker = useActiveFileTracker(
		() => plugin,
		(info) => {
			activeFileInfo = info;
		},
	);
	let activeFileInfo = $state<ActiveFileInfo | null>(activeTracker.getInitialActiveFile());

	// ── 현재 노트 포함 상태 (UI 표시용) ──────────────────────────────────────
	const activeNoteStatus = $derived.by((): {
		status: "ready" | "none" | "excluded";
		name: string;
		path: string;
	} => {
		if (!activeFileInfo) {
			return { status: "none", name: "", path: "" };
		}
		const project = $activeProject;
		const allowed =
			isIncluded(activeFileInfo.path, project?.ragIncludedPaths ?? []) &&
			!isExcluded(activeFileInfo.path, project?.ragExcludedPaths ?? []);
		const name = extractFileName(activeFileInfo.path) || activeFileInfo.path;
		if (!allowed) {
			return { status: "excluded", name, path: activeFileInfo.path };
		}
		return { status: "ready", name, path: activeFileInfo.path };
	});

	// ── 실시간 입력 예상 토큰 계산 ────────────────────────────────────────────
	const selectedProviderType = $derived(
		providers.find((p: LLMProviderConfig) => p.id === selectedProviderId)?.type,
	);

	// ── 추론/사고 제어 표시 여부 및 상태 ──────────────────────────────────────
	const singleModelReasoningSupport = $derived(
		getModelReasoningSupport(selectedProviderType, selectedModelId),
	);
	const showReasoningControl = $derived(
		reasoningTargetModels !== undefined
			? isAnyModelReasoningSupported(reasoningTargetModels)
			: singleModelReasoningSupport.supported,
	);
	const reasoningEffort = $derived<ReasoningEffort>(
		$settingsStore?.chat.reasoningEffort ?? plugin.settings.chat.reasoningEffort ?? "auto",
	);
	const reasoningBudgetTokens = $derived(
		$settingsStore?.chat.reasoningBudgetTokens ?? plugin.settings.chat.reasoningBudgetTokens ?? 0,
	);
	const reasoningSupportsCustomBudget = $derived(
		reasoningTargetModels !== undefined
			? reasoningTargetModels.some((m) => getModelReasoningSupport(m.providerType, m.modelId).supportsCustomBudget)
			: singleModelReasoningSupport.supportsCustomBudget,
	);

	$effect(() => {
		if (!showReasoningControl && showReasoningPopup) {
			showReasoningPopup = false;
		}
	});

	const tokenEstimation = $derived.by(() => {
		return estimateInputTokensDetails({
			inputText,
			attachments,
			includeActiveNote: includeActiveNote && activeNoteStatus.status === "ready",
			activeFileInfo,
			systemPrompt: activeSystemPrompt?.content,
			providerType: selectedProviderType,
			getFileSize: (path) => {
				const file = plugin.app.vault.getAbstractFileByPath(path);
				return file && "stat" in file && typeof file.stat.size === "number"
					? file.stat.size
					: undefined;
			},
			getFolderSize: (path, maxBytes) => {
				return calculateFolderSize(
					plugin.app,
					path,
					maxBytes,
					15,
					$activeProject?.ragExcludedPaths,
				);
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

	// ── 파일 첨부 처리 상태 ──────────────────────────────────────────────
	let isAttaching = $state(false);

	// ── 슬래시 명령어 가로채기 및 전송 핸들러 ─────────────────────────────
	function handleSendMessage() {
		if (isAttaching) return;
		const text = inputText.trim();
		if (text.startsWith("/") && attachments.length === 0) {
			const cmdId = text.slice(1).trim().toLowerCase();
			const matched = allSlashCommands.find((c) => c.id.toLowerCase() === cmdId);
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

	const insertPromptTemplate = createPromptTemplateInserter({
		getTextareaEl: () => textareaEl,
		getInputText: () => inputText,
		setInputText: (v) => {
			inputText = v;
		},
	});

	/**
	 * 채팅창으로 포커스가 이동한 상태에서도 활성 마크다운 에디터의 선택 영역을 조회합니다.
	 */
	function getActiveEditorSelection(): string | undefined {
		const activeEditor = plugin.app.workspace.activeEditor?.editor;
		const activeSel = activeEditor?.getSelection();
		if (activeSel && activeSel.trim().length > 0) return activeSel;

		const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const viewSel = activeView?.editor?.getSelection();
		if (viewSel && viewSel.trim().length > 0) return viewSel;

		const leaves = plugin.app.workspace.getLeavesOfType("markdown");
		const activeFilePath = plugin.app.workspace.getActiveFile()?.path;
		const orderedLeaves = activeFilePath
			? [...leaves].sort((a, b) => {
					const aMatch = (a.view as MarkdownView)?.file?.path === activeFilePath ? 0 : 1;
					const bMatch = (b.view as MarkdownView)?.file?.path === activeFilePath ? 0 : 1;
					return aMatch - bMatch;
				})
			: leaves;

		for (const leaf of orderedLeaves) {
			const mdView = leaf.view as MarkdownView;
			const sel = mdView?.editor?.getSelection?.();
			if (sel && sel.trim().length > 0) {
				return sel;
			}
		}
		return undefined;
	}

	/**
	 * 커스텀 프롬프트(퀵 액션) 선택 시 입력창에 프롬프트를 삽입하고,
	 * 활성 에디터에 선택 영역이 있으면 selection 첨부 칩을 자동으로 추가합니다.
	 */
	function handleCustomPromptInsert(action: QuickAction): void {
		insertPromptTemplate(action.prompt);

		if (attachments.some((a) => a.type === "selection")) {
			return;
		}
		const sel = getActiveEditorSelection();
		if (sel) {
			attachments = [
				...attachments,
				{
					type: "selection",
					path: "selection",
					name: tProxy("settings.chat.context.selectedText", { length: sel.length }),
					content: sel,
				},
			];
		}
	}

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
		setIsProcessing: (v: boolean) => {
			isAttaching = v;
		},
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

	function handleAttachmentClick(att: ContextAttachment, e: MouseEvent | KeyboardEvent) {
		openAttachment(plugin.app, att, e);
	}

	function getImageSrc(att: ContextAttachment): string | null {
		if (att.content?.startsWith("data:image/")) {
			return att.content;
		}
		if (att.path) {
			const ext = att.path.split(".").pop()?.toLowerCase() ?? "";
			if (IMAGE_EXTS.has(ext)) {
				const file = plugin?.app?.vault?.getAbstractFileByPath(att.path);
				if (file instanceof TFile) {
					return plugin.app.vault.getResourcePath(file);
				}
			}
		}
		return null;
	}

	// ── 슬래시 명령어 빌드 ─────────────────────────────────────────────────
	const SPLIT_EXCLUDED_SLASH_IDS = new Set([
		"mode",
		"mcp",
		"compress",
		"model",
		"regenerate",
		"arena",
		"websearch",
	]);

	const slashCommands = $derived.by(() => {
		const all = buildSlashCommands(
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
			onOpenSplitChat,
		);
		if (!hideAgentControls) return all;
		return all.filter((cmd) => !SPLIT_EXCLUDED_SLASH_IDS.has(cmd.id));
	});

	const quickActions = $derived($settingsStore?.chat.quickActions ?? []);
	const customSlashCommands = $derived(
		buildCustomPromptCommands(quickActions, (action) => handleCustomPromptInsert(action)),
	);
	const allSlashCommands = $derived([...slashCommands, ...customSlashCommands]);

	// ── MCP / Reasoning 팝업 토글 (상호 배타) ───────────────────────────────
	const toggleMcpPopup = handleMcpPopupToggle((v) => {
		const next = typeof v === "function" ? v(showMcpPopup) : v;
		if (next) showReasoningPopup = false;
		showMcpPopup = next;
	});

	function toggleReasoningPopup(e: MouseEvent): void {
		e.stopPropagation();
		if (!showReasoningPopup) {
			showMcpPopup = false;
		}
		showReasoningPopup = !showReasoningPopup;
	}

	async function handleSelectReasoningEffort(effort: ReasoningEffort): Promise<void> {
		plugin.settings.chat.reasoningEffort = effort;
		await plugin.saveSettings();
		showReasoningPopup = false;
		textareaEl?.focus();
	}

	// ── 드래그 앤 드롭 상태 ───────────────────────────────────────────────
	let isDragOver = $state(false);
	let dragCounter = 0;

	function handleDragEnter(e: DragEvent) {
		e.preventDefault();
		dragCounter++;
		isDragOver = true;
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		dragCounter--;
		if (dragCounter <= 0) {
			dragCounter = 0;
			isDragOver = false;
		}
	}

	function handleAreaDrop(e: DragEvent) {
		dragCounter = 0;
		isDragOver = false;
		handleDrop(e);
	}

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
	bind:this={inputAreaEl}
	class="lumina-chat__input-area"
	class:is-dragover={isDragOver}
	ondrop={handleAreaDrop}
	ondragover={handleDragOver}
	ondragenter={handleDragEnter}
	ondragleave={handleDragLeave}
	onpaste={handlePaste}
>
	<ChatInputToolbar
		{isCliSelected}
		{hideAgentControls}
		{splitModelCount}
		{agentEnabled}
		{agentExecutionMode}
		{includeActiveNote}
		{activeNoteStatus}
		{sendHint}
		estimatedInputTokens={tokenEstimation.tokens}
		estimatedTokensDisplayText={tokenEstimation.displayText}
		isTokenOverLimit={tokenEstimation.isOverLimit}
		{sessionTokenStats}
		{tStore}
		{showReasoningControl}
		{reasoningEffort}
		{reasoningBudgetTokens}
		{reasoningSupportsCustomBudget}
		isReasoningPopupOpen={showReasoningPopup}
		onInsertContextMention={insertContextMention}
		onFileSelect={handleFileSelect}
		onToggleMcpPopup={toggleMcpPopup}
		onToggleReasoningPopup={toggleReasoningPopup}
		onToggleAgentExecutionMode={onToggleAgentExecutionMode}
		onToggleActiveNote={onToggleActiveNote}
	/>

	<div class="lumina-chat__textarea-wrap">
		<div class="lumina-chat__input-container">
			{#if attachments.length > 0 || isAttaching}
				<div class="lumina-chat__attachments">
					{#each attachments as att, i}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							class="lumina-chat__attachment-chip"
							role="button"
							tabindex="0"
							title={att.path || att.name}
							onclick={(e) => handleAttachmentClick(att, e)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									handleAttachmentClick(att, e);
								}
							}}
						>
							{#if getImageSrc(att)}
								<img
									src={getImageSrc(att)}
									alt={att.name}
									class="lumina-chat__attachment-thumb"
								/>
							{:else}
								<span
									class="lumina-chat__attachment-icon"
									use:icon={getAttachmentIcon(att.type)}
								></span>
							{/if}
							<span class="lumina-chat__attachment-name">{att.name}</span>
							<button
								class="lumina-chat__attachment-remove"
								onclick={(e) => {
									e.stopPropagation();
									removeAttachment(i);
								}}
								aria-label="Remove"
								type="button"
							>
								<span use:icon={"x"}></span>
							</button>
						</div>
					{/each}
					{#if isAttaching}
						<div class="lumina-chat__attachment-chip lumina-chat__attachment-chip--loading">
							<span
								class="lumina-chat__attachment-icon"
								use:icon={"loader"}
							></span>
							<span class="lumina-chat__attachment-name">{$tStore("uiMessages.attachProcessing")}</span>
						</div>
					{/if}
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
					commands={allSlashCommands}
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

			{#if showReasoningPopup && showReasoningControl}
				<ReasoningQuickPopup
					{tStore}
					currentEffort={reasoningEffort}
					budgetTokens={reasoningBudgetTokens}
					providerType={selectedProviderType}
					modelId={selectedModelId}
					isSplitMode={reasoningTargetModels !== undefined}
					onSelect={(effort) => void handleSelectReasoningEffort(effort)}
					onClose={(focusTextarea) => {
						showReasoningPopup = false;
						if (focusTextarea) textareaEl?.focus();
					}}
					onOpenSettings={() => {
						showReasoningPopup = false;
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
						? (customPlaceholder || $tStore("errors.chatPlaceholder"))
						: $tStore("errors.llmConnectRequired")}
					disabled={!hasProvider}
					rows="1"
					onkeydown={handleKeydown}
					oninput={handleInput}
					onpaste={handlePaste}
					ondrop={handleAreaDrop}
					ondragover={handleDragOver}
					onfocus={() => {
						activeTracker.updateActiveFile();
						keyboardViewportCtrl?.update();
					}}
					onblur={() => {
						keyboardViewportCtrl?.update();
					}}
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
						class:is-active={(inputText.trim().length > 0 ||
							attachments.length > 0) && !isAttaching}
						onclick={handleSendMessage}
						disabled={(!inputText.trim() && attachments.length === 0) ||
							!hasProvider || isAttaching}
						aria-label={$tStore("errors.send")}
						use:icon={"lumina-send"}
					></button>
				{/if}
			</div>
		</div>
	</div>
</div>
