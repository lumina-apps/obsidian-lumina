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
import { approvalManager } from '../store/approvalStore';
import { getToolDefinitions } from './server/toolDefinitions';
import { dispatchToolHandler } from './server/handlerRegistry';
import { PathGuard } from './server/pathGuard';
import type { McpLimits, ToolHandlerContext } from './server/toolTypes';

const LOCAL_MCP_CLIENT_ID = '__lumina_local__';

/** 위험 툴 승인 대기 최대 시간 (기본 5분) */
const MCP_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export class McpManager {
	private plugin: LuminaPlugin;
	public clients: Map<string, LuminaMcpClient> = new Map();
	private localLifecycle: LocalServerLifecycle;
	private clientSync: ClientConnectionSync;
	private localPathGuard: PathGuard;
	private isSyncing: boolean = false;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
		this.localLifecycle = new LocalServerLifecycle(plugin);
		this.clientSync = new ClientConnectionSync(this.clients);
		this.localPathGuard = new PathGuard();
	}

	/** 내장 MCP 서버 인스턴스 (외부 호환성 유지) */
	get localServer(): LuminaMcpServer | null {
		return this.localLifecycle.server;
	}

	/** 내장 에이전트와 로컬 HTTP 서버가 공유하는 PathGuard 인스턴스 */
	private get sharedPathGuard(): PathGuard {
		return this.localLifecycle.server?.pathGuard ?? this.localPathGuard;
	}

	/** 내장 에이전트 및 외부 경로 검사에서 접근 가능한 PathGuard 인스턴스 */
	get pathGuard(): PathGuard {
		return this.sharedPathGuard;
	}

	/** 내장 도구 실행용 컨텍스트 생성 */
	private buildLocalContext(signal?: AbortSignal): ToolHandlerContext {
		const mcpSettings = this.plugin.settings?.mcp;
		const limits: McpLimits = {
			limitRead: mcpSettings?.serverMaxReadChars || 20000,
			limitAppend: mcpSettings?.serverMaxAppendChars || 10000,
			snippetLen: mcpSettings?.serverSearchSnippetLength || 300,
			maxResults: mcpSettings?.serverSearchMaxResults || 10,
		};
		return {
			plugin: this.plugin,
			signal,
			...limits,
		};
	}

	/** 외부 CLI MCP 연동 설정(.claude/mcp.json, opencode.json 등)을 일괄 정리합니다. */
	async cleanupCliMcp(): Promise<void> {
		if (!Platform.isDesktop) return;
		await this.localLifecycle.cliMcpSync.cleanup();
	}

	async syncServers(): Promise<void> {
		if (this.isSyncing) return;
		if (!Platform.isDesktop) {
			debugLogger.logSystem('mcp', 'External MCP servers and local HTTP transport are not supported on mobile platforms.');
			return;
		}
		this.isSyncing = true;
		try {
			// 1단계: 내장 HTTP MCP 서버 생명주기 (외부 클라이언트 연동용)
			await this.localLifecycle.syncServer();

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

		// 내장 에이전트가 활성화되어 있으면 로컬 HTTP 우회 없이 메모리 내장 도구를 직접 노출
		if (this.plugin.settings?.chat?.agentEnabled && this.plugin.settings?.mcp?.clientToolsEnabled !== false) {
			for (const def of getToolDefinitions(this.plugin.settings)) {
				toolsMap.set(def.name, {
					name: def.name,
					description: def.description,
					inputSchema: def.inputSchema,
					_serverId: LOCAL_MCP_CLIENT_ID,
					_serverName: 'Lumina Built-in',
				});
			}
		}

		for (const client of this.clients.values()) {
			for (const tool of client.availableTools) {
				// tool name만으로 중복 제거 (내장 도구 및 여러 클라이언트의 중복 제공 방지)
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
		return Array.from(toolsMap.values());
	}

	async callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<unknown> {
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
				const client = this.clients.get(serverId);
				if (!client) throw new Error(`MCP server ${serverId} is not connected.`);
				// 사용자가 Stop을 누르거나 타임아웃이 지나면 자동 거절 처리되어 블로킹 방지
				const approved = await approvalManager.requestActionApproval(
					'mcp_tool',
					client.config.name,
					{ toolName, args },
					{ signal, timeoutMs: MCP_APPROVAL_TIMEOUT_MS },
				);
				if (!approved) {
					return {
						isError: true,
						content: [{ type: 'text', text: t('uiMessages.toolExecutionRejected') || 'Tool execution was rejected by the user.' }],
					};
				}
			}
		}

		// 내장 도구는 HTTP/SSE 루프백 없이 메모리에서 핸들러 직접 호출
		if (serverId === LOCAL_MCP_CLIENT_ID) {
			const ctx = this.buildLocalContext(signal);
			const callStart = Date.now();
			try {
				const result = await dispatchToolHandler(toolName, args, ctx, this.sharedPathGuard);
				const durationMs = Date.now() - callStart;
				debugLogger.logMcp(
					'Built-in Tool Call',
					`내장 에이전트 툴 처리: ${toolName} (${durationMs}ms${result.isError ? ', isError=true' : ''})`,
					{ name: toolName, durationMs, isError: Boolean(result.isError) },
				);
				return result;
			} catch (e: unknown) {
				const durationMs = Date.now() - callStart;
				const err = formatMcpError(e, `Failed to execute built-in tool ${toolName}`);
				debugLogger.logMcp(
					'Built-in Tool Error',
					`내장 에이전트 툴 예외: ${toolName} (${durationMs}ms) - ${err.message}`,
					{ name: toolName, durationMs, error: err.message },
				);
				debugLogger.logError('mcp', err);
				return {
					isError: true,
					content: [{ type: 'text', text: t('mcpServerTools.common.executionError', { error: err.message }) }],
				};
			}
		}

		const client = this.clients.get(serverId);
		if (!client) throw new Error(`MCP server ${serverId} is not connected.`);

		try {
			return await client.callTool(toolName, args, signal);
		} catch (e: unknown) {
			const errorMsg = formatMcpError(e, `Failed to execute tool ${toolName} on server ${client.config.name}`);
			debugLogger.logError('mcp', errorMsg);
			
			// DO NOT disconnect the server on tool execution error.
			// It is often just a tool-level logical error (e.g., file not found).
			return {
				isError: true,
				content: [{ type: 'text', text: errorMsg.message }],
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
		for (const client of this.clients.values()) {
			await client.disconnect().catch((err) => {
				debugLogger.logError('mcp', err instanceof Error ? err : new Error(`Failed to disconnect client: ${err}`));
			});
		}
		this.clients.clear();
		await this.localLifecycle.stopServer();
	}
}