import type { LuminaMcpClient, McpTool } from './mcpClient';
import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { Platform } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import {
	formatMcpError,
	isDangerousTool,
} from '../../shared/utils/mcpUtils';
import type { LuminaMcpServer } from './server/luminaMcpServer';
import { LocalServerLifecycle } from './localServerLifecycle';
import { ClientConnectionSync } from './clientConnectionSync';
import { approvalManager } from '../../features/chat/utils/approvalManager';

const LOCAL_MCP_CLIENT_ID = '__lumina_local__';

export class McpManager {
	private plugin: LuminaPlugin;
	public clients: Map<string, LuminaMcpClient> = new Map();
	private localLifecycle: LocalServerLifecycle;
	private clientSync: ClientConnectionSync;
	private isSyncing: boolean = false;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
		this.localLifecycle = new LocalServerLifecycle(plugin);
		this.clientSync = new ClientConnectionSync(this.clients);
	}

	/** 내장 MCP 서버 인스턴스 (외부 호환성 유지) */
	get localServer(): LuminaMcpServer | null {
		return this.localLifecycle.server;
	}

	async syncServers(): Promise<void> {
		if (this.isSyncing) return;
		if (!Platform.isDesktop) {
			debugLogger.logSystem('mcp', 'MCP is not supported on mobile platforms.');
			return;
		}
		this.isSyncing = true;
		try {
			// 1단계: 내장 MCP 서버 생명주기
			await this.localLifecycle.syncServer();

			// 1.5단계: 내장 MCP 서버용 클라이언트 자동 연결
			await this.localLifecycle.syncLocalClient();

			// 2단계: 설정에서 제거된 외부 클라이언트 연결 해제
			const configs = this.plugin.settings.mcp.servers;
			await this.clientSync.removeStaleClients(configs);

			// 3단계: 신규 외부 클라이언트 연결
			await this.clientSync.connectNewClients(configs);

			// 연결 상태 동기화 및 저장
			this.clientSync.syncClientStatuses(configs);
			await this.plugin.saveSettings();
			this.plugin.refreshSettingTab();
		} finally {
			this.isSyncing = false;
		}
	}

	getAllTools(): McpTool[] {
		const toolsMap = new Map<string, McpTool>();
		for (const client of this.clients.values()) {
			for (const tool of client.availableTools) {
				// tool name만으로 중복 제거 (여러 클라이언트가 같은 서버 툴을 중복 제공하는 것 방지)
				const key = tool.name;
				if (!toolsMap.has(key)) {
					toolsMap.set(key, {
						...tool,
						_serverId: client.config.id,
						_serverName: client.config.name,
					});
				}
			}
		}
		debugLogger.logSystem('mcp', `getAllTools: ${this.clients.size}개 클라이언트에서 ${Array.from(toolsMap.values()).length}개 툴 수집`);
		return Array.from(toolsMap.values());
	}

	async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
		const client = this.clients.get(serverId);
		if (!client) throw new Error(`MCP server ${serverId} is not connected.`);

		if (isDangerousTool(toolName)) {
			const executionMode = this.plugin.settings.chat.agentExecutionMode ?? 'read';
			if (executionMode === 'read') {
				debugLogger.logMcp('Tool Blocked', `읽기 모드에서 위험 툴 실행 차단됨: ${toolName}`);
				return {
					isError: true,
					content: [{ type: 'text', text: t('uiMessages.toolExecutionBlockedReadMode', { toolName }) || `에러: 현재 읽기 모드입니다. 쓰기 또는 수정 권한이 필요한 툴(${toolName})을 실행하려면 '수정 모드'로 전환해주세요.` }],
				};
			}

			if (serverId !== LOCAL_MCP_CLIENT_ID) {
				const approved = await approvalManager.requestActionApproval('mcp_tool', client.config.name, { toolName, args });
				if (!approved) {
					return {
						isError: true,
						content: [{ type: 'text', text: t('uiMessages.toolExecutionRejected') || 'Tool execution was rejected by the user.' }],
					};
				}
			}
		}

		try {
			return await client.callTool(toolName, args);
		} catch (e: unknown) {
			const errorMsg = formatMcpError(e, `Failed to execute tool ${toolName} on server ${client.config.name}`);
			debugLogger.logError('mcp', errorMsg);
			
			// DO NOT disconnect the server on tool execution error.
			// It is often just a tool-level logical error (e.g., file not found).
			return {
				isError: true,
				content: [{ type: 'text', text: errorMsg }],
			};
		}
	}

	async restartServer(serverId: string): Promise<void> {
		const client = this.clients.get(serverId);
		if (client) {
			await client.disconnect().catch((err) => {
				debugLogger.logError('mcp', err instanceof Error ? err : new Error(`Failed to disconnect client ${serverId}: ${err}`));
			});
			this.clients.delete(serverId);
		}
		const config = this.plugin.settings.mcp.servers.find((c) => c.id === serverId);
		if (config) {
			config.status = 'disconnected';
		}
		await this.syncServers();
	}

	async destroy(): Promise<void> {
		await this.localLifecycle.disconnectLocalClient();
		for (const client of this.clients.values()) {
			await client.disconnect().catch((err) => {
				debugLogger.logError('mcp', err instanceof Error ? err : new Error(`Failed to disconnect client: ${err}`));
			});
		}
		this.clients.clear();
		await this.localLifecycle.stopServer();
	}
}