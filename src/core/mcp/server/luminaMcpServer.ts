import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type LuminaPlugin from '../../../main';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import { SafeJsonSchemaValidator } from '../safeValidator';
import { getToolDefinitions } from './toolDefinitions';
import { dispatchToolHandler } from './toolHandlers';
import { HttpTransport } from './httpTransport';
import { PathGuard } from './pathGuard';
import type { ToolArguments, ToolHandlerContext, McpLimits } from './types';

export class LuminaMcpServer {
	private server: McpServer;
	private httpTransport: HttpTransport;
	private pathGuard: PathGuard;
	private plugin: LuminaPlugin;
	public port: number;
	public authToken: string;

	constructor(plugin: LuminaPlugin, port: number, authToken: string) {
		this.plugin = plugin;
		this.port = port;
		this.authToken = authToken;

		this.httpTransport = new HttpTransport(port, authToken);
		this.pathGuard = new PathGuard();

		this.server = new McpServer(
			{
				name: 'Lumina-MCP-Server',
				version: '1.0.0',
			},
			{
				capabilities: {
					tools: {},
				},
				jsonSchemaValidator: new SafeJsonSchemaValidator(),
			},
		);

		this.registerTools();
	}

	// ─── 설정에서 제한값 추출 ────────────────────────────────────────────────

	private getLimits(): McpLimits {
		const mcpSettings = this.plugin.settings.mcp;
		return {
			limitRead: mcpSettings.serverMaxReadChars || 20000,
			limitAppend: mcpSettings.serverMaxAppendChars || 10000,
			snippetLen: mcpSettings.serverSearchSnippetLength || 300,
			maxResults: mcpSettings.serverSearchMaxResults || 10,
		};
	}

	private buildContext(): ToolHandlerContext {
		const limits = this.getLimits();
		return {
			plugin: this.plugin,
			...limits,
		};
	}

	// ─── MCP 핸들러 등록 ─────────────────────────────────────────────────────

	private registerTools(): void {
		// ListTools 핸들러
		this.server.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return {
				tools: getToolDefinitions(),
			};
		});

		// CallTool 핸들러
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
			const { name, arguments: rawArgs } = request.params;
			const args: ToolArguments = (rawArgs as Record<string, unknown>) ?? {};
			const ctx = this.buildContext();

			try {
				return await dispatchToolHandler(name, args, ctx, this.pathGuard);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				debugLogger.logError('mcp', e instanceof Error ? e : new Error(message));
				return {
					isError: true,
					content: [{ type: 'text' as const, text: t('mcpServerTools.common.executionError', { error: message }) }],
				};
			}
		});
	}

	// ─── 수명주기 ────────────────────────────────────────────────────────────

	async start(): Promise<void> {
		await this.httpTransport.start(this.server);
		this.port = this.httpTransport.port; // 실제 바인딩된 포트 반영
	}

	async stop(): Promise<void> {
		await this.httpTransport.stop();
	}
}