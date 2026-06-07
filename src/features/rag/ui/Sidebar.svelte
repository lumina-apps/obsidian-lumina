<script lang="ts">
	import { onMount, tick } from "svelte";
	import type LuminaPlugin from "../../../main";
	import ChatPanel from "../../chat/ui/ChatPanel.svelte";
	import DiscoveryPanel from "./DiscoveryPanel.svelte";
	import {
		isRagEnabled,
		settingsStore,
	} from "../../../core/store/settingsStore";
	import { tStore } from "../../../shared/locales/index";
	import { activeSidebarTab } from "../../../core/store/chatStore";

	let { plugin }: { plugin: LuminaPlugin } = $props();
</script>

<div class="lumina-sidebar">
	<!-- 탭 네비게이션 -->
	<div class="lumina-sidebar__tabs">
		<button
			class="lumina-sidebar__tab"
			class:is-active={$activeSidebarTab === "chat"}
			onclick={() => ($activeSidebarTab = "chat")}
		>
			💬 {$tStore("discovery.chatTabName") || "AI Chat"}
		</button>
		<button
			class="lumina-sidebar__tab"
			class:is-active={$activeSidebarTab === "discovery"}
			onclick={() => ($activeSidebarTab = "discovery")}
		>
			🔗 {$tStore("discovery.tabName") || "Smart Discovery"}
		</button>
	</div>

	<!-- 탭 컨텐츠 -->
	<div class="lumina-sidebar__content">
		<!-- Svelte 5에서는 display: none 으로 숨기거나 {#if}로 마운트/언마운트 가능.
			ChatPanel의 상태 유지를 위해 display: none 방식을 고려할 수도 있으나,
			Svelte의 기본 {#if}를 사용하여 ChatPanel과 DiscoveryPanel을 조건부 렌더링.
			다만 ChatPanel의 입력창 상태가 날아갈 수 있으므로,
			UX를 위해 CSS display:none으로 상태를 보존하는 것이 옵시디언에서는 좋습니다. -->
		<div
			class="lumina-sidebar__pane"
			style:display={$activeSidebarTab === "chat" ? "flex" : "none"}
		>
			<ChatPanel {plugin} />
		</div>
		<div
			class="lumina-sidebar__pane"
			style:display={$activeSidebarTab === "discovery" ? "flex" : "none"}
		>
			{#if $activeSidebarTab === "discovery"}
				<DiscoveryPanel {plugin} isActive={$activeSidebarTab === "discovery"} />
			{/if}
		</div>
	</div>
</div>

<style>
	.lumina-sidebar {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--background-primary);
		font-family: var(--font-interface);
	}

	.lumina-sidebar__tabs {
		display: flex;
		padding: 8px 8px 0 8px;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
		gap: 4px;
		flex-shrink: 0;
	}

	.lumina-sidebar__tab {
		flex: 1;
		padding: 8px 12px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-muted);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: center;
	}

	.lumina-sidebar__tab:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
		border-radius: 6px 6px 0 0;
	}

	.lumina-sidebar__tab.is-active {
		color: var(--interactive-accent);
		border-bottom-color: var(--interactive-accent);
	}

	.lumina-sidebar__content {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}

	.lumina-sidebar__pane {
		width: 100%;
		height: 100%;
		flex-direction: column;
	}
</style>
