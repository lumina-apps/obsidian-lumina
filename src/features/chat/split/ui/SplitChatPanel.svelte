<script lang="ts">
	import { Notice, Platform } from "obsidian";
	import { onDestroy, onMount, tick } from "svelte";
	import type LuminaPlugin from "../../../../main";
	import {
		indexingProgress,
		indexingState,
	} from "../../../../core/store/ragStore";
	import {
		favoriteModels,
		isRagEnabled,
		settingsStore,
		verifiedProviders,
	} from "../../../../core/store/settingsStore";
	import {
		MAX_SPLIT_SLOTS,
		MIN_SPLIT_SLOTS,
		addSplitSlot,
		initSplitSlots,
		isAnySlotStreaming,
		removeSplitSlot,
		resetSplitChat,
		revealAllSplitTurns,
		revealSplitTurn,
		setActiveMobileSlotId,
		setFocusedResponse,
		setSplitContextMode,
		setSplitMode,
		setSplitTurnWinner,
		splitChatStore,
		splitSessionTokenStats,
		updateSplitSlotModel,
		updateSplitSlotTemperature,
	} from "../../../../core/store/splitChatStore";
	import { tStore } from "../../../../shared/locales/index";
	import type { TranslationKeys } from "../../../../shared/locales/locale.types";
	import type { ContextAttachment } from "../../../../shared/types/chat.types";
	import type {
		SplitContextMode,
		SplitLayoutMode,
		SplitWinnerChoice,
	} from "../../../../shared/types/splitChat.types";
	import { toggleFavoriteModel } from "../../../../shared/utils/modelUtils";
	import { openSettingsTab } from "../../../../shared/utils/openSettingsTab";
	import { resizeTextarea } from "../../../../shared/utils/textareaUtils";
	import ChatInputArea from "../../ui/ChatInputArea.svelte";
	import {
		createDragOverHandler,
		createDropHandler,
	} from "../../ui/composables/useFileAttachment";
	import { useAutoScroll } from "../../ui/utils/useAutoScroll.svelte.ts";
	import { SplitChatController } from "../splitChatController";
	import {
		createNextSplitSlot,
		getSplitEligibleProviders,
		pickInitialSplitSlots,
	} from "../splitSlotUtils";
	import SplitFocusModal from "./SplitFocusModal.svelte";
	import SplitHeader from "./SplitHeader.svelte";
	import SplitHistoryDrawer from "./SplitHistoryDrawer.svelte";
	import SplitSlotBar from "./SplitSlotBar.svelte";
	import SplitTurnRow from "./SplitTurnRow.svelte";

	const BLIND_POSITION_LABELS = ["A", "B", "C", "D"] as const;

	let { plugin }: { plugin: LuminaPlugin } = $props();

	let rootEl = $state<HTMLElement | null>(null);
	let turnsEl = $state<HTMLElement | null>(null);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	let inputText = $state("");
	let attachments = $state<ContextAttachment[]>([]);
	let includeActiveNote = $state(false);
	let useRagContext = $state(false);
	let showHistory = $state(false);
	let historyRefreshTick = $state(0);
	let containerWidth = $state(960);

	let ctrl = $state<SplitChatController | null>(null);

	const isCompact = $derived(Platform.isMobile || containerWidth < 680);

	const eligibleProviders = $derived(getSplitEligibleProviders($verifiedProviders));
	const hasEligibleProvider = $derived(eligibleProviders.length > 0);
	const globalTemperature = $derived(
		$settingsStore?.chat.temperature ?? plugin.settings.chat.temperature ?? 0.7,
	);
	const sendHint = $derived(
		($settingsStore?.chat.sendKey ?? plugin.settings.chat.sendKey) === "enter"
			? $tStore("settings.chat.sendMode.enter")
			: $tStore("settings.chat.sendMode.ctrlEnter"),
	);

	// ── Auto-scroll ────────────────────────────────────────────────────────
	const autoScroll = useAutoScroll(() => turnsEl);
	let scrollTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const turns = $splitChatStore.turns;
		if (turns.length > 0) {
			const last = turns[turns.length - 1];
			// 마지막 라운드 응답 내용 및 상태 변화 추적
			void Object.values(last.responses)
				.map((r) => `${r.status}:${r.content.length}`)
				.join("|");
		}
		if (!scrollTimer) {
			scrollTimer = setTimeout(() => {
				scrollTimer = null;
				if (!autoScroll.isUserScrolledUp) {
					void autoScroll.scrollToBottom("auto");
				}
			}, 60);
		}
	});

	// ── ResizeObserver (컨테이너 폭 기반 반응형 전환) ───────────────────────
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		const savedPrefs = plugin.settings.chat.splitChat;
		const currentState = $splitChatStore;

		if (currentState.slots.length === 0) {
			if (savedPrefs?.mode) setSplitMode(savedPrefs.mode);
			if (savedPrefs?.contextMode) setSplitContextMode(savedPrefs.contextMode);
			const initialSlots = pickInitialSplitSlots(
				eligibleProviders,
				$favoriteModels,
				savedPrefs,
			);
			if (initialSlots.length > 0) {
				initSplitSlots(initialSlots);
			}
		}

		includeActiveNote = plugin.settings.rag.includeActiveNote;
		useRagContext = plugin.settings.connections.ragEnabled;
		ctrl = new SplitChatController(plugin);
		if (!Platform.isMobile) {
			textareaEl?.focus();
		}

		if (rootEl && typeof ResizeObserver !== "undefined") {
			containerWidth = rootEl.clientWidth || 960;
			resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					containerWidth = entry.contentRect.width;
				}
			});
			resizeObserver.observe(rootEl);
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		resizeObserver = null;
		if (scrollTimer) {
			clearTimeout(scrollTimer);
			scrollTimer = null;
		}
		ctrl?.destroy();
	});

	// 전역 RAG 비활성화 시 로컬 토글 동기화
	$effect(() => {
		if (!$isRagEnabled) {
			useRagContext = false;
		}
	});

	// 검증된 프로바이더 변경 시 슬롯 유효성 보정
	$effect(() => {
		const eligible = eligibleProviders;
		const currentSlots = $splitChatStore.slots;
		if (eligible.length === 0) return;

		if (currentSlots.length === 0) {
			const init = pickInitialSplitSlots(
				eligible,
				$favoriteModels,
				plugin.settings.chat.splitChat,
			);
			if (init.length > 0) initSplitSlots(init);
			return;
		}

		for (const slot of currentSlots) {
			const prov = eligible.find((p) => p.id === slot.providerId);
			if (!prov || !prov.availableModels.includes(slot.modelId)) {
				if (prov && prov.availableModels.length > 0) {
					updateSplitSlotModel(slot.slotId, prov.id, prov.availableModels[0]);
				} else if (eligible[0].availableModels.length > 0) {
					updateSplitSlotModel(
						slot.slotId,
						eligible[0].id,
						eligible[0].availableModels[0],
					);
				}
			}
		}
	});

	// ── Actions ────────────────────────────────────────────────────────────
	async function handleSendMessage(): Promise<void> {
		const text = inputText.trim();
		if (
			(!text && attachments.length === 0) ||
			$isAnySlotStreaming ||
			!hasEligibleProvider ||
			!ctrl
		) {
			return;
		}

		const currentAttachments = [...attachments];
		inputText = "";
		attachments = [];
		void tick().then(() => {
			resizeTextarea(textareaEl);
			if (!Platform.isMobile) {
				textareaEl?.focus();
			}
		});

		autoScroll.resetUserScrolledUp();
		await ctrl.sendPrompt(text, currentAttachments, {
			useRagContext,
			includeActiveNote,
		});
		historyRefreshTick += 1;
		await autoScroll.scrollToBottom("smooth");
	}

	function handleCancelStream(): void {
		ctrl?.abortAll();
	}

	function handleClearOrNewChat(): void {
		if ($isAnySlotStreaming) {
			ctrl?.abortAll();
		}
		resetSplitChat(true);
		if (isCompact) {
			showHistory = false;
		}
	}

	function handleToggleRag(): void {
		if (!$isRagEnabled) {
			new Notice(
				$tStore("errors.ragDisabledGlobally") ||
					"Global RAG engine is disabled. Turn it on in Settings.",
			);
			return;
		}
		useRagContext = !useRagContext;
	}

	function handleToggleActiveNote(): void {
		includeActiveNote = !includeActiveNote;
	}

	function handleAddSlot(): void {
		if ($splitChatStore.slots.length >= MAX_SPLIT_SLOTS || $isAnySlotStreaming) return;
		const nextSlot = createNextSplitSlot(
			$splitChatStore.slots,
			eligibleProviders,
			$favoriteModels,
		);
		if (nextSlot && addSplitSlot(nextSlot)) {
			void ctrl?.persistPreferences();
		}
	}

	function handleRemoveSlot(slotId: string): void {
		if (removeSplitSlot(slotId)) {
			void ctrl?.persistPreferences();
		}
	}

	function handleSelectModel(slotId: string, providerId: string, modelId: string): void {
		updateSplitSlotModel(slotId, providerId, modelId);
		void ctrl?.persistPreferences();
	}

	function handleChangeTemperature(slotId: string, temp: number | undefined): void {
		updateSplitSlotTemperature(slotId, temp);
		void ctrl?.persistPreferences();
	}

	function handleChangeMode(next: SplitLayoutMode): void {
		setSplitMode(next);
		void ctrl?.persistPreferences();
	}

	function handleChangeContextMode(next: SplitContextMode): void {
		setSplitContextMode(next);
		void ctrl?.persistPreferences();
	}

	function handleVoteWinner(turnId: string, winner: SplitWinnerChoice): void {
		setSplitTurnWinner(turnId, winner, true);
		ctrl?.scheduleAutoSave();
	}

	function handleRevealTurn(turnId: string): void {
		revealSplitTurn(turnId);
		ctrl?.scheduleAutoSave();
	}

	function handleRevealAll(): void {
		revealAllSplitTurns();
		ctrl?.scheduleAutoSave();
	}

	async function handleEditTurn(turnId: string, newContent: string): Promise<void> {
		if (!ctrl) return;
		await ctrl.editTurnAndResend(turnId, newContent, {
			useRagContext,
			includeActiveNote,
		});
		historyRefreshTick += 1;
	}

	async function handleSelectHistorySession(sessionId: string): Promise<void> {
		if (!ctrl) return;
		const ok = await ctrl.restoreHistorySession(sessionId);
		if (ok) {
			if (isCompact) {
				showHistory = false;
			}
			autoScroll.resetUserScrolledUp();
			await tick();
			await autoScroll.scrollToBottom("auto");
		}
	}

	async function handleToggleFavorite(providerId: string, modelId: string): Promise<void> {
		const current = plugin.settings.connections.favoriteModels ?? [];
		plugin.settings.connections.favoriteModels = toggleFavoriteModel(
			current,
			providerId,
			modelId,
		);
		await plugin.settingsManager.saveSettings();
	}

	// 파일 드래그 앤 드롭 지원
	const panelFileCtx = {
		get plugin() {
			return plugin;
		},
		get attachments() {
			return attachments;
		},
		setAttachments: (a: ContextAttachment[]) => {
			attachments = a;
		},
		t: (key: string, vars?: Record<string, string | number>) => {
			let text = $tStore(key as TranslationKeys);
			if (vars) {
				for (const [k, v] of Object.entries(vars)) {
					text = text.replace(`{{${k}}}`, String(v));
				}
			}
			return text;
		},
		onResizeTextarea: () => resizeTextarea(textareaEl),
	};
	const handlePanelDrop = createDropHandler(panelFileCtx);
	const handlePanelDragOver = createDragOverHandler();

	// 확대 보기 모달용 파생 데이터
	const focusedData = $derived.by(() => {
		const target = $splitChatStore.focusedResponse;
		if (!target) return null;
		const turn = $splitChatStore.turns.find((t) => t.id === target.turnId);
		const resp = turn?.responses[target.slotId];
		if (!turn || !resp) return null;

		const slot = $splitChatStore.slots.find((s) => s.slotId === target.slotId);
		const isMasked = $splitChatStore.mode === "blind" && !turn.isRevealed;
		const order =
			isMasked && turn.blindOrder?.length
				? turn.blindOrder
				: $splitChatStore.slots.map((s) => s.slotId);
		const posIdx = Math.max(0, order.indexOf(target.slotId));

		return {
			turn,
			resp,
			slotLabel: slot?.label ?? BLIND_POSITION_LABELS[posIdx] ?? "?",
			maskedLabel: BLIND_POSITION_LABELS[posIdx] ?? String(posIdx + 1),
			isMasked,
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="lumina-split-root"
	class:is-compact={isCompact}
	bind:this={rootEl}
	ondrop={handlePanelDrop}
	ondragover={handlePanelDragOver}
>
	{#if showHistory && ctrl}
		<div class="lumina-split-root__drawer-wrap">
			<SplitHistoryDrawer
				app={plugin.app}
				{ctrl}
				currentSessionId={$splitChatStore.sessionId}
				refreshTick={historyRefreshTick}
				{tStore}
				onSelectSession={handleSelectHistorySession}
				onNewComparison={handleClearOrNewChat}
				onClose={() => (showHistory = false)}
			/>
		</div>
	{/if}

	<div class="lumina-split-main">
		<SplitHeader
			mode={$splitChatStore.mode}
			contextMode={$splitChatStore.contextMode}
			slotCount={$splitChatStore.slots.length}
			maxSlots={MAX_SPLIT_SLOTS}
			isStreaming={$isAnySlotStreaming}
			hasProvider={hasEligibleProvider}
			hasTurns={$splitChatStore.turns.length > 0}
			{showHistory}
			isRagEnabled={$isRagEnabled}
			indexingState={$indexingState}
			indexingProgress={$indexingProgress}
			{useRagContext}
			{tStore}
			onToggleHistory={() => {
				showHistory = !showHistory;
				if (showHistory) historyRefreshTick += 1;
			}}
			onChangeMode={handleChangeMode}
			onChangeContextMode={handleChangeContextMode}
			onToggleRag={handleToggleRag}
			onAddSlot={handleAddSlot}
			onExport={() => void ctrl?.exportCurrentComparison()}
			onNewChat={handleClearOrNewChat}
		/>

		<SplitSlotBar
			slots={$splitChatStore.slots}
			providers={eligibleProviders}
			favoriteModels={$favoriteModels}
			mode={$splitChatStore.mode}
			turns={$splitChatStore.turns}
			{globalTemperature}
			{isCompact}
			activeMobileSlotId={$splitChatStore.activeMobileSlotId}
			isStreaming={$isAnySlotStreaming}
			minSlots={MIN_SPLIT_SLOTS}
			{tStore}
			onSelectModel={handleSelectModel}
			onChangeTemperature={handleChangeTemperature}
			onRemoveSlot={handleRemoveSlot}
			onToggleFavorite={handleToggleFavorite}
			onSelectMobileSlot={setActiveMobileSlotId}
			onRevealAll={handleRevealAll}
		/>

		<div
			class="lumina-split-turns lumina-scrollbar-thin"
			bind:this={turnsEl}
			onscroll={autoScroll.handleScroll}
		>
			{#if !hasEligibleProvider}
				<div class="lumina-split-empty">
					<div class="lumina-split-empty__icon">⚙️</div>
					<h3>{$tStore("errors.llmNotConnected")}</h3>
					<p>{$tStore("splitChat.noValidModels")}</p>
					<button
						type="button"
						class="lumina-chat__setup-btn"
						onclick={() => openSettingsTab(plugin.app, "lumina")}
					>
						⚙️ {$tStore("settings.connections.title")}
					</button>
				</div>
			{:else if $splitChatStore.turns.length === 0}
				<div class="lumina-split-empty">
					<div class="lumina-split-empty__icon">⚔️</div>
					<h3>{$tStore("splitChat.emptyTitle")}</h3>
					<p>{$tStore("splitChat.emptyDesc")}</p>
				</div>
			{:else}
				<div class="lumina-split-turns__inner">
					{#each $splitChatStore.turns as turn (turn.id)}
						<SplitTurnRow
							{turn}
							slots={$splitChatStore.slots}
							mode={$splitChatStore.mode}
							{isCompact}
							activeMobileSlotId={$splitChatStore.activeMobileSlotId}
							app={plugin.app}
							{tStore}
							onEditTurn={handleEditTurn}
							onStopSlot={(tid, sid) => ctrl?.abortSlot(tid, sid)}
							onRetrySlot={(tid, sid) => void ctrl?.retrySlot(tid, sid, { useRagContext })}
							onVoteWinner={handleVoteWinner}
							onRevealTurn={handleRevealTurn}
							onContinueInChat={(sid) => void ctrl?.promoteToSingleChat(sid)}
							onExpandResponse={(tid, sid) =>
								setFocusedResponse({ turnId: tid, slotId: sid })}
						/>
					{/each}
				</div>
			{/if}
		</div>

		<ChatInputArea
			{plugin}
			isLoading={$isAnySlotStreaming}
			hasProvider={hasEligibleProvider}
			{sendHint}
			sessionTokenStats={$splitSessionTokenStats}
			{includeActiveNote}
			agentEnabled={false}
			agentExecutionMode="read"
			isCliSelected={false}
			hideAgentControls={true}
			splitModelCount={$splitChatStore.slots.length}
			customPlaceholder={$tStore("splitChat.inputPlaceholder")}
			providers={eligibleProviders}
			favoriteModels={$favoriteModels}
			selectedProviderId={eligibleProviders[0]?.id ?? ""}
			selectedModelId={eligibleProviders[0]?.availableModels[0] ?? ""}
			{tStore}
			bind:inputText
			bind:attachments
			bind:textareaEl
			onToggleActiveNote={handleToggleActiveNote}
			onToggleAgentExecutionMode={() => {}}
			onSelectModel={() => {}}
			onToggleFavorite={handleToggleFavorite}
			onSendMessage={handleSendMessage}
			onCancelStream={handleCancelStream}
			onClearChat={handleClearOrNewChat}
			onToggleRagMode={handleToggleRag}
			onOpenSettings={() => openSettingsTab(plugin.app, "lumina")}
			onToggleWebSearch={() => {}}
			onExportChat={() => void ctrl?.exportCurrentComparison()}
			onRegenerateLast={() => {}}
			onCompressContext={() => {}}
		/>
	</div>

	{#if focusedData}
		<SplitFocusModal
			turn={focusedData.turn}
			response={focusedData.resp}
			slotLabel={focusedData.slotLabel}
			maskedLabel={focusedData.maskedLabel}
			isMasked={focusedData.isMasked}
			app={plugin.app}
			{tStore}
			onClose={() => setFocusedResponse(null)}
		/>
	{/if}
</div>

<style>
	.lumina-split-root {
		position: relative;
		display: flex;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--background-primary);
		font-family: var(--font-interface);
		container-type: inline-size;
	}

	.lumina-split-root__drawer-wrap {
		height: 100%;
		flex-shrink: 0;
		z-index: 40;
	}

	.lumina-split-root.is-compact .lumina-split-root__drawer-wrap {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		box-shadow: 4px 0 24px rgba(0, 0, 0, 0.25);
	}

	.lumina-split-main {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.lumina-split-turns {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
	}

	.lumina-split-turns__inner {
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1600px;
		margin: 0 auto;
	}

	.lumina-split-empty {
		height: 100%;
		min-height: 240px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 8px;
		padding: 32px;
		color: var(--text-muted);
	}

	.lumina-split-empty__icon {
		font-size: 32px;
		margin-bottom: 4px;
	}

	.lumina-split-empty h3 {
		margin: 0;
		font-size: 15px;
		color: var(--text-normal);
	}

	.lumina-split-empty p {
		margin: 0;
		max-width: 460px;
		font-size: 12.5px;
		line-height: 1.5;
	}
</style>
