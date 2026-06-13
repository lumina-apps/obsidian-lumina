<script lang="ts">
	import { tick } from "svelte";
	import { Notice } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import { ChatController } from "../chatController";
	import ChatHistoryList from "./ChatHistoryList.svelte";
	import ChatHeader from "./ChatHeader.svelte";
	import ChatMessageList from "./ChatMessageList.svelte";
	import ChatInputArea from "./ChatInputArea.svelte";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import { splitProviderModel } from "../utils/inputUtils";

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
	import { PROVIDER_LABELS } from "../../../shared/types/settings.types";
	import { tStore } from "../../../shared/locales/index";

	let { plugin }: { plugin: LuminaPlugin } = $props();

	let selectedProviderId = $state("");
	let selectedModelId = $state("");
	let abortController: AbortController | null = null;
	let showHistory = $state(false);

	let inputText = $state("");
	let attachments = $state<ContextAttachment[]>([]);
	let includeActiveNote = $state(false);
	let useRagContext = $state(false);

	let messagesEl: HTMLElement | null = $state(null);
	let textareaEl: HTMLTextAreaElement | null = $state(null);

	let scrollTimer: ReturnType<typeof setTimeout> | null = null;
	let isUserScrolledUp = $state(false);
	let lastScrollTop = 0;
	let scrollRafId: number | null = null;

	function handleMessagesScroll() {
		if (scrollRafId !== null || !messagesEl) return;
		scrollRafId = requestAnimationFrame(() => {
			scrollRafId = null;
			if (!messagesEl) return;
			const { scrollTop, scrollHeight, clientHeight } = messagesEl;
			if (scrollTop < lastScrollTop && scrollHeight - scrollTop - clientHeight > 40) {
				isUserScrolledUp = true;
			} else if (scrollHeight - scrollTop - clientHeight <= 40) {
				isUserScrolledUp = false;
			}
			lastScrollTop = scrollTop;
		});
	}

	function scrollToBottom(behavior: ScrollBehavior = "smooth") {
		tick().then(() => {
			messagesEl?.scrollTo({
				top: messagesEl.scrollHeight,
				behavior,
			});
		});
	}

	$effect(() => {
		const msgs = $messages;
		if (msgs.length > 0) {
			const lastMsg = msgs[msgs.length - 1];
			const _trigger = lastMsg.content + lastMsg.isStreaming;
			if (!scrollTimer) {
				scrollTimer = setTimeout(() => {
					scrollTimer = null;
					if (!isUserScrolledUp) scrollToBottom("auto");
				}, 50);
			}
		}
	});

	let ctrl: ChatController | null = $state(null);

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

	const sessionTokenStats = $derived.by(() => {
		let totalTokens = 0;
		let estimatedCost = 0;
		for (const msg of $messages) {
			if (msg.tokenUsage) {
				totalTokens += msg.tokenUsage.totalTokens;
				if (msg.tokenUsage.estimatedCost) {
					estimatedCost += msg.tokenUsage.estimatedCost;
				}
			}
		}
		return { totalTokens, estimatedCost };
	});

	async function executeStreamOperation(op: (signal: AbortSignal) => Promise<void>) {
		abortController = new AbortController();
		let wasCancelled = false;
		try {
			await op(abortController.signal);
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				wasCancelled = true;
			}
		} finally {
			abortController = null;
			if (!wasCancelled) {
				await ctrl!.saveHistory(selectedProviderId, selectedModelId);
			}
		}
		isUserScrolledUp = false;
		await tick();
		scrollToBottom("smooth");
	}

	async function sendMessage() {
		const text = inputText.trim();
		if ((!text && attachments.length === 0) || $isLoading || !hasProvider || !ctrl) return;

		const currentAttachments = [...attachments];
		inputText = "";
		attachments = [];
		if (textareaEl) {
			textareaEl.style.height = "auto";
			textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + "px";
		}

		await executeStreamOperation((signal) =>
			ctrl!.sendMessage(text, currentAttachments, selectedProviderId, selectedModelId, { useRagContext, includeActiveNote }, signal)
		);
	}

	async function handleEditMessage(messageId: string, newContent: string) {
		if ($isLoading || !hasProvider || !ctrl) return;
		await executeStreamOperation((signal) =>
			ctrl!.editMessageAndResend(messageId, newContent, selectedProviderId, selectedModelId, { useRagContext, includeActiveNote }, signal)
		);
	}

	async function handleRegenerate(assistantMessageId: string) {
		if ($isLoading || !hasProvider || !ctrl) return;
		const msgs = $messages;
		const targetIndex = msgs.findIndex((m) => m.id === assistantMessageId);
		if (targetIndex === -1) return;
		let userMsgIndex = -1;
		for (let i = targetIndex - 1; i >= 0; i--) {
			if (msgs[i].role === "user") { userMsgIndex = i; break; }
		}
		if (userMsgIndex === -1) return;
		const userMsg = msgs[userMsgIndex];
		await handleEditMessage(userMsg.id, userMsg.content);
	}

	function cancelStream() {
		abortController?.abort();
		abortController = null;
	}

	function clearChat() {
		if ($isLoading) cancelStream();
		if (plugin.settings.connections.defaultProviderId) {
			selectedProviderId = plugin.settings.connections.defaultProviderId;
			selectedModelId = plugin.settings.connections.defaultModelId;
		}
		resetChat();
	}

	$effect(() => {
		if (!$isRagEnabled) {
			useRagContext = false;
		}
	});

	async function toggleActiveNote() {
		includeActiveNote = !includeActiveNote;
	}

	async function toggleRagMode() {
		if (!$isRagEnabled) {
			new Notice($tStore("errors.ragDisabledGlobally") || "Global RAG engine is disabled. Turn it on in Settings.");
			return;
		}
		useRagContext = !useRagContext;
	}

	let _initialized = $state(false);
	$effect(() => {
		if (_initialized) return;
		selectedProviderId = plugin.settings.connections.defaultProviderId;
		selectedModelId = plugin.settings.connections.defaultModelId;
		if (!selectedProviderId && modelOptions.length > 0) {
			const [pid, mid] = splitProviderModel(modelOptions[0].value);
			selectedProviderId = pid;
			selectedModelId = mid;
		}
		includeActiveNote = plugin.settings.rag.includeActiveNote;
		useRagContext = plugin.settings.connections.ragEnabled;
		ctrl = new ChatController(plugin);
		textareaEl?.focus();
		_initialized = true;
	});

	$effect(() => {
		const atts = $pendingAttachments;
		if (atts.length === 0) return;
		const newAtts = atts.filter((pa) => !attachments.some((a) => {
			if (a.type !== pa.type) return false;
			if (pa.path) return a.path === pa.path;
			if (pa.content) return a.content === pa.content;
			return a.name === pa.name;
		}));
		if (newAtts.length > 0) {
			attachments = [...attachments, ...newAtts];
			tick().then(() => {
				if (textareaEl) {
					textareaEl.style.height = "auto";
					textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + "px";
					textareaEl.focus();
				}
			});
		}
		setTimeout(() => { pendingAttachments.set([]); }, 0);
	});

	function openSettingsToTab(tabId: string = "lumina") {
		// @ts-ignore
		(plugin.app as any).setting.open();
		// @ts-ignore
		(plugin.app as any).setting.openTabById(tabId);
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
		onToggleRag={toggleRagMode}
		onToggleHistory={() => (showHistory = !showHistory)}
		onNewChat={clearChat}
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
			{handleMessagesScroll}
			{handleEditMessage}
			{handleRegenerate}
			{openSettingsToTab}
		/>

		<ChatInputArea
			{plugin}
			isLoading={$isLoading}
			{hasProvider}
			{sendHint}
			{sessionTokenStats}
			{includeActiveNote}
			{tStore}
			bind:inputText
			bind:attachments
			bind:textareaEl
			onToggleActiveNote={toggleActiveNote}
			onSendMessage={sendMessage}
			onCancelStream={cancelStream}
			onClearChat={clearChat}
			onToggleRagMode={toggleRagMode}
			onOpenSettings={() => openSettingsToTab()}
		/>
	{/if}
</div>

<style>
	:global(.lumina-chat) {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--background-primary);
		font-family: var(--font-interface);
	}

	:global(.lumina-chat__history-wrap) {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	/* CSS imported from previous monolith to ensure everything renders perfectly */
	:global(.lumina-chat__header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 8px 6px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
		flex-shrink: 0;
		position: relative;
	}

	:global(.lumina-chat__title) {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		font-weight: 700;
		color: var(--text-normal);
	}

	:global(.lumina-chat__logo) {
		font-size: 16px;
		background: linear-gradient(
			135deg,
			var(--interactive-accent) 0%,
			#a855f7 100%
		);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		filter: drop-shadow(0 2px 6px rgba(168, 85, 247, 0.25));
	}

	:global(.lumina-chat__controls) {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	:global(.lumina-chat__icon-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	:global(.lumina-chat__icon-btn:hover:not(:disabled)) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.lumina-chat__icon-btn:disabled) {
		opacity: 0.25;
		cursor: default;
		pointer-events: none;
	}

	:global(.lumina-chat__toggle-btn) {
		font-size: 10px;
		font-weight: 700;
		padding: 0 6px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}
	:global(.lumina-chat__toggle-btn:hover) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	:global(.lumina-chat__toggle-btn.is-active) {
		background: var(--interactive-accent);
		color: white;
		border-color: var(--interactive-accent);
	}
	:global(.lumina-chat__toggle-btn.is-disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.lumina-chat__messages) {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		scroll-behavior: smooth;
	}

	:global(.lumina-chat__messages::-webkit-scrollbar) {
		width: 6px;
	}

	:global(.lumina-chat__messages::-webkit-scrollbar-thumb) {
		background: var(--background-modifier-border);
		border-radius: 3px;
		transition: background 0.25s;
	}

	:global(.lumina-chat__messages::-webkit-scrollbar-thumb:hover) {
		background: var(--background-modifier-border-hover);
	}

	:global(.lumina-chat__messages::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(.lumina-chat__messages-inner) {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	:global(.lumina-chat__empty) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 220px;
		gap: 10px;
		color: var(--text-muted);
		text-align: center;
		padding: 0 20px;
	}

	:global(.lumina-chat__empty-icon) {
		font-size: 36px;
		margin-bottom: 6px;
		filter: drop-shadow(0 4px 8px rgba(168, 85, 247, 0.15));
	}

	:global(.lumina-chat__empty p) {
		font-size: 13.5px;
		font-weight: 600;
		margin: 0;
		color: var(--text-normal);
	}

	:global(.lumina-chat__empty-sub) {
		font-size: 11px;
		color: var(--text-muted) !important;
		opacity: 0.8;
	}

	:global(.lumina-chat__setup-btn) {
		margin-top: 8px;
		padding: 8px 16px;
		border-radius: 8px;
		border: 1px solid var(--interactive-accent);
		background: transparent;
		color: var(--interactive-accent);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	:global(.lumina-chat__setup-btn:hover) {
		background: var(--interactive-accent);
		color: white;
		box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
		transform: translateY(-1px);
	}

	:global(.lumina-chat__input-area) {
		flex-shrink: 0;
		padding: 6px 8px 2px;
		border-top: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	:global(.lumina-chat__input-toolbar) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 4px;
	}

	:global(.lumina-chat__toolbar-group) {
		display: flex;
		gap: 6px;
	}

	:global(.lumina-chat__toolbar-btn) {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		font-weight: 600;
		color: var(--text-muted);
		background: transparent;
		border: none;
		border-radius: 4px;
		padding: 4px 6px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	:global(.lumina-chat__toolbar-btn:hover) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.lumina-chat__context-badge) {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 9px;
		font-weight: 600;
		padding: 3px 8px;
		border-radius: 4px;
		background: rgba(var(--mono-rgb-100), 0.05);
		color: var(--text-muted);
		border: 1px solid var(--background-modifier-border);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	:global(.lumina-chat__context-badge:hover) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.lumina-chat__context-badge.is-active) {
		background: rgba(var(--color-accent-rgb, 139, 92, 246), 0.12);
		color: var(--interactive-accent);
		border-color: var(--interactive-accent);
	}

	:global(.lumina-chat__rag-badge) {
		font-size: 10px;
		font-weight: 700;
		padding: 0 6px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		border: 1px solid;
	}

	:global(.lumina-chat__rag-badge--idle) {
		background: rgba(156, 163, 175, 0.1);
		color: rgb(156, 163, 175);
		border-color: rgba(156, 163, 175, 0.3);
	}

	:global(.lumina-chat__rag-badge--ready) {
		background: rgba(34, 197, 94, 0.1);
		color: rgb(34, 197, 94);
		border-color: rgba(34, 197, 94, 0.3);
	}

	:global(.lumina-chat__rag-badge--indexing) {
		background: rgba(251, 191, 36, 0.1);
		color: rgb(251, 191, 36);
		border-color: rgba(251, 191, 36, 0.3);
		animation: lumina-pulse 1.5s ease-in-out infinite;
	}

	@keyframes lumina-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	:global(.lumina-chat__rag-banner) {
		margin: 8px 8px 0;
		flex-shrink: 0;
		padding: 12px 16px;
		background: rgba(139, 92, 246, 0.08);
		border: 1px solid rgba(139, 92, 246, 0.3);
		border-radius: 8px;
		animation: lumina-pulse 2.5s ease-in-out infinite;
	}

	:global(.lumina-chat__rag-banner-content) {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	:global(.lumina-chat__rag-banner-content strong) {
		color: var(--interactive-accent);
		font-size: 13px;
	}

	:global(.lumina-chat__rag-banner-content span) {
		color: var(--text-muted);
		font-size: 12px;
	}

	:global(.lumina-chat__textarea-wrap) {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 12px;
		padding: 10px 12px;
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.02),
			inset 0 1px 0 rgba(255, 255, 255, 0.02);
		transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.lumina-chat__textarea-wrap:focus-within) {
		border-color: var(--interactive-accent);
		box-shadow:
			0 4px 16px rgba(139, 92, 246, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.02);
	}

	:global(.lumina-chat__textarea) {
		flex: 1;
		border: none;
		background: transparent;
		resize: none;
		font-size: 13px;
		line-height: 20px;
		color: var(--text-normal);
		font-family: var(--font-interface);
		outline: none;
		min-height: 30px;
		max-height: 160px;
		overflow-y: auto;
		padding: 5px 0;
	}

	:global(.lumina-chat__textarea::-webkit-scrollbar) {
		width: 4px;
	}

	:global(.lumina-chat__textarea::-webkit-scrollbar-thumb) {
		background: var(--background-modifier-border);
		border-radius: 2px;
	}

	:global(.lumina-chat__textarea::placeholder) {
		color: var(--text-faint);
	}

	:global(.lumina-chat__textarea:disabled) {
		opacity: 0.5;
	}

	:global(.lumina-chat__send-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0 !important;
		border-radius: 8px;
		border: none;
		background: var(--background-modifier-border);
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.lumina-chat__send-btn svg) {
		width: 22px !important;
		height: 22px !important;
		stroke-width: 2.2px !important;
	}

	:global(.lumina-chat__clear-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.2s ease;
	}

	:global(.lumina-chat__clear-btn:hover) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.lumina-chat__clear-btn svg) {
		width: 18px !important;
		height: 18px !important;
		stroke-width: 2px !important;
	}

	:global(.lumina-chat__send-btn.is-active) {
		background: linear-gradient(
			135deg,
			var(--interactive-accent) 0%,
			#8b5cf6 100%
		);
		color: #ffffff;
		box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
	}

	:global(.lumina-chat__send-btn.is-active:hover) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
	}

	:global(.lumina-chat__send-btn:active) {
		transform: scale(0.92);
	}

	:global(.lumina-chat__send-btn:disabled) {
		opacity: 0.4;
		cursor: default;
		background: var(--background-modifier-border) !important;
		color: var(--text-muted) !important;
		box-shadow: none !important;
		transform: none !important;
	}

	:global(.lumina-chat__send-btn--cancel) {
		background: var(--color-red) !important;
		color: white !important;
		opacity: 0.9 !important;
		box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3) !important;
	}

	:global(.lumina-chat__send-btn--cancel:hover) {
		opacity: 1 !important;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4) !important;
	}

	:global(.lumina-chat__attachments) {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 2px 4px 6px;
	}

	:global(.lumina-chat__attachment-chip) {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--background-secondary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 12px;
		padding: 4px 8px;
		font-size: 11px;
		color: var(--text-normal);
		max-width: 100%;
	}

	:global(.lumina-chat__attachment-icon) {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	:global(.lumina-chat__attachment-icon svg) {
		width: 12px;
		height: 12px;
	}

	:global(.lumina-chat__attachment-name) {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.lumina-chat__attachment-remove) {
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 2px;
		margin-left: 2px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	:global(.lumina-chat__attachment-remove:hover) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.lumina-chat__attachment-remove svg) {
		width: 10px;
		height: 10px;
	}

	:global(.lumina-chat__hint-inline) {
		font-size: 11.5px;
		color: var(--text-faint);
		font-weight: 500;
	}

	:global(.lumina-chat__hidden-file-input) {
		display: none;
	}

	:global(.lumina-chat__toolbar-right) {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	:global(.lumina-chat__input-container) {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	:global(.lumina-chat__input-row) {
		display: flex;
		gap: 8px;
		align-items: flex-end;
	}

	:global(.lumina-chat__token-stats) {
		font-size: 11.5px;
		color: var(--text-muted);
		font-weight: 500;
		background: var(--background-primary);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
	}
</style>
