import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { debugLogger } from '../../shared/debugLogger';
import type { McpServerConfig } from '../../shared/types/settings.types';
import { SafeJsonSchemaValidator } from './safeValidator';

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
	private transport: StreamableHTTPClientTransport | SSEClientTransport | null = null;
	public config: McpServerConfig;
	public availableTools: McpTool[] = [];

	constructor(config: McpServerConfig) {
		this.config = config;
		this.client = new Client({
			name: 'Lumina',
			version: '1.0.0'
		}, {
			capabilities: {},
			jsonSchemaValidator: new SafeJsonSchemaValidator()
		});
	}

	async connect(): Promise<void> {
		let url = this.config.url;
		if (!url) throw new Error(`URL is required for transport (Server: ${this.config.name})`);
		const urlObj = new URL(url);
		
		// 1. Streamable HTTP 먼저 시도 (대부분의 최신 MCP 서버)
		try {
			await this._connectStreamableHttp(urlObj);
		} catch {
			// 2. 실패 시 SSE로 폴백 (레거시 SSE-only 서버 대응)
			await this._connectSse(urlObj);
		}

		await this.refreshTools();
	}

	private async _connectStreamableHttp(urlObj: URL): Promise<void> {
		const opts: import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransportOptions = {};
		if (this.config.authToken) {
			opts.requestInit = {
				headers: { Authorization: `Bearer ${this.config.authToken}` }
			};
		}
		this.transport = new StreamableHTTPClientTransport(urlObj, opts);
		await this.client.connect(this.transport);
	}

	/**
	 * Connect via SSE transport using the raw fetch API.
	 * 
	 * MCP SSE protocol:
	 * 1. GET to SSE endpoint → server streams `event: endpoint` / `data: <session_url>`
	 * 2. All subsequent POSTs go to <base_url> + <session_url>
	 * 
	 * We use AbortController to cancel the SSE stream after we receive the endpoint.
	 */
	private async _connectSse(urlObj: URL): Promise<void> {
		const authHeaders: Record<string, string> = {};
		if (this.config.authToken) {
			authHeaders['Authorization'] = `Bearer ${this.config.authToken}`;
		}

		// Step 1: GET to SSE endpoint with streaming response
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-globals
		const response = await fetch(urlObj.href, {
			headers: {
				'Accept': 'text/event-stream',
				...authHeaders,
			},
		});

		if (!response.ok) {
			throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
		}

		if (!response.body) {
			throw new Error('SSE connection failed: no response body (ReadableStream not supported)');
		}

		// Step 2: Parse SSE stream to get the session endpoint URL
		const sessionUrl = await this._parseSseEndpoint(response.body, urlObj);

		// Step 3: Pass session URL directly to SSEClientTransport.
		// SSEClientTransport will POST to this URL for all messages.
		const opts: import('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransportOptions = {
			requestInit: {
				headers: authHeaders,
			},
		};
		this.transport = new SSEClientTransport(sessionUrl, opts);
		await this.client.connect(this.transport);
	}

	/**
	 * Parse SSE stream to extract `event: endpoint` / `data: <url>`.
	 * Returns the resolved session URL.
	 */
	private async _parseSseEndpoint(
		body: ReadableStream<Uint8Array>,
		baseUrl: URL
	): Promise<URL> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				
				// Split by double newlines (SSE event boundary)
				const events = buffer.split('\n\n');
				// Keep the last (potentially incomplete) chunk in buffer
				buffer = events.pop() || '';

				for (const event of events) {
					const eventType = this._parseSseField(event, 'event');
					const data = this._parseSseField(event, 'data');
					
					if (eventType === 'endpoint' && data) {
						try {
							const endpointUrl = new URL(data.trim(), baseUrl.origin);
							void reader.cancel(); // Stop reading SSE stream
							return endpointUrl;
						} catch {
							// Try as absolute URL
							try {
								const endpointUrl = new URL(data.trim());
								void reader.cancel();
								return endpointUrl;
							} catch {
								// Ignore malformed URLs
							}
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		throw new Error('SSE stream ended without receiving an endpoint event');
	}

	/**
	 * Parse a single field line from an SSE event.
	 * SSE format: "field:value" or "field: value"
	 */
	private _parseSseField(eventText: string, field: string): string | null {
		const lines = eventText.split('\n');
		for (const line of lines) {
			if (line.startsWith(`${field}:`)) {
				return line.slice(field.length + 1).trim();
			}
			if (line.startsWith(`${field}: `)) {
				return line.slice(field.length + 2).trim();
			}
		}
		return null;
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
		return await this.client.callTool(
			{ name, arguments: args ?? {} },
			undefined,
			{ timeout: 3600000 } // 1 hour timeout for user approval
		);
	}

	async disconnect(): Promise<void> {
		if (this.transport) {
			await this.transport.close();
			this.transport = null;
		}
	}
}