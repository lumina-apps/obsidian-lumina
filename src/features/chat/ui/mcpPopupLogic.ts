/**
 * McpQuickPopup 비즈니스 로직. MCP 서버/에이전트 토글과 상태 동기화 헬퍼.
 */

import { Notice } from "obsidian";
import type LuminaPlugin from "../../../main";
import type { McpServerConfig } from "../../../shared/types/settings.types";
import { t } from "../../../shared/locales/helpers";

// ─── 상태별 색상 ─────────────────────────────────────────────────────────────


export function getStatusColor(status: McpServerConfig["status"]): string {
	switch (status) {
		case "connected":
			return "var(--text-success)";
		case "connecting":
			return "var(--text-warning)";
		case "error":
			return "var(--text-error)";
		default:
			return "var(--text-muted)";
	}
}

// ─── 상태 동기화 ─────────────────────────────────────────────────────────────


interface PopupStateSync {
	serverEnabled: boolean;
	serverPort: number;
	agentEnabled: boolean;
}

/** 설정에서 최신 MCP/Agent 상태 읽기 */
export function readPopupState(plugin: LuminaPlugin): PopupStateSync {
	return {
		serverEnabled: plugin.settings.mcp.serverEnabled,
		serverPort: plugin.settings.mcp.serverPort,
		agentEnabled: plugin.settings.chat.agentEnabled,
	};
}

// ─── 외부 MCP 서버 토글 ────────────────────────────────────────────────────────

/** 외부 MCP 서버 enabled 토글. @returns 갱신된 서버 목록 */
export async function toggleServer(
	plugin: LuminaPlugin,
	serverId: string,
): Promise<McpServerConfig[]> {
	if (!plugin.mcpManager) {
		new Notice(t("uiMessages.mcpManagerNotInitialized"));
		return plugin.settings.mcp.servers;
	}

	const server = plugin.settings.mcp.servers.find((s) => s.id === serverId);
	if (!server) {
		return plugin.settings.mcp.servers;
	}

	server.enabled = !server.enabled;

	try {
		await plugin.mcpManager.syncServers();
	} catch {
		// syncServers 전체 실패 시 enabled 복구
		server.enabled = !server.enabled;
		plugin.settings.mcp.servers = [...plugin.settings.mcp.servers];
		new Notice(t("uiMessages.mcpConnectFailed", { name: server.name }));
	}

	// syncServers 내 connectNewClients에서 연결 실패 시
	// 이미 config.enabled = false로 되돌려 놓았으므로, 여기서 결과 확인
	await plugin.saveSettings();

	// Svelte {#each} 반응성을 위해 각 객체를 얕은 복사하여 새 참조로 만듦
	return plugin.settings.mcp.servers.map((s) => ({ ...s }));
}

// ─── 내장 MCP 서버 토글 ────────────────────────────────────────────────────────

export interface ToggleLocalServerResult {
	state: PopupStateSync;
	servers: McpServerConfig[];
}

/**
 * 내장 MCP 서버의 enabled 상태를 토글합니다.
 * authToken 자동 생성, 에이전트 자동 비활성화 로직 포함.
 *
 * @returns 갱신된 상태와 서버 목록
 */
export async function toggleLocalServer(plugin: LuminaPlugin): Promise<ToggleLocalServerResult> {
	if (!plugin.mcpManager) {
		new Notice(t("uiMessages.mcpManagerNotInitialized"));
		return {
			state: readPopupState(plugin),
			servers: plugin.settings.mcp.servers,
		};
	}

	plugin.settings.mcp.serverEnabled = !plugin.settings.mcp.serverEnabled;

	if (plugin.settings.mcp.serverEnabled && !plugin.settings.mcp.serverAuthToken) {
		plugin.settings.mcp.serverAuthToken = crypto.randomUUID();
	}

	try {
		await plugin.mcpManager.syncServers();
	} catch {
		plugin.settings.mcp.serverEnabled = !plugin.settings.mcp.serverEnabled;
		new Notice(t("uiMessages.mcpConnectFailed", { name: t("settings.mcp.localServerName") }));
	}

	// 에이전트가 켜져 있는데 서버를 수동으로 껐다면 에이전트도 끔
	if (!plugin.settings.mcp.serverEnabled && plugin.settings.chat.agentEnabled) {
		plugin.settings.chat.agentEnabled = false;
		new Notice(t("uiMessages.agentModeLocalServerStoppedDisabledShort"));
	}

	await plugin.saveSettings();

	return {
		state: readPopupState(plugin),
		servers: [...plugin.settings.mcp.servers],
	};
}

// ─── 에이전트 토글 ────────────────────────────────────────────────────────────

export interface ToggleAgentResult {
	state: PopupStateSync;
	/** 에이전트 토글이 거부되었는지 여부 (LLM 미설정 등) */
	rejected: boolean;
}

/**
 * 에이전트 모드의 enabled 상태를 토글합니다.
 * LLM 제공자가 설정되지 않았으면 거부하고 rejected: true를 반환합니다.
 * 에이전트 ON 시 내장 MCP 서버도 자동으로 켜집니다.
 */
export async function toggleAgent(plugin: LuminaPlugin): Promise<ToggleAgentResult> {
	const isConfigured = plugin.settings.connections.providers.some((p) => p.isVerified);
	if (!isConfigured) {
		new Notice(t("uiMessages.agentModeLlmRequired"));
		return {
			state: readPopupState(plugin),
			rejected: true,
		};
	}

	plugin.settings.chat.agentEnabled = !plugin.settings.chat.agentEnabled;

	if (plugin.settings.chat.agentEnabled && !plugin.settings.mcp.serverEnabled) {
		plugin.settings.mcp.serverEnabled = true;
		if (!plugin.settings.mcp.serverAuthToken) {
			plugin.settings.mcp.serverAuthToken = crypto.randomUUID();
		}
		new Notice(t("uiMessages.agentModeLocalServerStarting"));
		if (plugin.mcpManager) {
			await plugin.mcpManager.syncServers();
		}
	} else if (plugin.settings.chat.agentEnabled) {
		new Notice(t("uiMessages.agentModeEnabled"));
	} else {
		new Notice(t("uiMessages.agentModeDisabled"));
	}

	await plugin.saveSettings();

	return {
		state: readPopupState(plugin),
		rejected: false,
	};
}