import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpManager } from './mcpManager';
import { Platform } from 'obsidian';
import { approvalManager } from '../store/approvalStore';

// ─── 1. Platform Mocking ────────────────────────────────────────────────────
vi.mock('obsidian', () => {
	const mockPlatform = {
		isDesktop: true, // Desktop으로 강제 설정하여 MCP 지원을 활성화
		isMobile: false,
	};
	return {
		Platform: mockPlatform,
		Notice: vi.fn(),
	};
});

// ─── 2. approvalManager Mocking ──────────────────────────────────────────────
vi.mock('../store/approvalStore', () => {
	return {
		approvalManager: {
			requestActionApproval: vi.fn().mockResolvedValue(true),
		},
	};
});

// ─── 3. LuminaMcpClient Mocking ──────────────────────────────────────────────
vi.mock('./mcpClient', () => {
	return {
		LuminaMcpClient: class {
			public config: any;
			public availableTools: any[] = [];
			constructor(config: any) {
				this.config = config;
				if (config.id === 'external-server-1') {
					this.availableTools = [
						{
							name: 'read_note',
							description: 'Read a note content',
							inputSchema: { type: 'object' },
						},
						{
							name: 'delete_note', // 위험 도구로 등록되어 사용자 승인이 필요한 툴
							description: 'Delete a note file',
							inputSchema: { type: 'object' },
						},
					];
				}
			}
			async connect() {
				this.config.status = 'connected';
			}
			async refreshTools() {}
			async callTool(name: string, args: Record<string, unknown>) {
				if (name === 'read_note') {
					return { content: [{ type: 'text', text: 'Mock note content' }] };
				}
				if (name === 'delete_note') {
					return { content: [{ type: 'text', text: 'Deleted note successfully' }] };
				}
				throw new Error('Tool not found');
			}
			async disconnect() {
				this.config.status = 'disconnected';
			}
		},
	};
});

// ─── 4. LuminaMcpServer Mocking ──────────────────────────────────────────────
vi.mock('./server/luminaMcpServer', () => {
	return {
		LuminaMcpServer: class {
			public port: number;
			public authToken: string;
			constructor(config: any) {
				this.port = config.serverPort;
				this.authToken = config.serverAuthToken;
			}
			async start() {}
			async stop() {}
		},
	};
});

// ─── 5. handlerRegistry Mocking ──────────────────────────────────────────────
vi.mock('./server/handlerRegistry', () => ({
	dispatchToolHandler: vi.fn().mockResolvedValue({
		content: [{ type: 'text', text: 'In-memory tool result' }],
	}),
}));

describe('MCP Lifecycle & Integration', () => {
	let mockPlugin: any;
	let mcpManager: McpManager;

	beforeEach(() => {
		vi.clearAllMocks();

		mockPlugin = {
			settings: {
				chat: {
					agentExecutionMode: 'read', // 기본값: read (위험 도구 차단)
				},
				mcp: {
					servers: [
						{
							id: 'external-server-1',
							name: 'Test External Server',
							transport: 'sse',
							url: 'http://localhost:5001/sse',
							enabled: true,
							status: 'disconnected',
						},
					],
					serverEnabled: false,
					serverPort: 8080,
					serverAuthToken: 'token-1234',
					clientToolsEnabled: false,
				},
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
			refreshSettingTab: vi.fn(),
		};

		mcpManager = new McpManager(mockPlugin);
		mockPlugin.mcpManager = mcpManager;
	});

	it('should sync servers and connect enabled clients', async () => {
		// 1. syncServers() 호출
		await mcpManager.syncServers();

		// 외부 서버가 connected 상태가 되었는지 확인
		const externalClient = mcpManager.clients.get('external-server-1');
		expect(externalClient).toBeDefined();
		expect(externalClient?.config.status).toBe('connected');

		// 2. 등록된 도구 목록 수집 검증
		const tools = mcpManager.getAllTools();
		expect(tools.length).toBe(2);
		expect(tools.map(t => t.name)).toContain('read_note');
		expect(tools.map(t => t.name)).toContain('delete_note');
	});

	it('should block dangerous tool execution in read mode', async () => {
		await mcpManager.syncServers();

		// read 모드인 상태에서 delete_note(위험 도구) 실행 요청
		mockPlugin.settings.chat.agentExecutionMode = 'read';

		const result: any = await mcpManager.callTool('external-server-1', 'delete_note', {});
		
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Read Mode'); // 혹은 읽기 모드 에러 메시지
	});

	it('should prompt user and run dangerous tool in write mode when approved', async () => {
		await mcpManager.syncServers();

		// write 모드로 전환
		mockPlugin.settings.chat.agentExecutionMode = 'write';

		// 승인됨 상태로 모킹
		vi.mocked(approvalManager.requestActionApproval).mockResolvedValue(true);

		const result: any = await mcpManager.callTool('external-server-1', 'delete_note', {});
		
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain('Deleted note successfully');
		expect(approvalManager.requestActionApproval).toHaveBeenCalled();
	});

	it('should abort dangerous tool execution in write mode when user rejects', async () => {
		await mcpManager.syncServers();

		mockPlugin.settings.chat.agentExecutionMode = 'write';

		// 거절됨 상태로 모킹
		vi.mocked(approvalManager.requestActionApproval).mockResolvedValue(false);

		const result: any = await mcpManager.callTool('external-server-1', 'delete_note', {});
		
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('rejected'); // 거부 메시지 포함 여부
	});

	it('should expose and execute built-in tools in-memory when agentEnabled is true even if serverEnabled is false', async () => {
		const { dispatchToolHandler } = await import('./server/handlerRegistry');
		mockPlugin.settings.chat.agentEnabled = true;
		mockPlugin.settings.chat.agentExecutionMode = 'edit';
		mockPlugin.settings.mcp.serverEnabled = false;
		mockPlugin.settings.mcp.clientToolsEnabled = true;

		const tools = mcpManager.getAllTools();
		const readNoteTool = tools.find((t) => t.name === 'read_note');
		expect(readNoteTool).toBeDefined();
		expect(readNoteTool?._serverId).toBe('__lumina_local__');

		const result: any = await mcpManager.callTool('__lumina_local__', 'read_note', { path: 'test.md' });
		expect(dispatchToolHandler).toHaveBeenCalledWith(
			'read_note',
			{ path: 'test.md' },
			expect.objectContaining({ plugin: mockPlugin }),
			expect.anything(),
		);
		expect(result.content[0].text).toBe('In-memory tool result');
	});

	it('should block dangerous built-in tools in read mode without calling handlerRegistry', async () => {
		const { dispatchToolHandler } = await import('./server/handlerRegistry');
		mockPlugin.settings.chat.agentEnabled = true;
		mockPlugin.settings.chat.agentExecutionMode = 'read';

		const result: any = await mcpManager.callTool('__lumina_local__', 'delete_note', { path: 'test.md' });
		expect(result.isError).toBe(true);
		expect(dispatchToolHandler).not.toHaveBeenCalled();
	});

	it('should expose pathGuard even when localServer is not running', () => {
		expect(mcpManager.localServer).toBeNull();
		expect(mcpManager.pathGuard).toBeDefined();
		expect(typeof mcpManager.pathGuard.isAgentPathAllowed).toBe('function');
	});

	it('모바일 환경에서는 syncServers()가 조기 반환하고 run_shell_command 없이 내장 에이전트 도구만 노출한다', async () => {
		(Platform as { isDesktop: boolean }).isDesktop = false;
		(Platform as { isMobile: boolean }).isMobile = true;
		try {
			mockPlugin.settings.chat.agentEnabled = true;
			mockPlugin.settings.mcp.serverEnabled = true;
			mockPlugin.settings.mcp.serverEnableShellCommands = true;
			mockPlugin.settings.mcp.clientToolsEnabled = true;

			await mcpManager.syncServers();

			expect(mcpManager.localServer).toBeNull();
			expect(mcpManager.clients.size).toBe(0);

			const tools = mcpManager.getAllTools();
			expect(tools.some((t) => t.name === 'read_note')).toBe(true);
			expect(tools.some((t) => t.name === 'run_shell_command')).toBe(false);
		} finally {
			(Platform as { isDesktop: boolean }).isDesktop = true;
			(Platform as { isMobile: boolean }).isMobile = false;
		}
	});
});
