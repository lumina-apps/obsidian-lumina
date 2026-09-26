<script lang="ts">
	import { tick, onMount, onDestroy } from "svelte";
	import { Notice } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import { ChatController } from "../chatController";
	import ChatHistoryList from "./ChatHistoryList.svelte";
	import ChatHeader from "./ChatHeader.svelte";
	import ChatMessageList from "./ChatMessageList.svelte";
	import ChatInputArea from "./ChatInputArea.svelte";
	import InlineApprovalQueue from "./InlineApprovalQueue.svelte";

	import { approvalStore } from "../utils/approvalManager";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import { splitProviderModel } from "../utils/inputUtils";
	import { resizeTextarea } from "../../../shared/utils/textareaUtils";
	import { useAutoScroll } from "./utils/useAutoScroll.svelte.ts";
	import { openSettingsTab } from "../../../shared/utils/openSettingsTab";
	import { debugLogger } from "../../../shared/debugLogger";

	import {
		messages,
		isLoading,
		resetChat,
		pendingAttachments,
		activeCliExecution,
		sessionProviderId,
		sessionModelId,
	} from "../../../core/store/chatStore";
	import { get } from "svelte/store";
	import {
		indexingState,
		indexingProgress,
		estimatedTimeRemaining,
		showIndexingIndicator,
	} from "../../../core/store/ragStore";
	import {
		verifiedProviders,
		isRagEnabled,
		settingsStore,
		favoriteModels,
	} from "../../../core/store/settingsStore";
	import {
		projectList,
		activeProjectId,
		getActiveProject,
	} from "../../../core/store/projectStore";
	import { PROVIDER_LABELS, isCliProvider } from "../../../shared/types/settings.types";
	import { tStore } from "../../../shared/locales/index";
	import { executeProjectSwitch } from "./composables/useProjectSwitch";
	import { useChatActions } from "./composables/useChatActions";

	let { plugin }: { plugin: LuminaPlugin } = $props();

	// ── UI state ───────────────────────────────────────────────────────────
	let selectedProviderId = $state("");
	let selectedModelId = $state("");
	let showHistory = $state(false);
	let inputText = $state("");
	let attachments = $state<ContextAttachment[]>([]);
	let includeActiveNote = $state(false);
	let useRagContext = $state(false);
	let savedScrollTop = $state<number | null>(null);

	function openHistory(): void {
		if (messagesEl) {
			savedScrollTop = messagesEl.scrollTop;
		}
		showHistory = true;
	}

	function closeHistory(resetToBottom: boolean = false): void {
		showHistory = false;
		const targetScroll = resetToBottom || savedScrollTop === null || !autoScroll.isUserScrolledUp
			? "bottom"
			: savedScrollTop;

		tick().then(() => {
			if (messagesEl) {
				if (targetScroll === "bottom") {
					autoScroll.resetUserScrolledUp();
					messagesEl.scrollTop = messagesEl.scrollHeight;
				} else {
					messagesEl.scrollTop = targetScroll;
				}
			}
			setTimeout(() => {
				if (messagesEl) {
					if (targetScroll === "bottom") {
						messagesEl.scrollTop = messagesEl.scrollHeight;
					} else {
						messagesEl.scrollTop = targetScroll;
					}
				}
			}, 50);
		});
	}

	// ── Refs ───────────────────────────────────────────────────────────────
	let messagesEl: HTMLElement | null = $state(null);
	let textareaEl: HTMLTextAreaElement | null = $state(null);

	// ── Auto-scroll controller (Svelte 5 Runes) ────────────────────────────
	const autoScroll = useAutoScroll(() => messagesEl);

	let scrollTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const msgs = $messages;
		if (msgs.length > 0) {
			const lastMsg = msgs[msgs.length - 1];
			// content + isStreaming 변경을 감지하기 위한 의존성 등록
			void (lastMsg.content + lastMsg.isStreaming);
		}

		if (!scrollTimer) {
			scrollTimer = setTimeout(() => {
				scrollTimer = null;
				if (!autoScroll.isUserScrolledUp) {
					void autoScroll.scrollToBottom("auto");
				}
			}, 50);
		}
	});

	// ── Controller ────────────────────────────────────────────────────────
	let ctrl: ChatController | null = $state(null);

	// ── Derived values ────────────────────────────────────────────────────
	const hasProvider = $derived($verifiedProviders.length > 0);
	const modelOptions = $derived(
		$verifiedProviders.flatMap((p) =>
			p.availableModels.map((m) => {
				const shortLabel = PROVIDER_LABELS[p.type].replace(/\s*\(.*\)\s*/, "");
				return { label: `[${shortLabel}] ${m}`, value: `${p.id}::${m}` };
			}),
		),
	);

	const sendHint = $derived(
		($settingsStore?.chat.sendKey ?? plugin.settings.chat.sendKey) === "enter"
			? $tStore("settings.chat.sendMode.enter")
			: $tStore("settings.chat.sendMode.ctrlEnter"),
	);

	const agentEnabled = $derived($settingsStore?.chat.agentEnabled ?? false);
	const agentExecutionMode = $derived($settingsStore?.chat.agentExecutionMode ?? "read");
	const selectedProvider = $derived($verifiedProviders.find((p) => p.id === selectedProviderId));
	const isCliSelected = $derived(isCliProvider(selectedProvider?.type ?? ""));

	const sessionTokenStats = $derived.by(() => {
		let totalTokens = 0;
		for (const msg of $messages) {
			if (msg.tokenUsage) {
				totalTokens += msg.tokenUsage.totalTokens;
			}
		}
		return { totalTokens };
	});

	// ── Chat Actions (Composable) ──────────────────────────────────────────
	const chatActions = useChatActions({
		getPlugin: () => plugin,
		getCtrl: () => ctrl,
		getSelectedProviderId: () => selectedProviderId,
		getSelectedModelId: () => selectedModelId,
		getIsLoading: () => $isLoading,
		getHasProvider: () => hasProvider,
		getIsRagEnabled: () => $isRagEnabled,
		getUseRagContext: () => useRagContext,
		setUseRagContext: (v) => {
			useRagContext = v;
		},
		getIncludeActiveNote: () => includeActiveNote,
		setIncludeActiveNote: (v) => {
			includeActiveNote = v;
		},
		getAgentEnabled: () => agentEnabled,
		getAgentExecutionMode: () => agentExecutionMode,
		getIsCliSelected: () => isCliSelected,
		getVerifiedProviders: () => $verifiedProviders,
	});

	// ── Initialization ────────────────────────────────────────────────────
	function initChatPanel(): void {
		const activeProject = getActiveProject();
		selectedProviderId = activeProject.defaultProviderId;
		selectedModelId = activeProject.defaultModelId;
		if (!selectedProviderId && modelOptions.length > 0) {
			const [pid, mid] = splitProviderModel(modelOptions[0].value);
			selectedProviderId = pid;
			selectedModelId = mid;
		}
		includeActiveNote = plugin.settings.rag.includeActiveNote;
		useRagContext = plugin.settings.connections.ragEnabled;
		ctrl = new ChatController(plugin);
		textareaEl?.focus();
	}

	onMount(() => {
		initChatPanel();
	});

	onDestroy(() => {
		ctrl?.destroy();
	});

	// ── RAG global off → local off sync ───────────────────────────────────
	$effect(() => {
		if (!$isRagEnabled) {
			useRagContext = false;
		}
	});

	// ── Session provider/model sync from history restore ──────────────────
	$effect(() => {
		const sPid = $sessionProviderId;
		const sMid = $sessionModelId;
		if (sPid && sMid) {
			const isVerified = $verifiedProviders.some((p) => p.id === sPid && p.availableModels.includes(sMid));
			if (isVerified && (selectedProviderId !== sPid || selectedModelId !== sMid)) {
				selectedProviderId = sPid;
				selectedModelId = sMid;
			}
		}
	});

	// ── Stale provider fallback guard ─────────────────────────────────────
	$effect(() => {
		const verified = $verifiedProviders;
		if (verified.length > 0) {
			const currentProvider = verified.find((p) => p.id === selectedProviderId);
			if (!currentProvider || !currentProvider.availableModels.includes(selectedModelId)) {
				if (currentProvider && currentProvider.availableModels.length > 0) {
					selectedModelId = currentProvider.availableModels[0];
				} else if (verified[0].availableModels.length > 0) {
					selectedProviderId = verified[0].id;
					selectedModelId = verified[0].availableModels[0];
				}
			}
		}
	});

	// ── Project switch handler ────────────────────────────────────────────
	async function handleProjectSwitch(newProjectId: string): Promise<void> {
		await executeProjectSwitch({
			plugin,
			newProjectId,
			currentProjectId: $activeProjectId,
			abortController,
			ctrl,
			selectedProviderId,
			selectedModelId,
			isRagEnabled: $isRagEnabled,
			onUpdateSelectedModel: (pid, mid) => {
				selectedProviderId = pid;
				selectedModelId = mid;
			},
		});
	}

	// ── Pending attachments sync ──────────────────────────────────────────
	$effect(() => {
		const atts = $pendingAttachments;
		if (atts.length === 0) return;
		const newAtts = atts.filter(
			(pa) =>
				!attachments.some((a) => {
					if (a.type !== pa.type) return false;
					if (pa.path) return a.path === pa.path;
					if (pa.content) return a.content === pa.content;
					return a.name === pa.name;
				}),
		);
		if (newAtts.length > 0) {
			attachments = [...attachments, ...newAtts];
			tick().then(() => {
				if (textareaEl) {
					resizeTextarea(textareaEl);
					textareaEl.focus();
				}
			});
		}
		tick().then(() => pendingAttachments.set([]));
	});

	// ── Stream execution helper ───────────────────────────────────────────
	let abortController: AbortController | null = null;

	async function executeStreamOperation(op: (signal: AbortSignal) => Promise<void>): Promise<void> {
		abortController = new AbortController();
		try {
			await op(abortController.signal);
		} catch (err: unknown) {
			if (!(err instanceof Error && err.name === "AbortError")) {
				debugLogger.logError("chat_stream", err instanceof Error ? err : new Error(`Stream operation error: ${err}`));
			}
		} finally {
			abortController = null;
			await ctrl!.saveHistory(selectedProviderId, selectedModelId).catch((e: unknown) => {
				debugLogger.logError("chat_stream", e instanceof Error ? e : new Error(`Failed to save history: ${e}`));
			});
		}
		autoScroll.resetUserScrolledUp();
		await tick();
		await autoScroll.scrollToBottom("smooth");
	}

	// ── Message Actions ───────────────────────────────────────────────────
	async function sendMessage(): Promise<void> {
		const text = inputText.trim();
		if ((!text && attachments.length === 0) || $isLoading || !hasProvider || !ctrl) return;

		const currentAttachments = [...attachments];
		inputText = "";
		attachments = [];
		tick().then(() => {
			resetTextareaHeight();
			textareaEl?.focus();
		});

		await executeStreamOperation((signal) =>
			ctrl!.sendMessage(
				text,
				currentAttachments,
				selectedProviderId,
				selectedModelId,
				{ useRagContext, includeActiveNote },
				signal,
			),
		);
	}

	async function handleEditMessage(messageId: string, newContent: string): Promise<void> {
		if ($isLoading || !hasProvider || !ctrl) return;
		await executeStreamOperation((signal) =>
			ctrl!.editMessageAndResend(
				messageId,
				newContent,
				selectedProviderId,
				selectedModelId,
				{ useRagContext, includeActiveNote },
				signal,
			),
		);
	}

	async function handleRegenerate(assistantMessageId: string): Promise<void> {
		if ($isLoading || !hasProvider || !ctrl) return;
		const msgs = $messages;
		const targetIndex = msgs.findIndex((m) => m.id === assistantMessageId);
		if (targetIndex === -1) return;
		let userMsgIndex = -1;
		for (let i = targetIndex - 1; i >= 0; i--) {
			if (msgs[i].role === "user") {
				userMsgIndex = i;
				break;
			}
		}
		if (userMsgIndex === -1) return;
		const userMsg = msgs[userMsgIndex];
		await handleEditMessage(userMsg.id, userMsg.content);
	}

	async function regenerateLastAnswer(): Promise<void> {
		if ($isLoading || !hasProvider || !ctrl) return;
		const msgs = $messages;
		let lastAssistantId: string | null = null;
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i].role === "assistant") {
				lastAssistantId = msgs[i].id;
				break;
			}
		}
		if (!lastAssistantId) {
			new Notice(
				$tStore("uiMessages.noMessagesToRegenerate") ||
					"No assistant response to regenerate.",
			);
			return;
		}
		await handleRegenerate(lastAssistantId);
	}

	function cancelStream(): void {
		abortController?.abort();
		abortController = null;
		const cliExec = get(activeCliExecution);
		if (cliExec) {
			cliExec.kill();
		}
	}

	function clearChat(): void {
		if ($isLoading) cancelStream();
		const activeProject = getActiveProject();
		if (activeProject.defaultProviderId) {
			selectedProviderId = activeProject.defaultProviderId;
			selectedModelId = activeProject.defaultModelId;
		} else if (modelOptions.length > 0) {
			const [pid, mid] = splitProviderModel(modelOptions[0].value);
			selectedProviderId = pid;
			selectedModelId = mid;
		}
		resetChat();
	}

	function resetTextareaHeight(): void {
		resizeTextarea(textareaEl);
	}
</script>

<div class="lumina-chat">
	<ChatHeader
		{plugin}
		verifiedProviders={$verifiedProviders}
		favoriteModels={$favoriteModels}
		isRagEnabled={$isRagEnabled}
		indexingState={$indexingState}
		indexingProgress={$indexingProgress}
		estimatedTimeRemaining={$estimatedTimeRemaining}
		{useRagContext}
		{showHistory}
		{tStore}
		bind:selectedProviderId
		bind:selectedModelId
		projectList={$projectList}
		activeProjectId={$activeProjectId}
		onToggleRag={chatActions.toggleRagMode}
		onToggleFavorite={chatActions.handleToggleFavorite}
		onToggleHistory={() => {
			if (showHistory) {
				closeHistory(false);
			} else {
				openHistory();
			}
		}}
		onNewChat={clearChat}
		onProjectSelect={handleProjectSwitch}
	/>

	{#if showHistory}
		<div class="lumina-chat__history-wrap">
			{#if ctrl}
				<ChatHistoryList
					{ctrl}
					onBeforeSelect={async () => {
						if ($isLoading) cancelStream();
						if (ctrl && $messages.length > 0) {
							await ctrl.saveHistory(selectedProviderId, selectedModelId);
						}
					}}
					onSessionSelect={() => closeHistory(true)}
					onBack={() => closeHistory(false)}
				/>
			{/if}
		</div>
	{:else}
		<ChatMessageList
			{plugin}
			isRagEnabled={$isRagEnabled}
			showIndexingIndicator={$showIndexingIndicator}
			indexingState={$indexingState}
			indexingProgress={$indexingProgress}
			estimatedTimeRemaining={$estimatedTimeRemaining}
			{tStore}
			messages={$messages}
			{hasProvider}
			{sendHint}
			bind:messagesEl
			handleMessagesScroll={autoScroll.handleScroll}
			{handleEditMessage}
			{handleRegenerate}
			openSettingsToTab={() => openSettingsTab(plugin.app, "lumina")}
			onApproveTool={(id) => ctrl?.respondToolApproval(id, true)}
			onRejectTool={(id) => ctrl?.respondToolApproval(id, false)}
			onOpenFile={chatActions.handleOpenFile}
		/>

		{#if $approvalStore.queue.length > 0}
			<InlineApprovalQueue {tStore} />
		{/if}

		<ChatInputArea
			{plugin}
			isLoading={$isLoading}
			{hasProvider}
			{sendHint}
			{sessionTokenStats}
			{includeActiveNote}
			{agentEnabled}
			{agentExecutionMode}
			{isCliSelected}
			providers={$verifiedProviders}
			favoriteModels={$favoriteModels}
			onToggleFavorite={chatActions.handleToggleFavorite}
			{selectedProviderId}
			{selectedModelId}
			{tStore}
			bind:inputText
			bind:attachments
			bind:textareaEl
			onToggleActiveNote={chatActions.toggleActiveNote}
			onToggleAgentExecutionMode={chatActions.toggleAgentExecutionMode}
			onSelectModel={(providerId, modelId) => {
				selectedProviderId = providerId;
				selectedModelId = modelId;
			}}
			onSendMessage={sendMessage}
			onCancelStream={cancelStream}
			onClearChat={clearChat}
			onToggleRagMode={chatActions.toggleRagMode}
			onOpenSettings={() => openSettingsTab(plugin.app, "lumina")}
			onToggleWebSearch={chatActions.toggleWebSearch}
			onExportChat={chatActions.exportChat}
			onRegenerateLast={regenerateLastAnswer}
			onCompressContext={chatActions.compressContext}
		/>
	{/if}
</div>