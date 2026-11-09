import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeLlmCall, executeCliAgentCall } from './llmExecutor';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ResolvedContext } from './contextBuilder';
import type LuminaPlugin from '../../../main';
import { debugLogger } from '../../../shared/debugLogger';
import { CliAgentProvider } from '../../../core/llm-providers/cli/cli-agent.provider';
import * as providerIndex from '../../../core/llm-providers/index';
import * as agentLoopModule from '../agentLoop';

describe('llmExecutor - CLI Agent Execution & Debug Logging', () => {
	const mockPlugin = {
		app: {
			vault: {
				configDir: '.obsidian',
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

	it('CLI 실행 시 프롬프트에 이미 <context>가 있으면 인라인 텍스트 첨부파일을 중복 주입하지 않는다', async () => {
		const cliConfig: LLMProviderConfig = {
			id: 'cli-codex',
			type: 'cli-codex',
			credential: '',
			availableModels: ['o3-mini'],
			isVerified: true,
			autoApprove: false,
		};

		const executeRawSpy = vi.spyOn(CliAgentProvider.prototype, 'executeRaw').mockReturnValue({
			events: (async function* () {
				yield { type: 'text', content: 'OK' };
			})(),
			waitForExit: vi.fn().mockResolvedValue({ exitCode: 0 }),
			writeStdin: vi.fn(),
			kill: vi.fn(),
		});

		const ctxWithContextBlock: ResolvedContext = {
			...mockContext,
			llmMessages: [
				{
					role: 'user',
					content: '<context>\n[선택된 텍스트]\nSelected snippet\n</context>\n\nUser Question: Explain this',
				},
			],
			attachments: [
				{ type: 'selection', name: 'Selection', path: '', content: 'Selected snippet' },
			],
		};

		await executeCliAgentCall(
			mockPlugin,
			ctxWithContextBlock,
			cliConfig,
			'claude-sonnet-4-5',
			mockPlugin.settings.chat,
			undefined,
			'assistant-dedup',
		);

		const passedPrompt = executeRawSpy.mock.calls[0][0];
		expect(passedPrompt).not.toContain('[Attached Content: Selection]');
		expect(passedPrompt).toContain('<context>');
	});

	it('CLI 스트림에서 실시간 델타 출력 후 동일한 최종 result 스냅샷이 오면 중복 출력하지 않는다', async () => {
		const cliConfig: LLMProviderConfig = {
			id: 'cli-claude',
			type: 'cli-claude-code',
			credential: '',
			availableModels: ['claude-3-7-sonnet'],
			isVerified: true,
			autoApprove: false,
		};

		vi.spyOn(CliAgentProvider.prototype, 'executeRaw').mockReturnValue({
			events: (async function* () {
				yield { type: 'text', content: '안녕하세요! ', raw: { type: 'stream_event' } };
				yield { type: 'text', content: '반갑습니다.', raw: { type: 'stream_event' } };
				yield { type: 'text', content: '안녕하세요! 반갑습니다.', raw: { type: 'result', result: '안녕하세요! 반갑습니다.' } };
			})(),
			waitForExit: vi.fn().mockResolvedValue({ exitCode: 0 }),
			writeStdin: vi.fn(),
			kill: vi.fn(),
		});

		const res = await executeCliAgentCall(
			mockPlugin,
			mockContext,
			cliConfig,
			'claude-3-7-sonnet',
			mockPlugin.settings.chat,
			undefined,
			'assistant-no-dup',
		);

		expect(res.fullResponse).toBe('안녕하세요! 반갑습니다.');
	});

	it('CLI 스트림에서 error 이벤트가 방출되면 에러 메시지를 응답에 반영하고 로그를 남긴다', async () => {
		const cliConfig: LLMProviderConfig = {
			id: 'cli-agy',
			type: 'cli-antigravity',
			credential: '',
			availableModels: ['gemini-3.8-flash-medium'],
			isVerified: true,
			autoApprove: false,
		};

		vi.spyOn(CliAgentProvider.prototype, 'executeRaw').mockReturnValue({
			events: (async function* () {
				yield { type: 'error', content: 'Quota exceeded for model' };
			})(),
			waitForExit: vi.fn().mockResolvedValue({ exitCode: 0 }),
			writeStdin: vi.fn(),
			kill: vi.fn(),
		});

		const res = await executeCliAgentCall(
			mockPlugin,
			mockContext,
			cliConfig,
			'gemini-3.8-flash-medium',
			mockPlugin.settings.chat,
			undefined,
			'assistant-err-event',
		);

		expect(res.fullResponse).toContain('Quota exceeded for model');
	});

	it('CLI 실행 시 사용자 정의 vault.configDir가 제외 경로 정책에 반영된다', async () => {
		const cliConfig: LLMProviderConfig = {
			id: 'cli-claude',
			type: 'cli-claude-code',
			credential: '',
			availableModels: ['claude-3-7-sonnet'],
			isVerified: true,
			autoApprove: false,
		};

		const executeRawSpy = vi.spyOn(CliAgentProvider.prototype, 'executeRaw').mockReturnValue({
			events: (async function* () {
				yield { type: 'text', content: 'OK' };
			})(),
			waitForExit: vi.fn().mockResolvedValue({ exitCode: 0 }),
			writeStdin: vi.fn(),
			kill: vi.fn(),
		});

		const customPlugin = {
			...mockPlugin,
			app: {
				...mockPlugin.app,
				vault: {
					...mockPlugin.app.vault,
					configDir: '.custom-obsidian',
				},
			},
		} as unknown as LuminaPlugin;

		await executeCliAgentCall(
			customPlugin,
			mockContext,
			cliConfig,
			'claude-3-7-sonnet',
			mockPlugin.settings.chat,
			undefined,
			'assistant-configdir',
		);

		const passedPrompt = executeRawSpy.mock.calls[0][0];
		expect(passedPrompt).toContain('.custom-obsidian');
	});

	describe('Cloud / Local Provider (OpenAI, Anthropic, Ollama 등) 실행 검증', () => {
		const cloudConfig: LLMProviderConfig = {
			id: 'openai-main',
			type: 'openai',
			credential: 'sk-test',
			availableModels: ['gpt-4o'],
			isVerified: true,
		};

		it('도구가 없는 일반 스트리밍 호출 시 provider.stream을 통해 응답을 수신한다', async () => {
			const mockProvider = {
				stream: vi.fn(async (_msgs, _opts, onChunk) => {
					onChunk('Hello ');
					onChunk('from ');
					onChunk('OpenAI!');
					return {
						usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					};
				}),
				chat: vi.fn(),
			};
			vi.spyOn(providerIndex, 'createProvider').mockReturnValue(mockProvider as any);

			const res = await executeLlmCall(
				mockPlugin,
				mockContext,
				cloudConfig,
				'gpt-4o',
				{ ...mockPlugin.settings.chat, streaming: true },
				undefined,
				'asst-stream-1',
			);

			expect(mockProvider.stream).toHaveBeenCalled();
			expect(res.fullResponse).toBe('Hello from OpenAI!');
			expect(res.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
		});

		it('streaming: false 설정 시 provider.chat을 호출하여 응답을 수신한다', async () => {
			const mockProvider = {
				stream: vi.fn(),
				chat: vi.fn().mockResolvedValue({
					content: 'Non-streaming response from LLM',
					usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
				}),
			};
			vi.spyOn(providerIndex, 'createProvider').mockReturnValue(mockProvider as any);

			const res = await executeLlmCall(
				mockPlugin,
				mockContext,
				cloudConfig,
				'gpt-4o',
				{ ...mockPlugin.settings.chat, streaming: false },
				undefined,
				'asst-nonstream-1',
			);

			expect(mockProvider.chat).toHaveBeenCalled();
			expect(res.fullResponse).toBe('Non-streaming response from LLM');
			expect(res.tokenUsage).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
		});

		it('mcpTools가 존재하는 경우 runAgentLoop로 도구 호출 루프를 위임한다', async () => {
			const mockProvider = { stream: vi.fn(), chat: vi.fn() };
			vi.spyOn(providerIndex, 'createProvider').mockReturnValue(mockProvider as any);

			const agentLoopSpy = vi.spyOn(agentLoopModule, 'runAgentLoop').mockResolvedValue({
				fullResponse: 'Final response after tool execution',
				tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				hasTokenLimitBeenHit: false,
			});

			const contextWithTools: ResolvedContext = {
				...mockContext,
				mcpTools: [
					{
						name: 'read_note',
						description: 'Reads a note',
						inputSchema: { type: 'object', properties: {} },
					},
				],
			};

			const res = await executeLlmCall(
				mockPlugin,
				contextWithTools,
				cloudConfig,
				'gpt-4o',
				mockPlugin.settings.chat,
				undefined,
				'asst-loop-1',
			);

			expect(agentLoopSpy).toHaveBeenCalled();
			expect(res.fullResponse).toBe('Final response after tool execution');
			expect(res.tokenUsage?.totalTokens).toBe(150);
		});
	});
});
