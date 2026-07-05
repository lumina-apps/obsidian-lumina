<script lang="ts">
	import { setIcon } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import ModelSelector from "./ModelSelector.svelte";
	import QuickSettings from "./QuickSettings.svelte";
	import ProjectSelector from "./ProjectSelector.svelte";
	import type { ProjectConfig } from "../../../shared/types/project.types";

	let {
		plugin,
		verifiedProviders,
		isRagEnabled,
		indexingState,
		indexingProgress,
		estimatedTimeRemaining,
		useRagContext,
		showHistory,
		tStore,
		selectedProviderId = $bindable(),
		selectedModelId = $bindable(),
		projectList,
		activeProjectId,
		onToggleRag,
		onToggleHistory,
		onNewChat,
		onProjectSelect,
	} = $props<{
		plugin: LuminaPlugin;
		verifiedProviders: any[];
		isRagEnabled: boolean;
		indexingState: any;
		indexingProgress: number;
		estimatedTimeRemaining: number | null;
		useRagContext: boolean;
		showHistory: boolean;
		tStore: any;
		selectedProviderId: string;
		selectedModelId: string;
		projectList: ProjectConfig[];
		activeProjectId: string;
		onToggleRag: () => void;
		onToggleHistory: () => void;
		onNewChat: () => void;
		onProjectSelect: (projectId: string) => void;
	}>();

	let showQuickSettings = $state(false);

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

<div class="lumina-chat__header">
	<div class="lumina-chat__title">
		<span class="lumina-chat__logo">✦</span>
		{#if projectList.length >= 2}
			<ProjectSelector
				{plugin}
				{projectList}
				{activeProjectId}
				onSelect={onProjectSelect}
			/>
		{:else}
			<span class="lumina-chat__title-text">Lumina</span>
		{/if}
	</div>

	<div class="lumina-chat__controls">
		{#if isRagEnabled}
			{#if indexingState.status === "ready"}
				<span
					class="lumina-chat__rag-badge lumina-chat__rag-badge--ready"
					title={$tStore("settings.rag.status.ready")}
				>
					RAG ✓
				</span>
			{:else if indexingState.status === "indexing" || indexingState.status === "loading-model"}
				<span
					class="lumina-chat__rag-badge lumina-chat__rag-badge--indexing"
					title={$tStore("settings.rag.status.indexingShort")}
				>
					{#if indexingState.status === "loading-model"}
						RAG …
					{:else}
						RAG {indexingProgress}%
						{#if estimatedTimeRemaining !== null}
							({estimatedTimeRemaining < 60
								? ($tStore("settings.rag.init.remainingTimeSec") || "").replace("{{sec}}", estimatedTimeRemaining.toString())
								: ($tStore("settings.rag.init.remainingTimeMinSec") || "")
										.replace("{{min}}", Math.floor(estimatedTimeRemaining / 60).toString())
										.replace("{{sec}}", (estimatedTimeRemaining % 60).toString())})
						{/if}
					{/if}
				</span>
			{:else if indexingState.status !== "ready"}
				<span
					class="lumina-chat__rag-badge lumina-chat__rag-badge--idle"
					title={indexingState.status === "error" ? $tStore("settings.rag.status.error") : $tStore("settings.rag.status.waiting")}
				>
					RAG -
				</span>
			{/if}
		{/if}

		<button
			class="lumina-chat__toggle-btn"
			class:is-active={useRagContext}
			class:is-disabled={!isRagEnabled}
			aria-label={$tStore("settings.rag.toggleTooltip")}
			onclick={onToggleRag}
		>
			RAG
		</button>

		{#if verifiedProviders.length > 0}
			<ModelSelector
				providers={verifiedProviders}
				bind:selectedProviderId
				bind:selectedModelId
			/>
		{/if}

		<button
			class="clickable-icon lumina-chat__icon-btn"
			aria-label={$tStore("chat.newChat")}
			onclick={onNewChat}
			type="button"
			use:icon={"lumina-message-plus"}
		>
		</button>

		<button
			class="clickable-icon lumina-chat__icon-btn"
			class:is-active={showHistory}
			aria-label={$tStore("chat.history")}
			onclick={onToggleHistory}
			type="button"
			use:icon={"history"}
		>
		</button>

		<button
			class="clickable-icon lumina-chat__icon-btn"
			class:is-active={showQuickSettings}
			aria-label={$tStore("chat.settings")}
			type="button"
			onclick={(e) => {
				e.stopPropagation();
				showQuickSettings = !showQuickSettings;
			}}
			use:icon={"settings"}
		>
		</button>
	</div>

	<QuickSettings {plugin} bind:isOpen={showQuickSettings} />
</div>
