import { Notice } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import { formatMcpError, MCP_CONNECT_TIMEOUT, withTimeout } from '../../shared/utils/mcpUtils';
import { t } from '../../shared/locales/helpers';
import type { McpServerConfig } from '../../shared/types/settings.types';
import type { LuminaMcpClient } from './mcpClient';

const LOCAL_MCP_CLIENT_ID = '__lumina_local__';

/**
 * 외부 MCP 클라이언트 연결 동기화를 담당합니다.
 * mcpManager.ts의 2단계(비활성 클라이언트 제거)와 3단계(신규 클라이언트 연결) 로직을 추출했습니다.
 */
export class ClientConnectionSync {
	private clients: Map<string, LuminaMcpClient>;

	constructor(clients: Map<string, LuminaMcpClient>) {
		this.clients = clients;
	}

	/**
	 * 설정에서 제거되었거나 비활성화된 외부 클라이언트를 연결 해제합니다.
	 * syncServers()의 2단계 로직입니다.
	 */
	async removeStaleClients(configs: McpServerConfig[]): Promise<void> {
		for (const [id, client] of this.clients.entries()) {
			if (id === LOCAL_MCP_CLIENT_ID) continue; // 내장 서버 클라이언트는 여기서 제거하지 않음
			const config = configs.find((c) => c.id === id);
			if (!config || !config.enabled) {
				await client.disconnect().catch(console.error);
				this.clients.delete(id);
				if (config) {
					config.status = 'disconnected';
					new Notice(t('uiMessages.mcpClientDisconnected', { name: config.name }));
				}
			}
		}
	}

	/**
	 * 활성화된 외부 클라이언트를 신규 연결하고 상태를 동기화합니다.
	 * syncServers()의 3단계 로직입니다.
	 */
	async connectNewClients(configs: McpServerConfig[]): Promise<void> {
		const { LuminaMcpClient: ClientCtor } = await import('./mcpClient');
		const connectPromises: Promise<void>[] = [];

		for (const config of configs) {
			if (!config.enabled || this.clients.has(config.id)) continue;

			config.status = 'connecting';
			const client = new ClientCtor(config);
			this.clients.set(config.id, client);

			const p = withTimeout(client.connect(), MCP_CONNECT_TIMEOUT, 'Connection timeout')
				.then(() => {
					config.status = 'connected';
					new Notice(t('uiMessages.mcpClientConnected', { name: config.name }));
				})
				.catch((e: unknown) => {
					if (config.status === 'connecting') {
						debugLogger.logError('mcp', formatMcpError(e, `Failed to connect to MCP server ${config.name}`));
						config.status = 'disconnected';
						config.enabled = false;
						this.clients.delete(config.id);
						client.disconnect().catch(() => {});
						new Notice(t('uiMessages.mcpConnectFailed', { name: config.name }));
					}
				});

			connectPromises.push(p);
		}

		if (connectPromises.length > 0) {
			await Promise.all(connectPromises);
		}
	}

	/** 이미 연결 유지 중인 클라이언트들의 상태를 'connected'로 동기화합니다. */
	syncClientStatuses(configs: McpServerConfig[]): void {
		for (const config of configs) {
			if (config.enabled && this.clients.has(config.id)) {
				config.status = 'connected';
			}
		}
	}
}