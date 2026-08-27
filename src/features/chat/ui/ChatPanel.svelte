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
	import { resizeTextarea } from "../utils/textareaUtils";
	import { useAutoScroll } from "./utils/useAutoScroll.svelte.ts";
	import { openSettingsTab } from "../../../shared/utils/openSettingsTab";

	import {
		messages,
		isLoading,
		resetChat,
		pendingAttachments,
	} from "../../../core/store/chatStore";
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
	} from "../../../core/store/settingsStore";
	import {
		projectList,
		activeProjectId,
		setActiveProject,
		getActiveProject,
	} from "../../../core/store/projectStore";
	import { PROVIDER_LABELS } from "../../../shared/types/settings.types";
	import { tStore } from "../../../shared/locales/index";

	let { plugin }: { plugin: LuminaPlugin } = $props();

	// ── UI state ───────────────────────────────────────────────────────────
	let selectedProviderId = $state("");
	let selectedModelId = $state("");
	let showHistory = $state(false);
	let inputText = $state("");
	let attachments = $state<ContextAttachment[]>([]);
	let includeActiveNote = $state(false);
	let useRagContext = $state(false);

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

	const sessionTokenStats = $derived.by(() => {
		let totalTokens = 0;
		for (const msg of $messages) {
			if (msg.tokenUsage) {
				totalTokens += msg.tokenUsage.totalTokens;
			}
		}
		return { totalTokens };
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
			includeActiveNote = false;
		}
	});

	// ── Project switch handler ────────────────────────────────────────────
	async function handleProjectSwitch(newProjectId: string): Promise<void> {
		if (newProjectId === $activeProjectId) return;

		// 1. 스트리밍 중이면 즉시 중단
		if (abortController) {
			abortController.abort();
			abortController = null;
			
			// 강제로 스트리밍 상태 해제 (비동기 abort 처리 전 미리 상태 정리하여 히스토리에 오류 상태가 저장되지 않게 함)
			messages.update(msgs => msgs.map(m => ({
				...m,
				isStreaming: false,
				ragPipelineStep: null
			})));
		}

		// 2. 현재 세션 저장
		if (ctrl && $messages.length > 0) {
			try {
				await ctrl.saveHistory(selectedProviderId, selectedModelId);
			} catch (e) {
				// 저장 실패해도 전환은 계속 진행
			}
		}

		// 3. 채팅 초기화
		resetChat();

		// 4. activeProjectId store 업데이트 + plugin.settings 저장
		setActiveProject(newProjectId);
		plugin.settings.projects.activeProjectId = newProjectId;
		await plugin.saveSettings();

		// 4.5. 새 프로젝트의 기본 모델로 전환
		const activeProject = getActiveProject();
		if (activeProject.defaultProviderId && activeProject.defaultModelId) {
			selectedProviderId = activeProject.defaultProviderId;
			selectedModelId = activeProject.defaultModelId;
		}

		// 5. RAG 인덱서 hot-swap (비동기, await 없이 시작만)
		if ($isRagEnabled) {
			import("../../../features/rag/ragInitializer").then(
				({ switchProjectIndex }) => {
					void switchProjectIndex(plugin, newProjectId);
				},
			);
		}
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
			// AbortError가 아닌 에러(토큰 한도, 컨텍스트 오버플로우, 네트워크 에러 등)도
			// 안전하게 처리 - UI는 chatController.sendMessage에서 setMessageError로 이미 처리됨
			if (!(err instanceof Error && err.name === "AbortError")) {
				// Non-AbortError: UI에 이미 에러 메시지가 표시되었으므로 조용히 처리
				console.error("[Lumina] Stream operation error (handled):", err);
			}
		} finally {
			abortController = null;
			// 에러 발생 시에도 history 저장 시도 (final 상태로 저장)
			await ctrl!.saveHistory(selectedProviderId, selectedModelId).catch((e: unknown) => {
				console.error("[Lumina] Failed to save history after error:", e);
			});
		}
		autoScroll.resetUserScrolledUp();
		await tick();
		await autoScroll.scrollToBottom("smooth");
	}

	// ── Actions ───────────────────────────────────────────────────────────
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

	function toggleActiveNote(): void {
		includeActiveNote = !includeActiveNote;
	}

	function toggleRagMode(): void {
		if (!$isRagEnabled) {
			new Notice(
				$tStore("errors.ragDisabledGlobally") || "Global RAG engine is disabled. Turn it on in Settings.",
			);
			return;
		}
		useRagContext = !useRagContext;
	}

	async function toggleAgentExecutionMode(): Promise<void> {
		if (!agentEnabled) {
			new Notice(
				$tStore("errors.agentDisabledGlobally") ||
					"Agent feature is disabled. Please enable it in Settings first.",
			);
			return;
		}
		const newMode = agentExecutionMode === "read" ? "edit" : "read";
		plugin.settings.chat.agentExecutionMode = newMode;
		await plugin.saveSettings();
		settingsStore.set(plugin.settings);
		new Notice(
			newMode === "edit"
				? $tStore("uiMessages.agentModeSwitchedToEdit") ||
						"✏️ Agent switched to Edit Mode. (Can create & edit notes)"
				: $tStore("uiMessages.agentModeSwitchedToRead") ||
						"👁️ Agent switched to Read Mode. (Read-only)",
		);
	}

	async function toggleWebSearch(): Promise<void> {
		plugin.settings.webSearch.enabled = !plugin.settings.webSearch.enabled;
		await plugin.saveSettings();
		new Notice(
			plugin.settings.webSearch.enabled
				? $tStore("uiMessages.webSearchEnabled") || "✅ Web search enabled."
				: $tStore("uiMessages.webSearchDisabled") || "🛑 Web search disabled.",
		);
	}

	async function exportChat(): Promise<void> {
		if (!ctrl) return;
		await ctrl.history.exportCurrentSession(selectedProviderId, selectedModelId);
	}

	async function compressContext(): Promise<void> {
		if ($isLoading || !ctrl || !hasProvider) return;
		const result = await ctrl.compressContext(selectedProviderId, selectedModelId);
		if (result.status === "ok") {
			new Notice(
				$tStore("uiMessages.contextCompressed", {
					messages: result.messages.toLocaleString(),
					tokens: result.tokens.toLocaleString(),
				}) ||
					`📋 Context compressed: ${result.messages} messages → 1 summary (~${result.tokens} tokens freed).`,
			);
		} else if (result.status === "too-short") {
			new Notice(
				$tStore("uiMessages.tooShortToCompress") ||
					"Not enough conversation to compress.",
			);
		} else {
			new Notice(
				$tStore("uiMessages.compressFailed") || "⚠️ Failed to compress context.",
			);
		}
	}

	function resetTextareaHeight(): void {
		resizeTextarea(textareaEl);
	}
</script>

<div class="lumina-chat">
	<ChatHeader
		{plugin}
		verifiedProviders={$verifiedProviders}
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
		onToggleRag={toggleRagMode}
		onToggleHistory={() => (showHistory = !showHistory)}
		onNewChat={clearChat}
		onProjectSelect={handleProjectSwitch}
	/>

	{#if showHistory}
		<div class="lumina-chat__history-wrap">
			{#if ctrl}
				<ChatHistoryList
					{ctrl}
					onSessionSelect={() => (showHistory = false)}
					onBack={() => (showHistory = false)}
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
			providers={$verifiedProviders}
			{selectedProviderId}
			{selectedModelId}
			{tStore}
			bind:inputText
			bind:attachments
			bind:textareaEl
			onToggleActiveNote={toggleActiveNote}
			onToggleAgentExecutionMode={toggleAgentExecutionMode}
			onSelectModel={(providerId, modelId) => {
				selectedProviderId = providerId;
				selectedModelId = modelId;
			}}
			onSendMessage={sendMessage}
			onCancelStream={cancelStream}
			onClearChat={clearChat}
			onToggleRagMode={toggleRagMode}
			onOpenSettings={() => openSettingsTab(plugin.app, "lumina")}
			onToggleWebSearch={toggleWebSearch}
			onExportChat={exportChat}
			onRegenerateLast={regenerateLastAnswer}
			onCompressContext={compressContext}
		/>
	{/if}
</div>