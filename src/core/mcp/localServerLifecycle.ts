import { Notice } from 'obsidian';
import type LuminaPlugin from '../../main';
import type { LuminaMcpServer } from './server/luminaMcpServer';
import { debugLogger } from '../../shared/debugLogger';
import { formatMcpError } from '../../shared/utils/mcpUtils';
import { t } from '../../shared/locales/helpers';
import type { McpSettings } from '../../shared/types/settings.types';

/**
 * 외부 클라이언트 연동용 내장 HTTP MCP 서버의 시작/중지 생명주기를 관리합니다.
 * 내장 에이전트는 MCPManager를 통해 메모리에서 직접 도구를 실행하므로 HTTP 서버에 의존하지 않습니다.
 */
import { CliMcpSync } from './cliMcpSync';

export class LocalServerLifecycle {
	private plugin: LuminaPlugin;
	public server: LuminaMcpServer | null = null;
	public cliMcpSync: CliMcpSync;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
		this.cliMcpSync = new CliMcpSync(plugin.app);
	}

	/**
	 * 내장 HTTP MCP 서버를 설정 상태에 따라 시작/중지/재시작합니다.
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
			} else {
				if (mcpSettings.syncCliMcp) {
					void this.cliMcpSync.sync({
						port: mcpSettings.serverPort,
						authToken: mcpSettings.serverAuthToken,
					});
				} else {
					void this.cliMcpSync.cleanup();
				}
			}
			return;
		}

		// 서버가 없고 포트가 설정되어 있으면 시작
		if (mcpSettings.serverPort) {
			await this.tryStartServer(ServerCtor, mcpSettings);
		}
	}

	/**
	 * 로컬 HTTP 서버 실행 실패 시 서버 설정 정리.
	 */
	async teardownServer(): Promise<void> {
		const mcpSettings = this.plugin.settings.mcp;
		mcpSettings.serverEnabled = false;
		await this.stopServer();
		await this.plugin.saveSettings();
		this.plugin.refreshSettingTab();
	}

	/** 서버를 완전히 중지하고 null로 설정합니다. */
	async stopServer(): Promise<void> {
		if (this.server) {
			const oldPort = this.server.port;
			await this.server.stop().catch((err: unknown) => {
				debugLogger.logError('mcp', formatMcpError(err, 'Failed to stop local MCP server'));
			});
			this.server = null;
			void this.cliMcpSync.cleanup();
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
			if (mcpSettings.syncCliMcp) {
				void this.cliMcpSync.sync({
					port: mcpSettings.serverPort,
					authToken: mcpSettings.serverAuthToken,
				});
			} else {
				void this.cliMcpSync.cleanup();
			}
			new Notice(t('uiMessages.mcpLocalServerStarted', { port: mcpSettings.serverPort }));
		} catch (e: unknown) {
			const msg = formatMcpError(e).message;
			new Notice(t('uiMessages.mcpLocalServerStartFailed', { error: msg }));
			this.server = null;
			mcpSettings.serverEnabled = false;
			await this.plugin.saveSettings();
			this.plugin.refreshSettingTab();
		}
	}
}