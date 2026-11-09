import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall } from './toolExecutor';
import type { ToolCall } from '../../../shared/types/llm.types';
import type { McpManager } from '../../../core/mcp/mcpManager';
import { executeWebSearch } from '../../web-search/webSearchTool';
import type { WebSearchSettings } from '../../../core/settings/settings.types';

vi.mock('../../web-search/webSearchTool', () => ({
	executeWebSearch: vi.fn(),
}));

describe('toolExecutor - executeToolCall', () => {
	let mockMcpManager: McpManager;

	beforeEach(() => {
		vi.clearAllMocks();

		mockMcpManager = {
			callTool: vi.fn().mockResolvedValue({
				content: [{ type: 'text', text: 'Result of vault read' }],
			}),
		} as unknown as McpManager;
	});

	it('일반 MCP 도구 실행 시 (useTextTools: false) role="tool" 및 tool_call_id를 반환한다', async () => {
		const tc: ToolCall = {
			id: 'call_123',
			name: 'read_note',
			arguments: { path: 'note.md', _serverId: 'lumina-internal' },
		};

		const res = await executeToolCall(
			tc,
			mockMcpManager,
			{ read_note: 'lumina-internal' },
			false, // useTextTools = false
		);

		expect(mockMcpManager.callTool).toHaveBeenCalledWith(
			'lumina-internal',
			'read_note',
			{ path: 'note.md' }, // _serverId는 제거됨
			undefined,
		);
		expect(res.role).toBe('tool');
		expect(res.name).toBe('read_note');
		expect(res.content).toBe('Result of vault read');
		expect(res.tool_call_id).toBe('call_123');
	});

	it('텍스트 기반 도구 모드 (useTextTools: true) 일 때 role="user" 및 설명 문구가 포함된다', async () => {
		const tc: ToolCall = {
			id: 'call_456',
			name: 'read_note',
			arguments: { path: 'note.md' },
		};

		const res = await executeToolCall(
			tc,
			mockMcpManager,
			{ read_note: 'lumina-internal' },
			true, // useTextTools = true
		);

		expect(res.role).toBe('user');
		expect(res.name).toBe('read_note');
		expect(res.content).toContain('Result of vault read');
		expect(res.tool_call_id).toBeUndefined(); // text mode에서는 tool_call_id 없음
	});

	it('__web_search__ 툴 호출 시 executeWebSearch로 라우팅한다', async () => {
		vi.mocked(executeWebSearch).mockResolvedValue('Web search results found 3 items.');

		const tc: ToolCall = {
			id: 'call_web',
			name: 'web_search',
			arguments: { query: 'Antigravity AI' },
		};

		const dummyWebSearchSettings: WebSearchSettings = {
			enabled: true,
			providers: [],
			activeProviderId: 'google',
			maxResults: 5,
			maxContentLength: 4000,
		};

		const res = await executeToolCall(
			tc,
			mockMcpManager,
			{ web_search: '__web_search__' },
			false,
			dummyWebSearchSettings,
		);

		expect(executeWebSearch).toHaveBeenCalledWith(
			{ query: 'Antigravity AI' },
			dummyWebSearchSettings,
			undefined,
		);
		expect(res.role).toBe('tool');
		expect(res.content).toBe('Web search results found 3 items.');
	});

	it('__web_search__ 호출 시 webSearchSettings가 없으면 에러를 포맷팅하여 반환한다', async () => {
		const tc: ToolCall = {
			id: 'call_web_err',
			name: 'web_search',
			arguments: { query: 'test' },
		};

		const res = await executeToolCall(
			tc,
			mockMcpManager,
			{ web_search: '__web_search__' },
			false,
			undefined, // no settings
		);

		expect(res.role).toBe('tool');
		expect(res.content).toContain('Web search settings not provided');
	});

	it('매핑된 서버가 없거나 mcpManager가 null이면 도구 미발견 오류를 반환한다', async () => {
		const tc: ToolCall = {
			id: 'call_none',
			name: 'unknown_tool',
			arguments: {},
		};

		const res = await executeToolCall(
			tc,
			null, // mcpManager null
			{},
			false,
		);

		expect(res.role).toBe('tool');
		expect(res.content).toBeTruthy();
	});

	it('mcpManager.callTool 실행 도중 예외가 발생해도 크래시 없이 오류 메시지를 반환한다', async () => {
		mockMcpManager.callTool = vi.fn().mockRejectedValue(new Error('MCP server disconnected'));

		const tc: ToolCall = {
			id: 'call_fail',
			name: 'read_note',
			arguments: { path: 'fail.md' },
		};

		const res = await executeToolCall(
			tc,
			mockMcpManager,
			{ read_note: 'lumina-internal' },
			false,
		);

		expect(res.role).toBe('tool');
		expect(res.content).toContain('MCP server disconnected');
		expect(res.tool_call_id).toBe('call_fail');
	});
});
