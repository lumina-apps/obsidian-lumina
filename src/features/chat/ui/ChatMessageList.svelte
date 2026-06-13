<script lang="ts">
	import Message from "./Message.svelte";
	import type LuminaPlugin from "../../../main";

	let {
		plugin,
		isRagEnabled,
		showIndexingIndicator,
		indexingState,
		indexingProgress,
		estimatedTimeRemaining,
		tStore,
		messages,
		hasProvider,
		sendHint,
		messagesEl = $bindable(),
		handleMessagesScroll,
		handleEditMessage,
		handleRegenerate,
		openSettingsToTab,
	} = $props<{
		plugin: LuminaPlugin;
		isRagEnabled: boolean;
		showIndexingIndicator: boolean;
		indexingState: any;
		indexingProgress: number;
		estimatedTimeRemaining: number | null;
		tStore: any;
		messages: any[];
		hasProvider: boolean;
		sendHint: string;
		messagesEl: HTMLElement | null;
		handleMessagesScroll: () => void;
		handleEditMessage: (messageId: string, newContent: string) => Promise<void>;
		handleRegenerate: (assistantMessageId: string) => Promise<void>;
		openSettingsToTab: () => void;
	}>();
</script>

<!-- RAG Progress Banner Fixed -->
{#if isRagEnabled && showIndexingIndicator}
	<div class="lumina-chat__rag-banner">
		<div class="lumina-chat__rag-banner-content">
			{#if indexingState.status === "loading-model"}
				<strong>
					{$tStore("settings.rag.init.loadingModel") ||
						$tStore("settings.rag.init.downloading")}
				</strong>
				<span>{$tStore("settings.rag.init.loadingModelDesc") || ""}</span>
			{:else}
				<strong>
					{$tStore("settings.rag.init.indexingVault") ||
						$tStore("settings.rag.init.indexingNotes")}
				</strong>
				<span>
					{($tStore("settings.rag.init.indexingProgressText") || "")
						.replace("{{processed}}", indexingState.processedFiles.toString())
						.replace("{{total}}", indexingState.totalFiles.toString())
						.replace("{{pct}}", indexingProgress.toString())}
					{#if estimatedTimeRemaining !== null}
						{$tStore("settings.rag.init.remainingTimePrefix") || ""}{estimatedTimeRemaining < 60
							? ($tStore("settings.rag.init.remainingTimeSec") || "").replace("{{sec}}", estimatedTimeRemaining.toString())
							: ($tStore("settings.rag.init.remainingTimeMinSec") || "")
									.replace("{{min}}", Math.floor(estimatedTimeRemaining / 60).toString())
									.replace("{{sec}}", (estimatedTimeRemaining % 60).toString())}
					{/if}
				</span>
			{/if}
		</div>
	</div>
{/if}

<!-- Messages -->
<div
	class="lumina-chat__messages"
	bind:this={messagesEl}
	onscroll={handleMessagesScroll}
>
	{#if messages.length === 0}
		<div class="lumina-chat__empty">
			{#if !hasProvider}
				<div class="lumina-chat__empty-icon">⚙️</div>
				<p>{$tStore("errors.llmNotConnected")}</p>
				<p class="lumina-chat__empty-sub">
					{$tStore("errors.llmConnectRequired")}
				</p>
				<button
					class="lumina-chat__setup-btn"
					type="button"
					onclick={() => openSettingsToTab()}
				>
					⚙️ {$tStore("settings.connections.title")}
				</button>
			{:else}
				<div class="lumina-chat__empty-icon">✦</div>
				<p>{$tStore("errors.chatEmptyWelcome")}</p>
				<p class="lumina-chat__empty-sub">{sendHint}</p>
			{/if}
		</div>
	{:else}
		<div class="lumina-chat__messages-inner">
			{#each messages as msg (msg.id)}
				<Message
					message={msg}
					app={plugin.app}
					onEdit={handleEditMessage}
					onRegenerate={handleRegenerate}
				/>
			{/each}
		</div>
	{/if}
</div>
