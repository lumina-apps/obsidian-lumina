import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type LuminaPlugin from '../../../main';
import { debugLogger } from '../../../shared/debugLogger';
import { formatMcpError } from '../../../shared/utils/mcpUtils';
import { t } from '../../../shared/locales/helpers';
import { SafeJsonSchemaValidator } from '../safeValidator';
import { getToolDefinitions } from './toolDefinitions';
import { dispatchToolHandler } from './handlerRegistry';
import { HttpTransport } from './httpTransport';
import { PathGuard } from './pathGuard';
import type { ToolArguments, ToolHandlerContext, McpLimits } from './toolTypes';

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
		this.server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
			const { name, arguments: rawArgs } = request.params;
			const args: ToolArguments = (rawArgs as Record<string, unknown>) ?? {};
			const ctx = this.buildContext();

			try {
				const result = await dispatchToolHandler(name, args, ctx, this.pathGuard);
				return result;
			} catch (e) {
				const message = formatMcpError(e).message;
				debugLogger.logError('mcp', formatMcpError(e));
				return {
					isError: true,
					content: [{ type: 'text' as const, text: t('mcpServerTools.common.executionError', { error: message }) }],
				} as CallToolResult;
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