<script lang="ts">
	import type LuminaPlugin from "../../../main";
	import type { McpServerConfig } from "../../../shared/types/settings.types";
	import { t } from "../../../shared/locales/helpers";
	import { settingsStore } from "../../../core/store/settingsStore";
	import { iconAction, clickOutside } from "../../../shared/utils/domUtils";
	import {
		getStatusColor,
		toggleServer,
		toggleLocalServer,
		toggleAgent,
	} from "./mcpPopupLogic";

	let {
		plugin,
		onClose,
		onOpenSettings,
	} = $props<{
		plugin: LuminaPlugin;
		onClose: () => void;
		onOpenSettings: () => void;
	}>();

	let containerEl: HTMLDivElement | null = $state(null);

	let servers = $state<McpServerConfig[]>([]);
	let serverEnabled = $state(false);
	let serverPort = $state(3000);
	let agentEnabled = $state(false);
	let showAdvanced = $state(false);

	// settingsStore 변경 감지 → UI 동기화
	$effect(() => {
		if ($settingsStore) {
			servers = $settingsStore.mcp.servers;
			serverEnabled = $settingsStore.mcp.serverEnabled;
			serverPort = $settingsStore.mcp.serverPort;
			agentEnabled = $settingsStore.chat.agentEnabled;
		}
	});

	async function handleToggleServer(event: Event, server: McpServerConfig) {
		const target = event.target as HTMLInputElement;
		server.enabled = target.checked;
		const updated = await toggleServer(plugin, server.id);
		servers = updated;
	}

	async function handleToggleLocalServer(event: Event) {
		const target = event.target as HTMLInputElement;
		serverEnabled = target.checked;
		const result = await toggleLocalServer(plugin);
		serverEnabled = result.state.serverEnabled;
		serverPort = result.state.serverPort;
		agentEnabled = result.state.agentEnabled;
		servers = result.servers;
	}

	async function handleToggleAgent(event: Event) {
		const target = event.target as HTMLInputElement;
		agentEnabled = target.checked;
		const result = await toggleAgent(plugin);
		if (result.rejected) {
			agentEnabled = false;
			return;
		}
		serverEnabled = result.state.serverEnabled;
		serverPort = result.state.serverPort;
		agentEnabled = result.state.agentEnabled;
	}
</script>

<div class="lumina-mcp-popup" bind:this={containerEl} use:clickOutside={onClose}>
	<div class="lumina-mcp-popup__header">
		<span class="lumina-mcp-popup__title">{t('settings.mcp.title')}</span>
		<button class="lumina-mcp-popup__btn-settings" onclick={onOpenSettings} title={t('common.settings')}>
			<span use:iconAction={"settings"}></span>
		</button>
	</div>
	<div class="lumina-mcp-popup__list">
		<!-- 에이전트 모드 -->
		<div class="lumina-mcp-popup__item lumina-mcp-popup__item-agent">
			<div class="lumina-mcp-popup__item-left">
				<span class="lumina-mcp-popup__status-dot" style="background-color: {agentEnabled ? 'var(--interactive-accent)' : 'var(--text-muted)'}"></span>
				<span class="lumina-mcp-popup__item-name" title={t('settings.mcp.agentMode.desc')}>🤖 {t('settings.mcp.agentMode.name')}</span>
			</div>
			<div class="lumina-mcp-popup__item-right">
				<label class="lumina-toggle-switch">
					<input type="checkbox" checked={agentEnabled} onchange={handleToggleAgent} />
					<span class="lumina-toggle-slider"></span>
				</label>
			</div>
		</div>
		<!-- 고급 설정 접이식 영역 -->
		<button class="lumina-mcp-popup__advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)} type="button">
			<span class="lumina-mcp-popup__advanced-arrow" class:is-open={showAdvanced}>▶</span>
			<span>{t('settings.showAdvanced')}</span>
		</button>

		{#if showAdvanced}
			<!-- 내장 MCP 서버 -->
			<div class="lumina-mcp-popup__item lumina-mcp-popup__item-local">
				<div class="lumina-mcp-popup__item-left">
					<span class="lumina-mcp-popup__status-dot" style="background-color: {serverEnabled ? 'var(--text-success)' : 'var(--text-muted)'}"></span>
					<span class="lumina-mcp-popup__item-name" title="{t('settings.mcp.localServerName')}">{t('settings.mcp.localServerName')} (:{serverPort})</span>
				</div>
				<div class="lumina-mcp-popup__item-right">
					<label class="lumina-toggle-switch">
						<input type="checkbox" checked={serverEnabled} onchange={handleToggleLocalServer} />
						<span class="lumina-toggle-slider"></span>
					</label>
				</div>
			</div>

			{#if servers.length > 0}
				<div class="lumina-mcp-popup__divider"></div>
			{/if}

			<!-- 외부 MCP 서버 -->
			{#if servers.length === 0}
				<div class="lumina-mcp-popup__empty">{t('settings.mcp.emptyServers')}</div>
			{:else}
				{#each servers as server}
					<div class="lumina-mcp-popup__item">
						<div class="lumina-mcp-popup__item-left">
							<span class="lumina-mcp-popup__status-dot" style="background-color: {getStatusColor(server.status)}"></span>
							<span class="lumina-mcp-popup__item-name" title={server.name}>{server.name}</span>
						</div>
						<div class="lumina-mcp-popup__item-right">
							<label class="lumina-toggle-switch">
								<input type="checkbox" checked={server.enabled} onchange={(e) => handleToggleServer(e, server)} />
								<span class="lumina-toggle-slider"></span>
							</label>
						</div>
					</div>
				{/each}
			{/if}
		{/if}
	</div>
</div>

<style>
	.lumina-mcp-popup {
		position: absolute;
		bottom: 100%;
		right: 0;
		width: 250px;
		margin-bottom: 8px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: popover-fade-in 0.15s cubic-bezier(0.4, 0, 0.2, 1);
	}

	@keyframes popover-fade-in {
		from { opacity: 0; transform: translateY(4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.lumina-mcp-popup__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-mcp-popup__title {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
	}

	.lumina-mcp-popup__btn-settings {
		all: unset;
		cursor: pointer;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		padding: 2px;
		border-radius: 4px;
		transition: color 0.1s;
	}

	.lumina-mcp-popup__btn-settings:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.lumina-mcp-popup__btn-settings :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-mcp-popup__list {
		max-height: 200px;
		overflow-y: auto;
		padding: 4px 0;
	}

	.lumina-mcp-popup__empty {
		font-size: 12px;
		color: var(--text-muted);
		padding: 12px;
		text-align: center;
	}

	.lumina-mcp-popup__item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		font-size: 13px;
	}

	.lumina-mcp-popup__item-local {
		background: var(--background-secondary-alt);
		border-radius: 4px;
		margin: 4px 8px;
		padding: 6px 8px;
	}

	.lumina-mcp-popup__item-agent {
		background: var(--background-modifier-hover);
		border-radius: 4px;
		margin: 4px 8px;
		padding: 6px 8px;
		font-weight: 600;
	}

	.lumina-mcp-popup__advanced-toggle {
		all: unset;
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 12px;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		box-sizing: border-box;
		transition: color 0.1s;
	}
	.lumina-mcp-popup__advanced-toggle:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}
	.lumina-mcp-popup__advanced-arrow {
		display: inline-block;
		font-size: 8px;
		transition: transform 0.15s;
	}
	.lumina-mcp-popup__advanced-arrow.is-open {
		transform: rotate(90deg);
	}

	.lumina-mcp-popup__divider {
		height: 1px;
		background: var(--background-modifier-border);
		margin: 4px 0;
	}

	.lumina-mcp-popup__item:hover {
		background: var(--background-modifier-hover);
	}

	.lumina-mcp-popup__item-left {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
	}

	.lumina-mcp-popup__status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.lumina-mcp-popup__item-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-normal);
	}

	.lumina-mcp-popup__item-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* Simple Toggle Switch styles */
	.lumina-toggle-switch {
		position: relative;
		display: inline-block;
		width: 28px;
		height: 16px;
	}

	.lumina-toggle-switch input {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
		z-index: 2;
		margin: 0;
	}

	.lumina-toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0; left: 0; right: 0; bottom: 0;
		background-color: var(--background-modifier-border);
		transition: .2s;
		border-radius: 16px;
	}

	.lumina-toggle-slider:before {
		position: absolute;
		content: "";
		height: 12px;
		width: 12px;
		left: 2px;
		bottom: 2px;
		background-color: var(--text-on-accent);
		transition: .2s;
		border-radius: 50%;
	}

	input:checked + .lumina-toggle-slider {
		background-color: var(--interactive-accent);
	}

	input:checked + .lumina-toggle-slider:before {
		transform: translateX(12px);
	}
</style>