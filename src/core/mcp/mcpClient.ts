import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { debugLogger } from '../../shared/debugLogger';
import type { McpServerConfig } from '../../shared/types/settings.types';

export interface McpTool {
	name: string;
	description?: string;
	inputSchema: {
		type: 'object';
		properties?: Record<string, unknown>;
		required?: string[];
	};
	_serverId?: string;
	_serverName?: string;
}

export class LuminaMcpClient {
	private client: Client;
	private transport: SSEClientTransport | null = null;
	public config: McpServerConfig;
	public availableTools: McpTool[] = [];

	constructor(config: McpServerConfig) {
		this.config = config;
		this.client = new Client({
			name: 'Lumina',
			version: '1.0.0'
		}, {
			capabilities: {}
		});
	}

	async connect(): Promise<void> {
		let url = this.config.url;
		if (!url) throw new Error('URL is required for SSE transport');
		const urlObj = new URL(url);
		let opts: import('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransportOptions = {};
		
		if (this.config.authToken) {
			const headers = { Authorization: `Bearer ${this.config.authToken}` };
			opts = {
				eventSourceInit: { headers } as unknown as EventSourceInit,
				requestInit: { headers }
			};
		}
		
		this.transport = new SSEClientTransport(urlObj, opts);

		await this.client.connect(this.transport);
		await this.refreshTools();
	}

	async refreshTools(): Promise<void> {
		try {
			const response = await this.client.listTools();
			this.availableTools = response.tools;
		} catch (error) {
			debugLogger.logError('mcp', error instanceof Error ? error : new Error(`Failed to list tools for ${this.config.name}: ${error}`));
			this.availableTools = [];
		}
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		return await this.client.callTool({ name, arguments: args ?? {} });
	}

	async disconnect(): Promise<void> {
		if (this.transport) {
			await this.transport.close();
			this.transport = null;
		}
	}
}
