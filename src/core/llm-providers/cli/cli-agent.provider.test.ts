import { describe, it, expect } from 'vitest';
import { CliAgentProvider, formatMessagesToPrompt } from './cli-agent.provider';
import { AntigravityProvider } from './agents/antigravity.provider';
import { OpenCodeProvider } from './agents/opencode.provider';
import { CodexProvider } from './agents/codex.provider';
import { ClaudeCodeProvider } from './agents/claude-code.provider';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ChatMessage } from '../../../shared/types/llm.types';
import type { CliExecuteOptions } from '../../../shared/types/cliAgent.types';
import { stripAnsiCodes } from './ndjson-parser';
import { toVaultRelativePath } from '../../../shared/utils/fileUtils';
import type LuminaPlugin from '../../../main';

describe('CliAgentProvider - All Agents Verification', () => {
	const agentTypes: Array<LLMProviderConfig['type']> = [
		'cli-claude-code',
		'cli-codex',
		'cli-opencode',
		'cli-antigravity',
	];

	for (const type of agentTypes) {
		describe(`Agent: ${type}`, () => {
			const config: LLMProviderConfig = {
				id: `test-${type}`,
				type,
				credential: '',
				availableModels: [],
				isVerified: true,
				autoApprove: true,
			};

			it('인스턴스가 정상 생성된다', () => {
				const provider = new CliAgentProvider(config);
				expect(provider.providerId).toBe(`test-${type}`);
			});

			it('listModels()가 배열을 반환한다', async () => {
				const provider = new CliAgentProvider(config);
				const models = await provider.listModels();
				expect(Array.isArray(models)).toBe(true);
				expect(models.length).toBeGreaterThan(0);
			});

			it('embed() 호출 시 미지원 에러를 던진다', async () => {
				const provider = new CliAgentProvider(config);
				await expect(provider.embed()).rejects.toThrow('CLI agents do not support embedding');
			});
		});
	}

	describe('formatMessagesToPrompt - 멀티턴 대화 맥락 보존', () => {
		it('단일 사용자 메시지는 텍스트 원문 그대로 반환한다', () => {
			const msgs: ChatMessage[] = [{ role: 'user', content: 'Hello world' }];
			expect(formatMessagesToPrompt(msgs)).toBe('Hello world');
		});

		it('멀티턴 대화 메시지는 역할과 함께 맥락 전체를 포맷팅한다', () => {
			const msgs: ChatMessage[] = [
				{ role: 'system', content: 'You are a coding assistant.' },
				{ role: 'user', content: 'What is TypeScript?' },
				{ role: 'assistant', content: 'TypeScript is typed JavaScript.' },
				{ role: 'user', content: 'Can you show an example?' },
			];
			const prompt = formatMessagesToPrompt(msgs);
			expect(prompt).toContain('[System]:\nYou are a coding assistant.');
			expect(prompt).toContain('[User]:\nWhat is TypeScript?');
			expect(prompt).toContain('[Assistant]:\nTypeScript is typed JavaScript.');
			expect(prompt).toContain('[User]:\nCan you show an example?');
		});
	});

	describe('AntigravityProvider - parseModelsOutput', () => {
		const provider = new AntigravityProvider({
			id: 'test-antigravity-parser',
			type: 'antigravity',
			binaryPath: 'agy',
			autoApprove: true,
			isVerified: true,
		});

		it('다양한 CLI 모델 출력 형식을 정확히 파싱한다', () => {
			const sampleOutput = `
Available models:
----------------------------------------
* gemini-2.5-pro (Recommended, high intelligence)
* gemini-2.0-flash (Fast)
- claude-3-7-sonnet
- claude-3-5-sonnet
  o3-mini
  gpt-4o
`;
			const parsed = provider.parseModelsOutput(sampleOutput);
			expect(parsed).toEqual([
				'gemini-2.5-pro',
				'gemini-2.0-flash',
				'claude-3-7-sonnet',
				'claude-3-5-sonnet',
				'o3-mini',
				'gpt-4o',
			]);
		});

		it('헤더와 에러 라인을 무시하고 유효한 모델 ID만 추출한다', () => {
			const sampleOutput = `
Usage: agy models [flags]
Models:
gemini-2.5-pro
=== deprecated ===
gemini-1.5-flash
`;
			const parsed = provider.parseModelsOutput(sampleOutput);
			expect(parsed).toEqual(['gemini-2.5-pro', 'gemini-1.5-flash']);
		});

		it('machine-readable JSON 포맷 출력을 정확히 파싱한다', () => {
			const jsonOutput = JSON.stringify([
				{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
				{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
			]);
			const parsed = provider.parseModelsOutput(jsonOutput);
			expect(parsed).toEqual(['gemini-2.5-pro', 'gemini-2.0-flash']);
		});

		it('실제 agy models 출력(Fetching 헤더 및 탭 구분자)을 올바르게 파싱한다', () => {
			const agyOutput = `Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)`;
			const parsed = provider.parseModelsOutput(agyOutput);
			expect(parsed).toEqual([
				'gemini-3.8-flash-high',
				'gemini-3.8-flash-medium',
				'claude-sonnet-4-6',
				'gpt-oss-120b-medium',
			]);
			expect(parsed).not.toContain('Fetching');
		});
	});

	describe('OpenCodeProvider - parseModelsOutput', () => {
		const provider = new OpenCodeProvider({
			id: 'test-opencode-parser',
			type: 'opencode',
			binaryPath: 'opencode',
			autoApprove: true,
			isVerified: true,
		});

		it('JSON 포맷 출력을 정확히 파싱한다', () => {
			const jsonOutput = JSON.stringify({
				models: [
					'anthropic/claude-3-7-sonnet',
					'openai/gpt-4o',
				],
			});
			const parsed = provider.parseModelsOutput(jsonOutput);
			expect(parsed).toEqual(['anthropic/claude-3-7-sonnet', 'openai/gpt-4o']);
		});

		it('opencode models 출력의 공급자/모델 형식을 올바르게 파싱한다', () => {
			const sampleOutput = `
Available Models:
anthropic/claude-3-7-sonnet
openai/gpt-4o
deepseek/deepseek-r1
google/gemini-2.5-pro
`;
			const parsed = provider.parseModelsOutput(sampleOutput);
			expect(parsed).toEqual([
				'anthropic/claude-3-7-sonnet',
				'openai/gpt-4o',
				'deepseek/deepseek-r1',
				'google/gemini-2.5-pro',
			]);
		});
	});

	describe('CodexProvider - parseModelsOutput', () => {
		const provider = new CodexProvider({
			id: 'test-codex-parser',
			type: 'codex',
			binaryPath: 'codex',
			autoApprove: true,
			isVerified: true,
		});

		it('codex 모델 출력 형식에서 모델명을 추출한다', () => {
			const sampleOutput = `
Available models:
- o3-mini
- gpt-4o
- gpt-4.5-preview
`;
			const parsed = provider.parseModelsOutput(sampleOutput);
			expect(parsed).toEqual(['o3-mini', 'gpt-4o', 'gpt-4.5-preview']);
		});
	});

	describe('ClaudeCodeProvider - parseModelsOutput', () => {
		const provider = new ClaudeCodeProvider({
			id: 'test-claude-parser',
			type: 'claude-code',
			binaryPath: 'claude',
			autoApprove: true,
			isVerified: true,
		});

		it('claude 모델 출력 형식에서 모델명을 추출한다', () => {
			const sampleOutput = `
Models:
claude-3-7-sonnet
claude-3-5-sonnet
claude-3-5-haiku
`;
			const parsed = provider.parseModelsOutput(sampleOutput);
			expect(parsed).toEqual(['claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku']);
		});
	});

	describe('CLI Providers - buildCommandArgs Mode Optimization', () => {
		const prompt = 'Fix the typescript error';

		describe('ClaudeCodeProvider - buildCommandArgs', () => {
			const provider = new ClaudeCodeProvider({
				id: 'test-claude',
				type: 'claude-code',
				binaryPath: 'claude',
				autoApprove: true,
				isVerified: true,
			});

			it('에이전트 OFF(agentEnabled: false)일 때 도구를 전면 차단하고 텍스트 전용 지침을 주입한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: false,
					agentExecutionMode: 'edit',
				});
				expect(args).toContain('--disallowed-tools');
				const toolIdx = args.indexOf('--disallowed-tools');
				expect(args[toolIdx + 1]).toBe('*');
				expect(args[1]).toContain('[SYSTEM: Tool use is disabled. Provide answers purely in conversational text without invoking any tools.]');
			});

			it('읽기 모드(agentExecutionMode: read)일 때 읽기 전용 도구만 허용하고 쓰기 도구를 차단한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'read',
					autoApprove: true,
				});
				expect(args).toContain('--allowed-tools');
				const toolIdx = args.indexOf('--allowed-tools');
				expect(args[toolIdx + 1]).toBe('Read,Grep,Glob,View');
				expect(args).toContain('--disallowed-tools');
				const disallowIdx = args.indexOf('--disallowed-tools');
				expect(args[disallowIdx + 1]).toBe('Edit,Write,Bash');
				expect(args[1]).toContain('[SYSTEM: You are in READ-ONLY mode. Do NOT create, modify, or delete any files. Inspect and read only.]');
				expect(args).toContain('--dangerously-skip-permissions');
			});

			it('수정 모드(agentExecutionMode: edit)일 때 전체 권한을 허용한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'edit',
					autoApprove: true,
				});
				expect(args[1]).toBe(prompt);
				expect(args).toContain('--dangerously-skip-permissions');
				expect(args).toContain('--verbose');
			});

			it('공식 스펙에 미정의된 --file 플래그를 추가하지 않는다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					contextFiles: ['/vault/photo.png'],
				});
				expect(args).not.toContain('--file');
				expect(args).toContain('--verbose');
			});
		});

		describe('CodexProvider - buildCommandArgs', () => {
			const provider = new CodexProvider({
				id: 'test-codex',
				type: 'codex',
				binaryPath: 'codex',
				autoApprove: true,
				isVerified: true,
			});

			it('에이전트 OFF(agentEnabled: false)일 때 --sandbox read-only를 적용하고 --skip-git-repo-check를 포함한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: false,
					agentExecutionMode: 'edit',
					autoApprove: true,
				});
				expect(args).toContain('--sandbox');
				const sbIdx = args.indexOf('--sandbox');
				expect(args[sbIdx + 1]).toBe('read-only');
				expect(args).toContain('--skip-git-repo-check');
				expect(args).not.toContain('--full-auto');
				const lastArg = args[args.length - 1];
				expect(lastArg).toContain('[SYSTEM: Tool execution is disabled. Provide answers purely in conversational text.]');
			});

			it('읽기 모드(agentExecutionMode: read)일 때 --sandbox read-only를 적용하고 --skip-git-repo-check를 포함한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'read',
					autoApprove: true,
				});
				expect(args).toContain('--sandbox');
				const sbIdx = args.indexOf('--sandbox');
				expect(args[sbIdx + 1]).toBe('read-only');
				expect(args).toContain('--skip-git-repo-check');
				expect(args).not.toContain('--full-auto');
				const lastArg = args[args.length - 1];
				expect(lastArg).toContain('[SYSTEM: You are in READ-ONLY mode. Do NOT modify, create, or delete any files. Inspect and read only.]');
			});

			it('수정 모드(agentExecutionMode: edit)일 때 autoApprove가 true이면 --sandbox workspace-write와 -c approval_policy=never를 적용한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'edit',
					autoApprove: true,
				});
				expect(args).not.toContain('--full-auto');
				expect(args).toContain('--skip-git-repo-check');
				expect(args).toContain('--sandbox');
				const sbIdx = args.indexOf('--sandbox');
				expect(args[sbIdx + 1]).toBe('workspace-write');
				expect(args).toContain('-c');
				const cIdx = args.indexOf('-c');
				expect(args[cIdx + 1]).toBe('approval_policy=never');
				const lastArg = args[args.length - 1];
				expect(lastArg).toBe(prompt);
			});

			it('수정 모드(agentExecutionMode: edit)일 때 autoApprove가 false이면 명시적 --sandbox workspace-write와 -c approval_policy=on-request를 적용한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'edit',
					autoApprove: false,
				});
				expect(args).not.toContain('--full-auto');
				expect(args).toContain('--skip-git-repo-check');
				expect(args).toContain('--sandbox');
				const sbIdx = args.indexOf('--sandbox');
				expect(args[sbIdx + 1]).toBe('workspace-write');
				expect(args).toContain('-c');
				const cIdx = args.indexOf('-c');
				expect(args[cIdx + 1]).toBe('approval_policy=on-request');
			});

			it('공식 스펙에 미정의된 --file 플래그를 추가하지 않는다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					contextFiles: ['/vault/diagram.png'],
				});
				expect(args).not.toContain('--file');
			});
		});

		describe('OpenCodeProvider - buildCommandArgs', () => {
			const provider = new OpenCodeProvider({
				id: 'test-opencode',
				type: 'opencode',
				binaryPath: 'opencode',
				autoApprove: true,
				isVerified: true,
			});

			it('에이전트 OFF(agentEnabled: false)일 때 --auto를 제외하고 --thinking을 유지한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: false,
					agentExecutionMode: 'edit',
					autoApprove: true,
				});
				expect(args).not.toContain('--auto');
				expect(args).toContain('--thinking');
				expect(args[1]).toContain('[SYSTEM: Tool execution is disabled. Respond with conversational text only.]');
			});

			it('읽기 모드(agentExecutionMode: read)일 때 --auto를 제외하고 --thinking을 유지한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'read',
					autoApprove: true,
				});
				expect(args).not.toContain('--auto');
				expect(args).toContain('--thinking');
				expect(args[1]).toContain('[SYSTEM: You are in READ-ONLY mode. Do NOT edit, create, or delete any files. Inspect and read only.]');
			});

			it('수정 모드(agentExecutionMode: edit)일 때 --auto와 --thinking을 적용한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'edit',
					autoApprove: true,
				});
				expect(args).toContain('--auto');
				expect(args).toContain('--thinking');
				expect(args[1]).toBe(prompt);
			});

			it('미지원 플래그 방지를 위해 --file 플래그를 추가하지 않는다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					contextFiles: ['/vault/ui.jpg'],
				});
				expect(args).not.toContain('--file');
			});
		});

		describe('OpenCodeProvider - mapEvent JSON Event Parsing', () => {
			const provider = new OpenCodeProvider({
				id: 'test-opencode-mapper',
				type: 'opencode',
				binaryPath: 'opencode',
				autoApprove: true,
				isVerified: true,
			});

			const map = (raw: unknown) => (provider as unknown as { mapEvent: (r: unknown) => unknown }).mapEvent(raw);

			it('OpenCode text 이벤트를 정상 파싱하여 text 이벤트를 반환한다', () => {
				const sample = {
					type: 'text',
					timestamp: 1788602896000,
					sessionID: 'ses_123',
					part: {
						id: 'prt_1',
						sessionID: 'ses_123',
						messageID: 'msg_1',
						type: 'text',
						text: '안녕하세요! 무엇을 도와드릴까요?',
						time: { start: 1000, end: 2000 },
					},
				};
				const res = map(sample) as { type: string; content: string };
				expect(res).toBeDefined();
				expect(res.type).toBe('text');
				expect(res.content).toBe('안녕하세요! 무엇을 도와드릴까요?');
			});

			it('OpenCode reasoning 이벤트를 정상 파싱하여 thinking 이벤트를 반환한다', () => {
				const sample = {
					type: 'reasoning',
					timestamp: 1788602895000,
					sessionID: 'ses_123',
					part: {
						id: 'prt_2',
						sessionID: 'ses_123',
						messageID: 'msg_1',
						type: 'reasoning',
						text: '사용자의 질문에 대해 분석 중...',
						time: { start: 1000, end: 2000 },
					},
				};
				const res = map(sample) as { type: string; content: string };
				expect(res).toBeDefined();
				expect(res.type).toBe('thinking');
				expect(res.content).toBe('사용자의 질문에 대해 분석 중...');
			});

			it('OpenCode tool_use 이벤트를 정상 파싱하여 tool_call 및 tool_result를 반환한다', () => {
				const sample = {
					type: 'tool_use',
					timestamp: 1788602895500,
					sessionID: 'ses_123',
					part: {
						id: 'prt_3',
						sessionID: 'ses_123',
						messageID: 'msg_1',
						type: 'tool',
						tool: 'read',
						state: {
							status: 'completed',
							input: { path: 'notes/test.md' },
							output: 'file content here',
						},
					},
				};
				const res = map(sample) as Array<{ type: string; toolCall?: { name: string; arguments: Record<string, unknown> }; toolResult?: { output: string } }>;
				expect(Array.isArray(res)).toBe(true);
				expect(res).toHaveLength(2);
				expect(res[0].type).toBe('tool_call');
				expect(res[0].toolCall?.name).toBe('read');
				expect(res[0].toolCall?.arguments).toEqual({ path: 'notes/test.md' });
				expect(res[1].type).toBe('tool_result');
				expect(res[1].toolResult?.output).toBe('file content here');
			});

			it('OpenCode 파일 수정 도구 실행 시 file_edit 이벤트를 포함한다', () => {
				const sample = {
					type: 'tool_use',
					timestamp: 1788602895600,
					sessionID: 'ses_123',
					part: {
						id: 'prt_4',
						sessionID: 'ses_123',
						messageID: 'msg_1',
						type: 'tool',
						tool: 'write',
						state: {
							status: 'completed',
							input: { path: 'notes/new.md', content: 'hello' },
							output: 'created',
						},
					},
				};
				const res = map(sample) as Array<{ type: string; fileEdit?: { path: string; action: string } }>;
				expect(Array.isArray(res)).toBe(true);
				expect(res).toHaveLength(3);
				expect(res[0].type).toBe('tool_call');
				expect(res[1].type).toBe('file_edit');
				expect(res[1].fileEdit?.path).toBe('notes/new.md');
				expect(res[2].type).toBe('tool_result');
			});

			it('OpenCode step_finish 이벤트를 파싱하여 usage 이벤트를 반환한다', () => {
				const sample = {
					type: 'step_finish',
					timestamp: 1788602896500,
					sessionID: 'ses_123',
					part: {
						id: 'prt_5',
						sessionID: 'ses_123',
						messageID: 'msg_1',
						type: 'step-finish',
						reason: 'stop',
						cost: 0.001,
						tokens: {
							input: 150,
							output: 75,
							total: 225,
						},
					},
				};
				const res = map(sample) as { type: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } };
				expect(res).toBeDefined();
				expect(res.type).toBe('usage');
				expect(res.usage.inputTokens).toBe(150);
				expect(res.usage.outputTokens).toBe(75);
				expect(res.usage.totalTokens).toBe(225);
			});

			it('OpenCode error 이벤트를 올바르게 파싱한다', () => {
				const sample = {
					type: 'error',
					timestamp: 1788602897000,
					sessionID: 'ses_123',
					error: {
						name: 'ProviderError',
						data: { message: 'Model rate limit exceeded' },
					},
				};
				const res = map(sample) as { type: string; content: string };
				expect(res).toBeDefined();
				expect(res.type).toBe('error');
				expect(res.content).toBe('Model rate limit exceeded');
			});
		});

		describe('CodexProvider - mapEvent JSON Event Parsing', () => {
			const provider = new CodexProvider({
				id: 'test-codex-mapper',
				type: 'codex',
				binaryPath: 'codex',
				autoApprove: true,
				isVerified: true,
			});

			const map = (raw: unknown) => (provider as unknown as { mapEvent: (r: unknown) => unknown }).mapEvent(raw);

			it('Codex item.completed (agent_message) 이벤트를 정상 파싱하여 text 이벤트를 반환한다', () => {
				const sample = {
					type: 'item.completed',
					item: {
						id: 'item_1',
						type: 'agent_message',
						text: 'Hello from Codex!',
					},
				};
				const res = map(sample) as { type: string; content: string };
				expect(res).toBeDefined();
				expect(res.type).toBe('text');
				expect(res.content).toBe('Hello from Codex!');
			});

			it('Codex item.completed (reasoning) 이벤트를 정상 파싱하여 thinking 이벤트를 반환한다', () => {
				const sample = {
					type: 'item.completed',
					item: {
						id: 'item_2',
						type: 'reasoning',
						text: 'Planning changes...',
					},
				};
				const res = map(sample) as { type: string; content: string };
				expect(res).toBeDefined();
				expect(res.type).toBe('thinking');
				expect(res.content).toBe('Planning changes...');
			});

			it('Codex item.completed (command_execution) 이벤트를 정상 파싱하여 tool_call 및 tool_result를 반환한다', () => {
				const sample = {
					type: 'item.completed',
					item: {
						id: 'item_3',
						type: 'command_execution',
						command: 'git status',
						status: 'completed',
						output: 'On branch main',
					},
				};
				const res = map(sample) as Array<{ type: string; toolCall?: { name: string }; toolResult?: { output: string } }>;
				expect(Array.isArray(res)).toBe(true);
				expect(res).toHaveLength(2);
				expect(res[0].type).toBe('tool_call');
				expect(res[0].toolCall?.name).toBe('git status');
				expect(res[1].type).toBe('tool_result');
				expect(res[1].toolResult?.output).toBe('On branch main');
			});

			it('Codex turn.completed 이벤트를 정상 파싱하여 usage 이벤트를 반환한다', () => {
				const sample = {
					type: 'turn.completed',
					usage: {
						input_tokens: 200,
						output_tokens: 100,
						total_tokens: 300,
					},
				};
				const res = map(sample) as { type: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } };
				expect(res).toBeDefined();
				expect(res.type).toBe('usage');
				expect(res.usage.inputTokens).toBe(200);
				expect(res.usage.outputTokens).toBe(100);
				expect(res.usage.totalTokens).toBe(300);
			});

			it('Codex turn.failed 이벤트를 정상 파싱하여 error 이벤트를 반환한다', () => {
				const sample = {
					type: 'turn.failed',
					error: { message: 'Execution timed out' },
				};
				const res = map(sample) as { type: string; content: string };
				expect(res).toBeDefined();
				expect(res.type).toBe('error');
				expect(res.content).toBe('Execution timed out');
			});
		});

		describe('ClaudeCodeProvider - mapEvent stream_event and result Handling', () => {
			const provider = new ClaudeCodeProvider({
				id: 'test-claude-mapper',
				type: 'claude-code',
				binaryPath: 'claude',
				autoApprove: true,
				isVerified: true,
			});

			const map = (raw: unknown) => (provider as unknown as { mapEvent: (r: unknown) => unknown }).mapEvent(raw);

			it('Claude Code stream_event (text_delta)를 래핑 해제하여 정상 파싱한다', () => {
				const sample = {
					type: 'stream_event',
					event: {
						type: 'content_block_delta',
						index: 0,
						delta: {
							type: 'text_delta',
							text: 'Hello from Claude!',
						},
					},
				};
				const res = map(sample) as { type: string; content: string };
				expect(res).toBeDefined();
				expect(res.type).toBe('text');
				expect(res.content).toBe('Hello from Claude!');
			});

			it('Claude Code stream_event (thinking_delta)를 래핑 해제하여 정상 파싱한다', () => {
				const sample = {
					type: 'stream_event',
					event: {
						type: 'content_block_delta',
						index: 0,
						delta: {
							type: 'thinking_delta',
							thinking: 'Claude is thinking...',
						},
					},
				};
				const res = map(sample) as { type: string; content: string };
				expect(res).toBeDefined();
				expect(res.type).toBe('thinking');
				expect(res.content).toBe('Claude is thinking...');
			});

			it('Claude Code result 이벤트에서 usage와 result를 모두 보존한다', () => {
				const sample = {
					type: 'result',
					subtype: 'success',
					result: 'Final result',
					usage: {
						input_tokens: 50,
						output_tokens: 25,
					},
				};
				const res = map(sample) as Array<{ type: string }>;
				expect(Array.isArray(res)).toBe(true);
				expect(res).toHaveLength(2);
				expect(res[0].type).toBe('usage');
				expect(res[1].type).toBe('text');
			});

			it('Claude Code message_delta 및 message_start 스트림 이벤트의 usage를 정상 파싱한다', () => {
				const sampleDelta = {
					type: 'message_delta',
					usage: {
						output_tokens: 30,
					},
				};
				const resDelta = map(sampleDelta) as { type: string; usage: { outputTokens: number } };
				expect(resDelta).toBeDefined();
				expect(resDelta.type).toBe('usage');
				expect(resDelta.usage.outputTokens).toBe(30);

				const sampleStart = {
					type: 'stream_event',
					event: {
						type: 'message_start',
						message: {
							usage: {
								input_tokens: 120,
							},
						},
					},
				};
				const resStart = map(sampleStart) as { type: string; usage: { inputTokens: number } };
				expect(resStart).toBeDefined();
				expect(resStart.type).toBe('usage');
				expect(resStart.usage.inputTokens).toBe(120);
			});

			it('Claude Code Edit 및 Write 도구 호출 시 file_edit 이벤트를 함께 방출한다', () => {
				const sampleEdit = {
					type: 'assistant',
					message: {
						content: [
							{
								type: 'tool_use',
								name: 'Edit',
								input: {
									file_path: 'notes/test.md',
									old_string: 'foo',
									new_string: 'bar',
								},
							},
						],
					},
				};
				const res = map(sampleEdit) as Array<{ type: string; fileEdit?: { path: string; action: string } }>;
				expect(Array.isArray(res)).toBe(true);
				expect(res).toHaveLength(2);
				expect(res[0].type).toBe('tool_call');
				expect(res[1].type).toBe('file_edit');
				expect(res[1].fileEdit?.path).toBe('notes/test.md');
				expect(res[1].fileEdit?.action).toBe('modify');
			});
		});

		describe('AntigravityProvider - buildCommandArgs', () => {
			const provider = new AntigravityProvider({
				id: 'test-antigravity',
				type: 'antigravity',
				binaryPath: 'agy',
				autoApprove: true,
				isVerified: true,
			});

			it('에이전트 OFF(agentEnabled: false)일 때 --mode plan 및 --dangerously-skip-permissions를 적용하고 안내 프롬프트를 주입한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: false,
					agentExecutionMode: 'edit',
					autoApprove: true,
				});
				expect(args).toContain('--mode');
				const modeIdx = args.indexOf('--mode');
				expect(args[modeIdx + 1]).toBe('plan');
				expect(args).toContain('--dangerously-skip-permissions');
				const lastArg = args[args.length - 1];
				expect(lastArg).toContain('[SYSTEM: Tool execution is disabled. Provide a direct conversational answer.]');
			});

			it('읽기 모드(agentExecutionMode: read)일 때 autoApprove가 true이면 --mode plan 및 --dangerously-skip-permissions를 적용한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'read',
					autoApprove: true,
				});
				expect(args).toContain('--mode');
				const modeIdx = args.indexOf('--mode');
				expect(args[modeIdx + 1]).toBe('plan');
				expect(args).toContain('--dangerously-skip-permissions');
				const lastArg = args[args.length - 1];
				expect(lastArg).toContain('[SYSTEM: You are in READ-ONLY mode. Do NOT modify files or run destructive commands. Inspect only.]');
			});

			it('읽기 모드(agentExecutionMode: read)일 때 autoApprove가 false여도 헤드리스 auto-denied 방지를 위해 --dangerously-skip-permissions를 적용한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'read',
					autoApprove: false,
				});
				expect(args).toContain('--mode');
				const modeIdx = args.indexOf('--mode');
				expect(args[modeIdx + 1]).toBe('plan');
				expect(args).toContain('--dangerously-skip-permissions');
			});

			it('수정 모드(agentExecutionMode: edit)일 때 --mode accept-edits 및 --dangerously-skip-permissions를 적용한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					agentEnabled: true,
					agentExecutionMode: 'edit',
					autoApprove: true,
				});
				expect(args).toContain('--mode');
				const modeIdx = args.indexOf('--mode');
				expect(args[modeIdx + 1]).toBe('accept-edits');
				expect(args).toContain('--dangerously-skip-permissions');
				const lastArg = args[args.length - 1];
				expect(lastArg).toBe(prompt);
			});

			it('agy에 미정의된 --file 플래그를 추가하지 않아 인자 오류를 방지한다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					contextFiles: ['/vault/screenshot.png'],
				});
				expect(args).not.toContain('--file');
			});

			it('--output-format stream-json 플래그가 --print 앞에 위치하고 --print 바로 뒤에 프롬프트가 온다', () => {
				const args = provider.buildCommandArgs(prompt, {
					cwd: '/test/vault',
					model: 'gemini-3.8-flash-medium',
				});
				const formatIdx = args.indexOf('--output-format');
				const printIdx = args.indexOf('--print');
				expect(formatIdx).toBeGreaterThanOrEqual(0);
				expect(args[formatIdx + 1]).toBe('stream-json');
				expect(printIdx).toBeGreaterThan(formatIdx);
				expect(args[printIdx + 1]).toBe(prompt);
			});
		});

		describe('CLI Providers - Fallback Models', () => {
			it('모든 CLI 프로바이더가 기본 폴백 모델 목록을 제공한다', () => {
				expect(AntigravityProvider.FALLBACK_MODELS.length).toBeGreaterThan(0);
				expect(OpenCodeProvider.FALLBACK_MODELS.length).toBeGreaterThan(0);
				expect(ClaudeCodeProvider.FALLBACK_MODELS.length).toBeGreaterThan(0);
				expect(CodexProvider.FALLBACK_MODELS.length).toBeGreaterThan(0);

				expect(AntigravityProvider.FALLBACK_MODELS).toContain('gemini-3.8-flash-medium');
				expect(OpenCodeProvider.FALLBACK_MODELS).toContain('opencode/big-pickle');
				expect(ClaudeCodeProvider.FALLBACK_MODELS).toContain('claude-3-7-sonnet');
				expect(CodexProvider.FALLBACK_MODELS).toContain('gpt-4o');
			});
		});

		describe('CliAgentProvider - Stream as Pure LLM Adapter', () => {
			it('stream() 호출 시 agentEnabled: false 및 agentExecutionMode: read 옵션으로 순수 텍스트 생성 모드로 동작한다', async () => {
				const config: LLMProviderConfig = {
					id: 'test-antigravity',
					type: 'cli-antigravity',
					credential: '',
					availableModels: ['gemini-3.8-flash-medium'],
					isVerified: true,
					autoApprove: true,
				};
				const provider = new CliAgentProvider(config);
				let capturedOptions: CliExecuteOptions | undefined;
				// Mock the agent.execute
				(provider as unknown as { agent: { execute: (prompt: string, opts: CliExecuteOptions) => unknown } }).agent = {
					execute: (_prompt: string, opts: CliExecuteOptions) => {
						capturedOptions = opts;
						return {
							events: (async function* () {
								yield { type: 'text', content: 'Hello world' };
							})(),
							cancel: () => {},
							stdin: null,
							waitForExit: async () => 0,
						};
					},
				};

				let chunks = '';
				await provider.stream(
					[{ role: 'user', content: 'Hi' }],
					{ model: 'gemini-3.8-flash-medium' },
					(chunk) => { chunks += chunk; }
				);

				expect(chunks).toBe('Hello world');
				expect(capturedOptions).toBeDefined();
				expect(capturedOptions?.agentEnabled).toBe(false);
				expect(capturedOptions?.agentExecutionMode).toBe('read');
				expect(capturedOptions?.autoApprove).toBe(false);
			});
		});
	});

	describe('stripAnsiCodes - Enhanced Terminal Sequences', () => {
		it('표준 색상 및 스타일 ANSI 시퀀스를 제거한다', () => {
			const colored = '\u001b[31;1mError:\u001b[0m Something went wrong';
			expect(stripAnsiCodes(colored)).toBe('Error: Something went wrong');
		});

		it('터미널 모드 설정 및 OSC 하이퍼링크 시퀀스를 제거한다', () => {
			const linked = '\u001b]8;;https://example.com\u001b\\Click Here\u001b]8;;\u001b\\';
			expect(stripAnsiCodes(linked)).toBe('Click Here');
		});

		it('복귀 문자(\\r)를 제거한다', () => {
			const text = 'Line 1\r\nLine 2\r';
			expect(stripAnsiCodes(text)).toBe('Line 1\nLine 2');
		});
	});

	describe('toVaultRelativePath - Vault Path Normalization', () => {
		const mockPlugin = {
			app: {
				vault: {
					adapter: {
						getBasePath: () => '/Users/test/vault',
					},
				},
			},
		} as unknown as LuminaPlugin;

		it('볼트 내부의 절대 경로를 볼트 상대 경로로 정규화한다', () => {
			const absPath = '/Users/test/vault/notes/daily/2026-09-04.md';
			expect(toVaultRelativePath(mockPlugin, absPath)).toBe('notes/daily/2026-09-04.md');
		});

		it('이미 상대 경로인 경우 그대로 정규화한다', () => {
			const relPath = 'notes/subfolder/file.md';
			expect(toVaultRelativePath(mockPlugin, relPath)).toBe('notes/subfolder/file.md');
		});

		it('Windows 경로(역슬래시, 드라이브 문자 대소문자, 슬래시 혼용)를 올바르게 정규화한다', () => {
			const winMock = {
				app: {
					vault: {
						adapter: {
							getBasePath: () => 'C:\\Users\\test\\vault',
						},
					},
				},
			} as unknown as LuminaPlugin;

			// 1. 역슬래시 절대 경로
			expect(toVaultRelativePath(winMock, 'C:\\Users\\test\\vault\\notes\\daily\\2026-09-04.md'))
				.toBe('notes/daily/2026-09-04.md');

			// 2. CLI가 출력하는 포워드 슬래시 절대 경로
			expect(toVaultRelativePath(winMock, 'C:/Users/test/vault/notes/daily/2026-09-04.md'))
				.toBe('notes/daily/2026-09-04.md');

			// 3. 소문자 드라이브 문자 (c:)
			expect(toVaultRelativePath(winMock, 'c:/users/test/vault/notes/daily/2026-09-04.md'))
				.toBe('notes/daily/2026-09-04.md');

			// 4. Windows 역슬래시 상대 경로
			expect(toVaultRelativePath(winMock, 'notes\\subfolder\\file.md'))
				.toBe('notes/subfolder/file.md');
		});

		it('빈 문자열을 안전하게 처리한다', () => {
			expect(toVaultRelativePath(mockPlugin, '')).toBe('');
		});
	});

	describe('CLI Agent Execution Mode (Read vs Edit) Explicit Guarantee', () => {
		const prompt = 'Update my meeting notes';

		it('모든 CLI 에이전트는 읽기 모드(read)에서 파일 수정을 원천 방지해야 한다', () => {
			const claude = new ClaudeCodeProvider({ id: 'c', type: 'claude-code', binaryPath: 'claude', autoApprove: true, isVerified: true });
			const claudeArgs = claude.buildCommandArgs(prompt, { cwd: '/test/vault', agentExecutionMode: 'read', agentEnabled: true });
			expect(claudeArgs).toContain('--allowed-tools');
			const toolIdx = claudeArgs.indexOf('--allowed-tools');
			expect(claudeArgs[toolIdx + 1]).toBe('Read,Grep,Glob,View');
			expect(claudeArgs[1]).toContain('[SYSTEM: You are in READ-ONLY mode. Do NOT create, modify, or delete any files. Inspect and read only.]');

			const agy = new AntigravityProvider({ id: 'a', type: 'antigravity', binaryPath: 'agy', autoApprove: true, isVerified: true });
			const agyArgs = agy.buildCommandArgs(prompt, { cwd: '/test/vault', agentExecutionMode: 'read', agentEnabled: true });
			expect(agyArgs).toContain('--mode');
			const agyModeIdx = agyArgs.indexOf('--mode');
			expect(agyArgs[agyModeIdx + 1]).toBe('plan');

			const codex = new CodexProvider({ id: 'x', type: 'codex', binaryPath: 'codex', autoApprove: true, isVerified: true });
			const codexArgs = codex.buildCommandArgs(prompt, { cwd: '/test/vault', agentExecutionMode: 'read', agentEnabled: true });
			expect(codexArgs).toContain('--sandbox');
			const codexSbIdx = codexArgs.indexOf('--sandbox');
			expect(codexArgs[codexSbIdx + 1]).toBe('read-only');

			const opencode = new OpenCodeProvider({ id: 'o', type: 'opencode', binaryPath: 'opencode', autoApprove: true, isVerified: true });
			const openArgs = opencode.buildCommandArgs(prompt, { cwd: '/test/vault', agentExecutionMode: 'read', agentEnabled: true });
			expect(openArgs).not.toContain('--auto');
			expect(openArgs[1]).toContain('[SYSTEM: You are in READ-ONLY mode. Do NOT edit, create, or delete any files. Inspect and read only.]');
		});

		it('모든 CLI 에이전트는 수정 모드(edit)에서 파일 수정을 자동 승인/허용해야 한다', () => {
			const claude = new ClaudeCodeProvider({ id: 'c', type: 'claude-code', binaryPath: 'claude', autoApprove: true, isVerified: true });
			const claudeArgs = claude.buildCommandArgs(prompt, { cwd: '/test/vault', agentExecutionMode: 'edit', agentEnabled: true });
			expect(claudeArgs).toContain('--dangerously-skip-permissions');

			const agy = new AntigravityProvider({ id: 'a', type: 'antigravity', binaryPath: 'agy', autoApprove: true, isVerified: true });
			const agyArgs = agy.buildCommandArgs(prompt, { cwd: '/test/vault', agentExecutionMode: 'edit', agentEnabled: true });
			const agyModeIdx = agyArgs.indexOf('--mode');
			expect(agyArgs[agyModeIdx + 1]).toBe('accept-edits');
			expect(agyArgs).toContain('--dangerously-skip-permissions');

			const codex = new CodexProvider({ id: 'x', type: 'codex', binaryPath: 'codex', autoApprove: true, isVerified: true });
			const codexArgs = codex.buildCommandArgs(prompt, { cwd: '/test/vault', agentExecutionMode: 'edit', agentEnabled: true });
			expect(codexArgs).not.toContain('--full-auto');
			expect(codexArgs).toContain('--skip-git-repo-check');
			expect(codexArgs).toContain('--sandbox');
			const codexSbIdx = codexArgs.indexOf('--sandbox');
			expect(codexArgs[codexSbIdx + 1]).toBe('workspace-write');
			expect(codexArgs).toContain('-c');
			const codexCIdx = codexArgs.indexOf('-c');
			expect(codexArgs[codexCIdx + 1]).toBe('approval_policy=never');

			const opencode = new OpenCodeProvider({ id: 'o', type: 'opencode', binaryPath: 'opencode', autoApprove: true, isVerified: true });
			const openArgs = opencode.buildCommandArgs(prompt, { cwd: '/test/vault', agentExecutionMode: 'edit', agentEnabled: true });
			expect(openArgs).toContain('--auto');
		});
	});
});
