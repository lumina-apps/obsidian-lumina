import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { debugLogger } from '../../shared/debugLogger';
import type { McpServerConfig } from '../../shared/types/settings.types';
import { Platform } from 'obsidian';

export class LuminaMcpClient {
	private client: Client;
	private transport: StdioClientTransport | SSEClientTransport | null = null;
	public config: McpServerConfig;
	public availableTools: any[] = [];

	constructor(config: McpServerConfig) {
		this.config = config;
		this.client = new Client({
			name: 'Lumina',
			version: '1.0.0'
		}, {
			capabilities: {
				tools: {}
			} as any
		});
	}

	async connect(): Promise<void> {
		if (this.config.transport === 'stdio') {
			if (Platform.isMobile) {
				throw new Error('stdio transport is not supported on mobile');
			}
			const command = this.config.command;
			if (!command) throw new Error('Command is required for stdio transport');
			
			const env = { ...process.env, ...this.config.env };
			
			this.transport = new StdioClientTransport({
				command,
				args: this.config.args || [],
				env: env as Record<string, string>
			});
	} else {
			let url = this.config.url;
			if (!url) throw new Error('URL is required for SSE transport');
			const urlObj = new URL(url);
			const opts: any = {};
			
			if (this.config.authToken) {
				const headers = { Authorization: `Bearer ${this.config.authToken}` };
				opts.eventSourceInit = { headers };
				opts.requestInit = { headers };
			}
			
			this.transport = new SSEClientTransport(urlObj, opts);
			}

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

	async callTool(name: string, args: any): Promise<any> {
		return await this.client.callTool({ name, arguments: args ?? {} });
	}

	async disconnect(): Promise<void> {
		if (this.transport) {
			await this.transport.close();
			this.transport = null;
		}
	}
}
