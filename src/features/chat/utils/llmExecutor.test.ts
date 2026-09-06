import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeLlmCall, executeCliAgentCall } from './llmExecutor';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ResolvedContext } from './contextBuilder';
import type LuminaPlugin from '../../../main';
import { debugLogger } from '../../../shared/debugLogger';
import { CliAgentProvider } from '../../../core/llm-providers/cli/cli-agent.provider';

describe('llmExecutor - CLI Agent Execution & Debug Logging', () => {
	const mockPlugin = {
		app: {
			vault: {
				adapter: {
					getBasePath: () => '/test/vault',
				},
				getAbstractFileByPath: vi.fn(),
				read: vi.fn(),
			},
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(null),
			},
		},
		settings: {
			chat: {
				temperature: 0.5,
				maxOutputTokens: 2048,
				streaming: true,
				agentExecutionMode: 'read',
			},
			webSearch: {},
		},
		mcpManager: null,
	} as unknown as LuminaPlugin;

	const mockContext: ResolvedContext = {
		llmMessages: [{ role: 'user', content: 'List files in vault' }],
		ragChunksForLog: undefined,
		useTextTools: false,
		mcpTools: [],
		toolServerMap: {},
		attachments: [],
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('CLI 프로바이더 설정 시 executeLlmCall이 executeCliAgentCall로 라우팅되어 결과를 반환한다', async () => {
		const cliConfig: LLMProviderConfig = {
			id: 'cli-claude',
			type: 'cli-claude-code',
			credential: '',
			availableModels: ['claude-3-7-sonnet'],
			isVerified: true,
			autoApprove: false,
		};

		// CliAgentProvider.prototype.executeRaw mocking
		const mockExecuteRaw = vi.spyOn(CliAgentProvider.prototype, 'executeRaw').mockReturnValue({
			events: (async function* () {
				yield { type: 'text', content: 'Here are ' };
				yield { type: 'text', content: 'the files.' };
				yield { type: 'usage', usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 } };
			})(),
			waitForExit: vi.fn().mockResolvedValue({ exitCode: 0 }),
			writeStdin: vi.fn(),
			kill: vi.fn(),
		});

		const result = await executeLlmCall(
			mockPlugin,
			mockContext,
			cliConfig,
			'claude-3-7-sonnet',
			mockPlugin.settings.chat,
			undefined,
			'assistant-123',
		);

		expect(result.fullResponse).toBe('Here are the files.');
		expect(result.tokenUsage).toEqual({
			inputTokens: 50,
			outputTokens: 20,
			totalTokens: 70,
		});
		expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
	});

	it('CLI 에이전트 실행 시 debugLogger.logRequest 및 debugLogger.logResponse가 올바르게 기록된다', async () => {
		const cliConfig: LLMProviderConfig = {
			id: 'cli-agy',
			type: 'cli-antigravity',
			credential: '',
			availableModels: ['gemini-2.5-pro'],
			isVerified: true,
			autoApprove: true,
		};

		const logRequestSpy = vi.spyOn(debugLogger, 'logRequest').mockReturnValue('test-req-id-123');
		const logResponseSpy = vi.spyOn(debugLogger, 'logResponse');
		const logSystemSpy = vi.spyOn(debugLogger, 'logSystem');

		vi.spyOn(CliAgentProvider.prototype, 'executeRaw').mockReturnValue({
			events: (async function* () {
				yield { type: 'tool_call', toolCall: { name: 'list_dir', arguments: { dir: '.' } } };
				yield { type: 'tool_result', toolResult: { name: 'list_dir', output: 'file1.md, file2.md' } };
				yield { type: 'file_edit', fileEdit: { path: 'notes/test.md', action: 'modify' } };
				yield { type: 'text', content: 'Done modifying test.md' };
			})(),
			waitForExit: vi.fn().mockResolvedValue({ exitCode: 0 }),
			writeStdin: vi.fn(),
			kill: vi.fn(),
		});

		await executeCliAgentCall(
			mockPlugin,
			mockContext,
			cliConfig,
			'gemini-2.5-pro',
			{
				...mockPlugin.settings.chat,
				agentExecutionMode: 'edit',
			},
			undefined,
			'assistant-456',
		);

		// 1. logRequest 호출 검증
		expect(logRequestSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'cli-antigravity',
				model: 'gemini-2.5-pro',
				stream: true,
			}),
		);

		// 2. logSystem 호출 검증 (시작, 툴 호출, 툴 결과, 파일 편집, 완료)
		expect(logSystemSpy).toHaveBeenCalledWith(
			'cli-agent-start',
			expect.stringContaining('cli-antigravity'),
			expect.objectContaining({ mode: 'edit' }),
		);
		expect(logSystemSpy).toHaveBeenCalledWith(
			'cli-tool-call',
			'CLI Tool Call: list_dir',
			expect.any(Object),
		);
		expect(logSystemSpy).toHaveBeenCalledWith(
			'cli-tool-result',
			expect.stringContaining('list_dir'),
			expect.any(Object),
		);
		expect(logSystemSpy).toHaveBeenCalledWith(
			'cli-file-edit',
			expect.stringContaining('notes/test.md'),
			expect.any(Object),
		);
		expect(logSystemSpy).toHaveBeenCalledWith(
			'cli-agent-finish',
			expect.stringContaining('cli-antigravity'),
			expect.objectContaining({ exitCode: 0 }),
		);

		// 3. logResponse 호출 검증
		expect(logResponseSpy).toHaveBeenCalledWith(
			'test-req-id-123',
			expect.objectContaining({
				model: 'gemini-2.5-pro',
				content: 'Done modifying test.md',
			}),
		);
	});

	it('CLI 실행 중 non-zero exitCode 발생 시 debugLogger.logError가 기록된다', async () => {
		const cliConfig: LLMProviderConfig = {
			id: 'cli-codex',
			type: 'cli-codex',
			credential: '',
			availableModels: ['o3-mini'],
			isVerified: true,
			autoApprove: false,
		};

		const logErrorSpy = vi.spyOn(debugLogger, 'logError');

		vi.spyOn(CliAgentProvider.prototype, 'executeRaw').mockReturnValue({
			events: (async function* () {
				yield { type: 'raw_log', content: 'Fatal error: syntax error in CLI arguments' };
			})(),
			waitForExit: vi.fn().mockResolvedValue({ exitCode: 1 }),
			writeStdin: vi.fn(),
			kill: vi.fn(),
		});

		const res = await executeCliAgentCall(
			mockPlugin,
			mockContext,
			cliConfig,
			'o3-mini',
			mockPlugin.settings.chat,
			undefined,
			'assistant-789',
		);

		expect(res.fullResponse).toContain('⚠️ CLI 실행 중 오류가 발생했습니다 (종료 코드: 1)');
		expect(logErrorSpy).toHaveBeenCalledWith(
			'cli-agent',
			expect.stringContaining('exitCode: 1'),
		);
	});
});
