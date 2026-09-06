import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CliMcpSync } from './cliMcpSync';
import { ProcessManager } from '../llm-providers/cli/process-manager';
import type { App } from 'obsidian';

vi.mock('../llm-providers/cli/process-manager', () => ({
	ProcessManager: {
		spawn: vi.fn(),
	},
}));

describe('CliMcpSync - 4대 CLI MCP 자동 동기화', () => {
	let mockApp: App;
	let files: Map<string, string>;
	let dirs: Set<string>;
	let cliMcpSync: CliMcpSync;

	beforeEach(() => {
		vi.clearAllMocks();
		files = new Map<string, string>();
		dirs = new Set<string>();

		mockApp = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => files.has(path) || dirs.has(path)),
					mkdir: vi.fn(async (path: string) => {
						dirs.add(path);
					}),
					read: vi.fn(async (path: string) => {
						const content = files.get(path);
						if (content === undefined) throw new Error(`File not found: ${path}`);
						return content;
					}),
					write: vi.fn(async (path: string, data: string) => {
						files.set(path, data);
					}),
					remove: vi.fn(async (path: string) => {
						files.delete(path);
					}),
				},
			},
		} as unknown as App;

		cliMcpSync = new CliMcpSync(mockApp);
	});

	it('Claude Code: .claude/mcp.json을 생성하고 Lumina SSE 설정을 등록한다', async () => {
		await cliMcpSync.sync({ port: 8080, authToken: 'test-token' });

		expect(dirs.has('.claude')).toBe(true);
		const raw = files.get('.claude/mcp.json');
		expect(raw).toBeDefined();
		const parsed = JSON.parse(raw!);
		expect(parsed.mcpServers.lumina).toEqual({
			url: 'http://localhost:8080/sse',
			headers: {
				Authorization: 'Bearer test-token',
			},
		});
	});

	it('Claude Code: 기존 다른 서버 설정이 있을 때 보존하며 lumina를 병합한다', async () => {
		files.set(
			'.claude/mcp.json',
			JSON.stringify({
				mcpServers: {
					other: { url: 'http://localhost:3000' },
				},
			}),
		);

		await cliMcpSync.sync({ port: 9090, authToken: 'token-2' });

		const parsed = JSON.parse(files.get('.claude/mcp.json')!);
		expect(parsed.mcpServers.other).toEqual({ url: 'http://localhost:3000' });
		expect(parsed.mcpServers.lumina.url).toBe('http://localhost:9090/sse');
	});

	it('Claude Code: cleanup 시 다른 서버가 남아있으면 lumina만 제거한다', async () => {
		files.set(
			'.claude/mcp.json',
			JSON.stringify({
				mcpServers: {
					other: { url: 'http://localhost:3000' },
					lumina: { url: 'http://localhost:9090/sse' },
				},
			}),
		);

		await cliMcpSync.cleanup();

		const parsed = JSON.parse(files.get('.claude/mcp.json')!);
		expect(parsed.mcpServers.lumina).toBeUndefined();
		expect(parsed.mcpServers.other).toBeDefined();
	});

	it('Claude Code: cleanup 시 lumina만 있던 빈 파일은 완전히 삭제한다', async () => {
		files.set(
			'.claude/mcp.json',
			JSON.stringify({
				mcpServers: {
					lumina: { url: 'http://localhost:9090/sse' },
				},
			}),
		);

		await cliMcpSync.cleanup();

		expect(files.has('.claude/mcp.json')).toBe(false);
	});

	it('OpenCode: opencode.json에 mcp.lumina 설정을 등록한다 (type: remote)', async () => {
		await cliMcpSync.sync({ port: 8080, authToken: 'test-token' });

		const raw = files.get('opencode.json');
		expect(raw).toBeDefined();
		const parsed = JSON.parse(raw!);
		expect(parsed.$schema).toBe('https://opencode.ai/config.json');
		expect(parsed.mcp.lumina).toEqual({
			type: 'remote',
			url: 'http://localhost:8080/sse',
			headers: {
				Authorization: 'Bearer test-token',
			},
		});
	});

	it('OpenCode: cleanup 시 lumina 설정을 제거하고 빈 파일은 삭제한다', async () => {
		files.set(
			'opencode.json',
			JSON.stringify({
				$schema: 'https://opencode.ai/config.json',
				mcp: {
					lumina: { type: 'remote', url: 'http://localhost:8080/sse' },
				},
			}),
		);

		await cliMcpSync.cleanup();

		expect(files.has('opencode.json')).toBe(false);
	});

	it('Codex: .codex/config.toml에 [mcp_servers.lumina] TOML 설정을 등록한다', async () => {
		await cliMcpSync.sync({ port: 8080, authToken: 'test-token' });

		expect(dirs.has('.codex')).toBe(true);
		const raw = files.get('.codex/config.toml');
		expect(raw).toBeDefined();
		expect(raw).toContain('[mcp_servers.lumina]');
		expect(raw).toContain('url = "http://localhost:8080/sse"');
		expect(raw).toContain('http_headers = { Authorization = "Bearer test-token" }');
	});

	it('Codex: 기존 다른 서버 설정이 있을 때 보존하며 lumina를 병합한다', async () => {
		files.set(
			'.codex/config.toml',
			'[mcp_servers.other]\nurl = "http://localhost:3000"\n',
		);

		await cliMcpSync.sync({ port: 9090, authToken: 'token-2' });

		const raw = files.get('.codex/config.toml');
		expect(raw).toBeDefined();
		expect(raw).toContain('[mcp_servers.other]');
		expect(raw).toContain('[mcp_servers.lumina]');
		expect(raw).toContain('http://localhost:9090/sse');
	});

	it('Codex: cleanup 시 .codex/config.toml에서 lumina 설정을 제거하고 빈 파일은 삭제한다', async () => {
		files.set(
			'.codex/config.toml',
			'[mcp_servers.lumina]\nurl = "http://localhost:8080/sse"\nhttp_headers = { Authorization = "Bearer test-token" }\n',
		);

		await cliMcpSync.cleanup();

		expect(files.has('.codex/config.toml')).toBe(false);
	});

	it('Codex: cleanup 시 다른 서버 설정이 남아있으면 보존한다', async () => {
		files.set(
			'.codex/config.toml',
			'[mcp_servers.other]\nurl = "http://localhost:3000"\n\n[mcp_servers.lumina]\nurl = "http://localhost:8080/sse"\n',
		);

		await cliMcpSync.cleanup();

		expect(files.has('.codex/config.toml')).toBe(true);
		const raw = files.get('.codex/config.toml');
		expect(raw).toContain('[mcp_servers.other]');
		expect(raw).not.toContain('[mcp_servers.lumina]');
	});

	it('Codex: cleanup 시 볼트에 남아있는 레거시 codex.json 파일도 안전하게 삭제한다', async () => {
		files.set('codex.json', JSON.stringify({ mcp_servers: { lumina: {} } }));

		await cliMcpSync.cleanup();

		expect(files.has('codex.json')).toBe(false);
	});

	it('Antigravity: 전역 오염 방지를 위해 sync 시 agy mcp add를 호출하지 않는다', async () => {
		await cliMcpSync.sync({ port: 8080, authToken: 'test-token' });

		expect(ProcessManager.spawn).not.toHaveBeenCalledWith(
			expect.objectContaining({
				command: 'agy',
				args: expect.arrayContaining(['add']),
			}),
		);
	});

	it('Antigravity: cleanup 시 기존 잔여물을 안전하게 제거하기 위해 agy mcp remove lumina를 실행한다', async () => {
		const mockWaitForExit = vi.fn().mockResolvedValue({ exitCode: 0 });
		vi.mocked(ProcessManager.spawn).mockReturnValue({
			waitForExit: mockWaitForExit,
		} as any);

		await cliMcpSync.cleanup();

		expect(ProcessManager.spawn).toHaveBeenCalledWith(
			expect.objectContaining({
				command: 'agy',
				args: ['mcp', 'remove', 'lumina'],
			}),
		);
	});
});

