import { Notice } from 'obsidian';
import type LuminaPlugin from '../../main';
import type { LuminaMcpServer } from './server/luminaMcpServer';
import { debugLogger } from '../../shared/debugLogger';
import { formatMcpError, MCP_CONNECT_TIMEOUT, withTimeout } from '../../shared/utils/mcpUtils';
import { t } from '../../shared/locales/helpers';
import type { McpServerConfig, McpSettings } from '../../shared/types/settings.types';

const LOCAL_MCP_CLIENT_ID = '__lumina_local__';

/**
 * 내장 MCP 서버의 시작/중지 생명주기와 내장 클라이언트 자동 연결을 관리합니다.
 * mcpManager.ts에서 추출된 책임입니다.
 */
export class LocalServerLifecycle {
	private plugin: LuminaPlugin;
	public server: LuminaMcpServer | null = null;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	/**
	 * 내장 MCP 서버를 설정 상태에 따라 시작/중지/재시작합니다.
	 * syncServers()의 1단계 로직입니다.
	 */
	async syncServer(): Promise<void> {
		const { LuminaMcpServer: ServerCtor } = await import('./server/luminaMcpServer');
		const mcpSettings = this.plugin.settings.mcp;

		if (!mcpSettings.serverEnabled) {
			await this.stopServer();
			return;
		}

		// authToken 미설정 시 생성
		if (!mcpSettings.serverAuthToken) {
			mcpSettings.serverAuthToken = crypto.randomUUID();
			await this.plugin.saveSettings();
		}

		// 이미 서버가 실행 중이면 설정 변화에 따라 재시작
		if (this.server) {
			if (this.server.port !== mcpSettings.serverPort || this.server.authToken !== mcpSettings.serverAuthToken) {
				await this.stopServer();
				await this.tryStartServer(ServerCtor, mcpSettings);
			}
			return;
		}

		// 서버가 없고 포트가 설정되어 있으면 시작
		if (mcpSettings.serverPort) {
			await this.tryStartServer(ServerCtor, mcpSettings);
		}
	}

	/**
	 * 내장 MCP 서버에 연결되는 로컬 클라이언트를 동기화합니다.
	 * syncServers()의 1.5단계 로직입니다.
	 */
	async syncLocalClient(): Promise<void> {
		const { LuminaMcpClient: ClientCtor } = await import('./mcpClient');
		const mcpSettings = this.plugin.settings.mcp;
		const configs = this.plugin.settings.mcp.servers;

		const localSSEUrl = `http://localhost:${mcpSettings.serverPort}/sse`;
		const userHasLocalConfig = configs.some(
			(c) => c.enabled && c.transport === 'sse' && c.url === localSSEUrl,
		);

		if (!this.server || !mcpSettings.clientToolsEnabled || userHasLocalConfig) {
			// 내장 서버 비활성화 또는 외부 등록 충돌 시 클라이언트 제거
			await this.disconnectLocalClient();
			return;
		}

		const localConfig: McpServerConfig = {
			id: LOCAL_MCP_CLIENT_ID,
			name: 'Lumina Built-in',
			transport: 'sse',
			url: localSSEUrl,
			authToken: mcpSettings.serverAuthToken,
			enabled: true,
			status: 'connecting',
		};

		const existingClient = this.plugin.mcpManager.clients.get(LOCAL_MCP_CLIENT_ID);
		if (existingClient) {
			if (
				existingClient.config.url !== localConfig.url ||
				existingClient.config.authToken !== localConfig.authToken
			) {
				await existingClient.disconnect().catch((e: unknown) => debugLogger.logError('mcp', formatMcpError(e)));
				this.plugin.mcpManager.clients.delete(LOCAL_MCP_CLIENT_ID);
				debugLogger.logSystem('mcp', '내장 MCP 서버 설정 변경 감지, 재연결 시도...');
			} else {
				return; // 이미 연결됨
			}
		}

		if (this.plugin.mcpManager.clients.has(LOCAL_MCP_CLIENT_ID)) return;

		const client = new ClientCtor(localConfig);
		this.plugin.mcpManager.clients.set(LOCAL_MCP_CLIENT_ID, client);

		try {
			await withTimeout(client.connect(), MCP_CONNECT_TIMEOUT, 'Connection timeout');
			localConfig.status = 'connected';
			debugLogger.logSystem('mcp', `✅ 내장 MCP 서버 연결 성공 (툴 ${client.availableTools.length}개)`);
		} catch (e) {
			debugLogger.logError('mcp', formatMcpError(e, `내장 MCP 서버 연결 실패`));
			this.plugin.mcpManager.clients.delete(LOCAL_MCP_CLIENT_ID);
			client.disconnect().catch(() => {});
			mcpSettings.serverEnabled = false;
			await this.stopServer();
			this.plugin.settings.chat.agentEnabled = false;
			await this.plugin.saveSettings();
			this.plugin.refreshSettingTab();
			new Notice(t('uiMessages.mcpLocalServerDisconnectAgentDisabled'));
		}
	}

	/**
	 * 로컬 서버 실행 실패 시 서버/에이전트 비활성화 정리.
	 * callTool 실패 시에도 재사용됩니다.
	 */
	async teardownServer(): Promise<void> {
		const mcpSettings = this.plugin.settings.mcp;
		mcpSettings.serverEnabled = false;
		await this.stopServer();
		if (this.plugin.settings.chat.agentEnabled) {
			this.plugin.settings.chat.agentEnabled = false;
			new Notice(t('uiMessages.mcpLocalServerDisconnectAgentDisabled'));
		}
		await this.plugin.saveSettings();
		this.plugin.refreshSettingTab();
	}

	/** 로컬 클라이언트 연결을 해제합니다. */
	async disconnectLocalClient(): Promise<void> {
		const localClient = this.plugin.mcpManager.clients.get(LOCAL_MCP_CLIENT_ID);
		if (localClient) {
			await localClient.disconnect().catch((e: unknown) => debugLogger.logError('mcp', formatMcpError(e)));
			this.plugin.mcpManager.clients.delete(LOCAL_MCP_CLIENT_ID);
			debugLogger.logSystem('mcp', '내장 MCP 클라이언트 제거됨');
		}
	}

	/** 서버를 완전히 중지하고 null로 설정합니다. */
	async stopServer(): Promise<void> {
		if (this.server) {
			const oldPort = this.server.port;
			await this.server.stop().catch(console.error);
			this.server = null;
			new Notice(t('uiMessages.mcpLocalServerStopped', { port: oldPort }));
		}
	}

	// ─── private ────────────────────────────────────────────────────────────

	private async tryStartServer(
		ServerCtor: new (plugin: LuminaPlugin, port: number, authToken: string) => LuminaMcpServer,
		mcpSettings: McpSettings,
	): Promise<void> {
		try {
			this.server = new ServerCtor(this.plugin, mcpSettings.serverPort, mcpSettings.serverAuthToken);
			await this.server.start();

			// 실제 바인딩된 포트 반영
			if (mcpSettings.serverPort !== this.server.port) {
				mcpSettings.serverPort = this.server.port;
				await this.plugin.saveSettings();
			}
			new Notice(t('uiMessages.mcpLocalServerStarted', { port: mcpSettings.serverPort }));
		} catch (e: unknown) {
			const msg = formatMcpError(e).message;
			new Notice(t('uiMessages.mcpLocalServerStartFailed', { error: msg }));
			this.server = null;
			mcpSettings.serverEnabled = false;
			this.plugin.settings.chat.agentEnabled = false;
			await this.plugin.saveSettings();
			this.plugin.refreshSettingTab();
		}
	}
}