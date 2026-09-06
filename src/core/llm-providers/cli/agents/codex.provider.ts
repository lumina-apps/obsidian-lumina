import type {
	AutopilotType,
	AutopilotExecuteOptions,
	AutopilotEvent,
} from '../../../../shared/types/autopilot.types';
import { BaseCliAgent, type CliAgentConfig } from '../base-cli-agent';
import { ProcessManager, getDefaultCwd } from '../process-manager';
import { extractTextFromUnknown, stripAnsiCodes, parseRawCliLine } from '../ndjson-parser';
import { debugLogger } from '../../../../shared/debugLogger';

export class CodexProvider extends BaseCliAgent {
	readonly autopilotType: AutopilotType = 'codex';
	readonly displayName = 'Codex (OpenAI)';

	constructor(config: CliAgentConfig) {
		super(config);
	}

	protected getDefaultBinary(): string {
		return 'codex';
	}

	public static readonly FALLBACK_MODELS: string[] = [
		'o3',
		'o3-mini',
		'o1',
		'gpt-4o',
		'gpt-4o-mini',
	];

	/**
	 * codex models 또는 help를 실행하여 CLI에서 지원하는 실제 모델 목록을 동적으로 가져옵니다.
	 */
	public override async listModels(): Promise<string[]> {
		const binary = this.config.binaryPath || this.getDefaultBinary();
		try {
			const proc = ProcessManager.spawn({
				command: binary,
				args: ['models'],
				cwd: getDefaultCwd(),
				timeoutMs: 15000,
			});

			let output = '';
			proc.onStdout((data) => {
				output += data;
			});

			const exit = await proc.waitForExit();
			if (exit.exitCode === 0 && output.trim()) {
				const models = this.parseModelsOutput(output);
				if (models.length > 0) {
					return models;
				}
			}
		} catch (err) {
			debugLogger.logWarn('cli-agent', `Failed to dynamically list Codex models: ${err instanceof Error ? err.message : String(err)}`);
		}
		return [...CodexProvider.FALLBACK_MODELS];
	}

	public parseModelsOutput(output: string): string[] {
		const clean = stripAnsiCodes(output);
		const lines = clean.split('\n');
		const models: string[] = [];

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;
			const lower = line.toLowerCase();
			if (
				line.startsWith('---') ||
				line.startsWith('===') ||
				lower.startsWith('model') ||
				lower.startsWith('available') ||
				lower.startsWith('usage:') ||
				lower.startsWith('error')
			) {
				continue;
			}

			const trimmed = line.replace(/^[\*\-\•\s]+/, '').trim();
			if (!trimmed) continue;

			const firstToken = trimmed.split(/\s+/)[0];
			if (/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(firstToken) && firstToken.length > 1) {
				if (!models.includes(firstToken)) {
					models.push(firstToken);
				}
			}
		}

		return models;
	}

	public buildCommandArgs(prompt: string, options: AutopilotExecuteOptions): string[] {
		let effectivePrompt = prompt;
		const isAgentEnabled = options.agentEnabled ?? true;
		const isReadOnly = options.agentExecutionMode === 'read';

		if (!isAgentEnabled) {
			effectivePrompt = `[SYSTEM: Tool execution is disabled. Provide answers purely in conversational text.]\n\n${prompt}`;
		} else if (isReadOnly) {
			effectivePrompt = `[SYSTEM: You are in READ-ONLY mode. Do NOT modify, create, or delete any files. Inspect and read only.]\n\n${prompt}`;
		}

		const args: string[] = ['exec', '--json', '--skip-git-repo-check'];

		const model = options.model || this.config.defaultModel;
		if (model && model !== 'default') {
			args.push('--model', model);
		}

		if (!isAgentEnabled || isReadOnly) {
			// 에이전트 비활성화 또는 읽기 모드: 공식 샌드박스 읽기 전용 정책 적용
			args.push('--sandbox', 'read-only');
		} else {
			// 수정 모드: workspace-write 샌드박스 적용 및 자동 승인 여부에 따라 config override 설정
			args.push('--sandbox', 'workspace-write');
			if (options.autoApprove !== false) {
				args.push('-c', 'approval_policy=never');
			} else {
				args.push('-c', 'approval_policy=on-request');
			}
		}

		args.push(effectivePrompt);

		return args;
	}

	protected mapEvent(raw: unknown): AutopilotEvent | AutopilotEvent[] | null {
		if (!raw) return null;

		if (typeof raw === 'string') {
			return parseRawCliLine(raw, raw);
		}

		if (typeof raw !== 'object') return null;
		const obj = raw as Record<string, unknown>;

		if (typeof obj.rawText === 'string') {
			return parseRawCliLine(obj.rawText, raw);
		}

		const eventType = (obj.type || obj.event) as string;
		const item = (obj.item && typeof obj.item === 'object' ? obj.item : undefined) as Record<string, unknown> | undefined;
		const itemType = (item?.type || item?.item_type) as string | undefined;

		// 1. 사고 과정 (Thinking / Reasoning)
		if (
			eventType === 'reasoning' ||
			eventType === 'thinking' ||
			eventType === 'thought' ||
			itemType === 'reasoning' ||
			itemType === 'thinking'
		) {
			const thought = extractTextFromUnknown(
				item?.text || item?.content || item?.thought || item?.reasoning ||
				obj.content || obj.text || obj.thought || obj.reasoning
			);
			if (thought) {
				return { type: 'thinking', content: thought, raw };
			}
		}

		// 2. 텍스트 응답 (agent_message / message / text)
		if (
			eventType === 'agent_message' ||
			eventType === 'message' ||
			eventType === 'text' ||
			itemType === 'agent_message' ||
			itemType === 'assistant_message' ||
			itemType === 'message' ||
			itemType === 'text'
		) {
			const text = extractTextFromUnknown(
				item?.text || item?.content || item?.message || item?.delta ||
				obj.content || obj.text || obj.delta || obj.message
			);
			if (text) {
				return { type: 'text', content: text, raw };
			}
		}

		// 3. 도구/명령어 호출 및 실행 결과 (command_execution / tool_call / tool_use)
		if (
			eventType === 'tool_call' ||
			eventType === 'command_execution' ||
			eventType === 'tool_use' ||
			itemType === 'command_execution' ||
			itemType === 'tool_call' ||
			itemType === 'tool_use' ||
			itemType === 'tool'
		) {
			const name = (
				item?.command || item?.tool || item?.name ||
				obj.tool || obj.name || obj.command || 'command'
			) as string;

			const args = (
				item?.arguments || item?.args || item?.input ||
				(typeof item?.command === 'string' ? { command: item.command } : {}) ||
				obj.arguments || obj.args || obj.input ||
				(typeof obj.command === 'string' ? { command: obj.command } : {}) ||
				{}
			) as Record<string, unknown>;

			const output = extractTextFromUnknown(
				item?.output || item?.stdout || item?.result ||
				obj.output || obj.stdout || obj.result || ''
			);
			const error = extractTextFromUnknown(
				item?.error || item?.stderr ||
				obj.error || obj.stderr || ''
			);
			const status = (item?.status || obj.status) as string | undefined;

			const events: AutopilotEvent[] = [];
			events.push({
				type: 'tool_call',
				toolCall: { name, arguments: args },
				raw,
			});

			if (status === 'completed' || status === 'failed' || status === 'error' || output || error) {
				events.push({
					type: 'tool_result',
					toolResult: { name, output, error: error || undefined },
					raw,
				});
			}

			return events.length === 1 ? events[0] : events;
		}

		// 4. 별도 도구/명령어 결과
		if (eventType === 'tool_result' || eventType === 'command_result' || itemType === 'command_result') {
			const name = (item?.tool || item?.name || item?.command || obj.tool || obj.name || obj.command || 'command') as string;
			const output = extractTextFromUnknown(item?.output || item?.stdout || item?.result || obj.output || obj.stdout || obj.result || '');
			const error = extractTextFromUnknown(item?.error || item?.stderr || obj.error || obj.stderr || '');
			return {
				type: 'tool_result',
				toolResult: { name, output, error: error || undefined },
				raw,
			};
		}

		// 5. 파일 변경 (file_change / file_edit / file_write)
		if (
			eventType === 'file_change' ||
			eventType === 'file_edit' ||
			eventType === 'file_write' ||
			itemType === 'file_change' ||
			itemType === 'file_edit'
		) {
			const path = (item?.path || item?.file || obj.path || obj.file || '') as string;
			const action = (item?.action || item?.change_type || obj.action || 'modify') as 'create' | 'modify' | 'delete';
			return {
				type: 'file_edit',
				fileEdit: { path, action },
				raw,
			};
		}

		// 6. 결과 및 사용량 (turn.completed / usage / result)
		if (eventType === 'turn.completed' || eventType === 'usage' || eventType === 'result') {
			const resText = extractTextFromUnknown(item?.response || item?.result || item?.data || obj.response || obj.result || obj.data);
			if (resText) {
				return { type: 'text', content: resText, raw };
			}
			const u = (obj.usage || item?.usage || obj.tokenUsage) as Record<string, number> | undefined;
			if (u && typeof u === 'object') {
				const inputTokens = u.input_tokens || u.prompt_tokens || u.inputTokens || 0;
				const outputTokens = u.output_tokens || u.completion_tokens || u.outputTokens || 0;
				const totalTokens = u.total_tokens || u.totalTokens || (inputTokens + outputTokens);
				return {
					type: 'usage',
					usage: {
						inputTokens,
						outputTokens,
						totalTokens,
					},
					raw,
				};
			}
		}

		// 7. 에러 (error / turn.failed)
		if (eventType === 'error' || eventType === 'turn.failed') {
			let errorMsg = '';
			if (typeof obj.error === 'string') {
				errorMsg = obj.error;
			} else if (obj.error && typeof obj.error === 'object') {
				const errObj = obj.error as Record<string, unknown>;
				errorMsg = String(errObj.message || errObj.name || JSON.stringify(obj.error));
			} else if (typeof obj.message === 'string') {
				errorMsg = obj.message;
			} else {
				errorMsg = JSON.stringify(obj);
			}
			return { type: 'error', content: errorMsg, raw };
		}

		// 8. 텍스트 청크 및 포괄적 fallback
		const extractedText = extractTextFromUnknown(
			item?.text || item?.content || item?.message || item?.delta ||
			obj.content || obj.text || obj.delta || obj.message
		);
		if (extractedText) {
			return { type: 'text', content: extractedText, raw };
		}

		return null;
	}
}
