import type { LuminaMcpClient, McpTool } from './mcpClient';
import type LuminaPlugin from '../../main';
import { McpPermissionModal } from '../../shared/utils/mcpPermissionModal';
import { t } from '../../shared/locales/helpers';
import { Notice, Platform } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import type { LuminaMcpServer } from './server/luminaMcpServer';
import type { McpServerConfig } from '../../shared/types/settings.types';

const LOCAL_MCP_CLIENT_ID = '__lumina_local__';

export class McpManager {
	private plugin: LuminaPlugin;
	public clients: Map<string, LuminaMcpClient> = new Map();
	public localServer: LuminaMcpServer | null = null;
	private isSyncing: boolean = false;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	async syncServers(): Promise<void> {
		if (this.isSyncing) return;
		if (!Platform.isDesktop) {
			debugLogger.logSystem('mcp', 'MCP is not supported on mobile platforms.');
			return;
		}
		this.isSyncing = true;
		try {
			const { LuminaMcpServer: ServerCtor } = await import('./server/luminaMcpServer');
			const { LuminaMcpClient: ClientCtor } = await import('./mcpClient');
			
			const configs = this.plugin.settings.mcp.servers;

	// ─── 1. 내장 MCP 서버 먼저 시작 ───
			const mcpSettings = this.plugin.settings.mcp;
			if (mcpSettings.serverEnabled) {
				if (!mcpSettings.serverAuthToken) {
					mcpSettings.serverAuthToken = crypto.randomUUID();
					await this.plugin.saveSettings();
				}
				if (this.localServer) {
					if (this.localServer.port !== mcpSettings.serverPort || this.localServer.authToken !== mcpSettings.serverAuthToken) {
						await this.localServer.stop().catch(console.error);
						this.localServer = new ServerCtor(this.plugin, mcpSettings.serverPort, mcpSettings.serverAuthToken);
						await this.localServer.start().catch(e => {
							new Notice(t('uiMessages.mcpLocalServerStartFailed', { error: e.message }));
							this.localServer = null;
						});
						if (this.localServer) {
							if (mcpSettings.serverPort !== this.localServer.port) {
								mcpSettings.serverPort = this.localServer.port;
								await this.plugin.saveSettings();
							}
							new Notice(t('uiMessages.mcpLocalServerRestarted', { port: mcpSettings.serverPort }));
						}
					}
				} else {
					if (mcpSettings.serverPort) {
						this.localServer = new ServerCtor(this.plugin, mcpSettings.serverPort, mcpSettings.serverAuthToken);
						await this.localServer.start().catch(e => {
							new Notice(t('uiMessages.mcpLocalServerStartFailed', { error: e.message }));
							this.localServer = null;
						});
						if (this.localServer) {
							if (mcpSettings.serverPort !== this.localServer.port) {
								mcpSettings.serverPort = this.localServer.port;
								await this.plugin.saveSettings();
							}
							new Notice(t('uiMessages.mcpLocalServerStarted', { port: mcpSettings.serverPort }));
						}
					}
				}
			} else {
				if (this.localServer) {
					const oldPort = this.localServer.port;
					await this.localServer.stop().catch(console.error);
					this.localServer = null;
					new Notice(t('uiMessages.mcpLocalServerStopped', { port: oldPort }));
				}
			}

			// ─── 1.5 내장 MCP 서버용 클라이언트 자동 연결 ───
			// 사용자가 이미 동일한 URL로 외부 서버를 등록했으면 내장 클라이언트 생략 (ping-pong 방지)
			const localSSEUrl = `http://localhost:${mcpSettings.serverPort}/sse`;
			const userHasLocalConfig = configs.some(c => 
				c.enabled && c.transport === 'sse' && c.url === localSSEUrl
			);

			if (this.localServer && mcpSettings.clientToolsEnabled && !userHasLocalConfig) {
				const localConfig: McpServerConfig = {
					id: LOCAL_MCP_CLIENT_ID,
					name: 'Lumina Built-in',
					transport: 'sse',
					url: localSSEUrl,
					authToken: mcpSettings.serverAuthToken,
					enabled: true,
					status: 'connecting',
				};

				const existingClient = this.clients.get(LOCAL_MCP_CLIENT_ID);
				if (existingClient) {
					if (existingClient.config.url !== localConfig.url ||
						existingClient.config.authToken !== localConfig.authToken) {
						await existingClient.disconnect().catch(e => debugLogger.logError('mcp', e));
						this.clients.delete(LOCAL_MCP_CLIENT_ID);
						debugLogger.logSystem('mcp', '내장 MCP 서버 설정 변경 감지, 재연결 시도...');
					}
				}

				if (!this.clients.has(LOCAL_MCP_CLIENT_ID)) {
					const client = new ClientCtor(localConfig);
					this.clients.set(LOCAL_MCP_CLIENT_ID, client);
					const connectP = client.connect().then(() => {
						localConfig.status = 'connected';
						debugLogger.logSystem('mcp', `✅ 내장 MCP 서버 연결 성공 (툴 ${client.availableTools.length}개)`);
					});
					const timeoutP = new Promise<void>((_, reject) => window.setTimeout(() => reject(new Error('Connection timeout')), 15000));
					Promise.race([connectP, timeoutP]).catch(e => {
						debugLogger.logError('mcp', e instanceof Error ? e : new Error(`내장 MCP 서버 연결 실패: ${e}`));
						this.clients.delete(LOCAL_MCP_CLIENT_ID);
						client.disconnect().catch(() => {});
						if (this.plugin.settings.chat.agentEnabled) {
							this.plugin.settings.chat.agentEnabled = false;
							this.plugin.saveSettings().catch(() => {});
							new Notice(t('uiMessages.mcpLocalServerDisconnectAgentDisabled'));
						}
					});
				}
			} else {
				// 내장 서버 비활성화 시 클라이언트 제거
				const localClient = this.clients.get(LOCAL_MCP_CLIENT_ID);
				if (localClient) {
					await localClient.disconnect().catch(e => debugLogger.logError('mcp', e));
					this.clients.delete(LOCAL_MCP_CLIENT_ID);
					debugLogger.logSystem('mcp', '내장 MCP 클라이언트 제거됨');
				}
			}

			// ─── 2. Remove clients that are no longer in config or disabled ───
			for (const [id, client] of this.clients.entries()) {
				if (id === LOCAL_MCP_CLIENT_ID) continue; // 내장 서버 클라이언트는 여기서 제거하지 않음
				const config = configs.find(c => c.id === id);
				if (!config || !config.enabled) {
					await client.disconnect().catch(console.error);
					this.clients.delete(id);
					if (config) {
						config.status = 'disconnected';
						new Notice(t('uiMessages.mcpClientDisconnected', { name: config.name }));
					}
				}
			}

	// ─── 3. Add or update clients ───
			const CONNECT_TIMEOUT = 15000; // 15초 타임아웃
			const connectPromises: Promise<void>[] = [];
			for (const config of configs) {
				if (config.enabled && !this.clients.has(config.id)) {
					config.status = 'connecting';
					const client = new ClientCtor(config);
					this.clients.set(config.id, client);

				const p = client.connect().then(() => {
					config.status = 'connected';
					new Notice(t('uiMessages.mcpClientConnected', { name: config.name }));
				});

				// 타임아웃 처리: Promise.race로 먼저 해결된 결과만 취하고, 나머지는 abort
				const timeoutPromise = new Promise<void>((_, reject) => {
					window.setTimeout(() => reject(new Error('Connection timeout')), CONNECT_TIMEOUT);
				});

				connectPromises.push(Promise.race([p, timeoutPromise]).catch(e => {
					if (config.status === 'connecting') {
						debugLogger.logError('mcp', e instanceof Error ? e : new Error(`Failed to connect to MCP server ${config.name}`));
						config.status = 'disconnected';
						config.enabled = false;
						this.clients.delete(config.id);
						client.disconnect().catch(() => {});
						new Notice(t('uiMessages.mcpConnectFailed', { name: config.name }));
					}
				}));
				}
			}
			// 모든 연결 시도가 완료될 때까지 기다림
			if (connectPromises.length > 0) {
				await Promise.all(connectPromises);
			}
			// 이미 연결 유지 중인 클라이언트들의 status를 connected로 동기화
			for (const config of configs) {
				if (config.enabled && this.clients.has(config.id)) {
					config.status = 'connected';
				}
			}
			// 모든 연결 완료 후 한 번에 설정 저장
			await this.plugin.saveSettings();
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
							_serverName: client.config.name
						});
					}
				}
			}
		debugLogger.logSystem('mcp', `getAllTools: ${this.clients.size}개 클라이언트에서 ${Array.from(toolsMap.values()).length}개 툴 수집`);
		return Array.from(toolsMap.values());
	}

	private isDangerousTool(toolName: string): boolean {
		const lower = toolName.toLowerCase();
		const dangerousPatterns = [
			/^write/i, /write$/i,
			/^execute/i, /execute$/i,
			/^run/i, /run$/i,
			/^delete/i, /delete$/i,
			/^remove/i, /remove$/i,
			/^update/i, /update$/i,
			/^mkdir/i,
			/\bshell\b/i,
			/\bcmd\b/i,
			/\bbash\b/i
		];
		return dangerousPatterns.some(pattern => pattern.test(lower));
	}

	async callTool(serverId: string, toolName: string, args: any): Promise<any> {
		const client = this.clients.get(serverId);
		if (!client) throw new Error(`MCP server ${serverId} is not connected.`);

		if (this.isDangerousTool(toolName)) {
			const modal = new McpPermissionModal(this.plugin.app, client.config.name, toolName, args);
			const approved = await modal.waitForResponse();
			if (!approved) {
				return {
					isError: true,
					content: [{ type: 'text', text: t('uiMessages.toolExecutionRejected') }]
					};
				}
		}

		try {
			return await client.callTool(toolName, args);
		} catch (e) {
			debugLogger.logError('mcp', e instanceof Error ? e : new Error(`Failed to execute tool ${toolName} on server ${client.config.name}`));
			client.config.status = 'error';
			// 일시적 오류로 인한 전체 서버 비활성화 방지: enabled는 그대로 유지하고 상태만 error로 표시
			// 사용자가 다시 시도하거나 재연결할 수 있도록 함
			this.clients.delete(serverId);
			client.disconnect().catch(console.error);
			
			new Notice(t('uiMessages.mcpClientToolExecutionFailedStatusError', { name: client.config.name }));
			
			if (serverId === LOCAL_MCP_CLIENT_ID && this.plugin.settings.chat.agentEnabled) {
				this.plugin.settings.chat.agentEnabled = false;
				new Notice(t('uiMessages.mcpLocalServerDisconnectAgentDisabled'));
			}
			
			await this.plugin.saveSettings();
			
			return {
				isError: true,
				content: [{ type: 'text', text: t('uiMessages.mcpClientToolExecuteFailedTryReconnect', { name: client.config.name }) }]
			};
		}
	}

	async restartServer(serverId: string): Promise<void> {
		const client = this.clients.get(serverId);
		if (client) {
			await client.disconnect().catch(console.error);
			this.clients.delete(serverId);
		}
		const config = this.plugin.settings.mcp.servers.find(c => c.id === serverId);
		if (config) {
			config.status = 'disconnected';
		}
		await this.syncServers();
	}
	
	async destroy(): Promise<void> {
		// 내장 클라이언트 먼저 해제
		const localClient = this.clients.get(LOCAL_MCP_CLIENT_ID);
		if (localClient) {
			await localClient.disconnect().catch(console.error);
		}
		for (const client of this.clients.values()) {
			await client.disconnect().catch(console.error);
		}
		this.clients.clear();

		if (this.localServer) {
			await this.localServer.stop().catch(console.error);
			this.localServer = null;
		}
	}
}
