import type {
	CliExecuteOptions,
	CliEvent,
} from '../../../../shared/types/cliAgent.types';
import { BaseCliAgent, type CliAgentConfig } from '../base-cli-agent';
import { ProcessManager, getDefaultCwd } from '../process-manager';
import { extractTextFromUnknown, stripAnsiCodes, parseRawCliLine } from '../ndjson-parser';
import { debugLogger } from '../../../../shared/debugLogger';

export class OpenCodeProvider extends BaseCliAgent {
	readonly displayName = 'OpenCode';

	constructor(config: CliAgentConfig) {
		super(config);
	}

	protected getDefaultBinary(): string {
		return 'opencode';
	}

	public static readonly FALLBACK_MODELS: string[] = [
		'opencode/big-pickle',
		'opencode/hy3-free',
		'opencode/mimo-v2.5-free',
		'opencode/nemotron-3.5-lightning-free',
	];

	/**
	 * opencode models 명령어를 실행하여 CLI에서 지원하는 실제 모델 목록을 동적으로 가져옵니다.
	 */
	public override async listModels(): Promise<string[]> {
		const binary = this.config.binaryPath || this.getDefaultBinary();
		try {
			const proc = ProcessManager.spawn({
				command: binary,
				args: ['models'],
				cwd: getDefaultCwd(),
				timeoutMs: 25000,
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
			debugLogger.logWarn('cli-agent', `Failed to dynamically list OpenCode models: ${err instanceof Error ? err.message : String(err)}`);
		}
		return [...OpenCodeProvider.FALLBACK_MODELS];
	}

	/**
	 * opencode models 출력 결과 파싱 (JSON 또는 텍스트 지원)
	 */
	public parseModelsOutput(output: string): string[] {
		const clean = stripAnsiCodes(output).trim();
		if (!clean) return [];

		// 1. JSON 포맷 파싱 시도
		try {
			const parsed: unknown = JSON.parse(clean);
			const extracted: string[] = [];

			const collectModelId = (item: unknown) => {
				if (typeof item === 'string' && item.trim()) {
					extracted.push(item.trim());
				} else if (item && typeof item === 'object') {
					const obj = item as Record<string, unknown>;
					const id = obj.id || obj.name || obj.model || obj.modelId;
					if (typeof id === 'string' && id.trim()) {
						extracted.push(id.trim());
					}
				}
			};

			if (Array.isArray(parsed)) {
				for (const item of parsed) collectModelId(item);
			} else if (typeof parsed === 'object' && parsed !== null) {
				const container = parsed as Record<string, unknown>;
				const list = container.models || container.data || container.items;
				if (Array.isArray(list)) {
					for (const item of list) collectModelId(item);
				}
			}

			if (extracted.length > 0) {
				return Array.from(new Set(extracted));
			}
		} catch {
			// JSON이 아니면 텍스트 라인 파싱 진행
		}

		// 2. 텍스트 라인 파싱
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
				lower.startsWith('commands:') ||
				lower.startsWith('options:') ||
				lower.startsWith('error')
			) {
				continue;
			}

			const trimmed = line.replace(/^[*•\-\s]+/, '').trim();
			if (!trimmed) continue;

			// 첫 번째 토큰 (예: "anthropic/claude-3-5-sonnet", "openai/gpt-4o", "deepseek-r1" 등)
			const firstToken = trimmed.split(/\s+/)[0];
			if (/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(firstToken) && firstToken.length > 1) {
				if (!models.includes(firstToken)) {
					models.push(firstToken);
				}
			}
		}

		return models;
	}

	public buildCommandArgs(prompt: string, options: CliExecuteOptions): string[] {
		let effectivePrompt = prompt;
		const isAgentEnabled = options.agentEnabled ?? true;
		const isReadOnly = options.agentExecutionMode === 'read';

		if (!isAgentEnabled) {
			effectivePrompt = `[SYSTEM: Tool execution is disabled. Respond with conversational text only.]\n\n${prompt}`;
		} else if (isReadOnly) {
			effectivePrompt = `[SYSTEM: You are in READ-ONLY mode. Do NOT edit, create, or delete any files. Inspect and read only.]\n\n${prompt}`;
		}

		const args: string[] = ['run', effectivePrompt, '--format', 'json', '--thinking'];

		if (options.cwd) {
			args.push('--dir', options.cwd);
		}

		const model = options.model || this.config.defaultModel;
		if (model && model !== 'default') {
			args.push('--model', model);
		}

		// 수정 모드: 자동 승인 플래그(--auto) 적용
		if (isAgentEnabled && !isReadOnly) {
			if (options.autoApprove ?? this.config.autoApprove) {
				args.push('--auto');
			}
		}

		return args;
	}

	protected mapEvent(raw: unknown): CliEvent | CliEvent[] | null {
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
		const part = (obj.part && typeof obj.part === 'object' ? obj.part : undefined) as Record<string, unknown> | undefined;
		const partType = part?.type as string | undefined;

		// 1. 사고 과정 (Thinking/Thought/Reasoning)
		if (
			eventType === 'thinking' ||
			eventType === 'thought' ||
			eventType === 'reasoning' ||
			partType === 'reasoning'
		) {
			const thought = extractTextFromUnknown(
				part?.text || part?.content || part?.thought || obj.content || obj.thought || obj.thinking || obj.text
			);
			if (thought) {
				return { type: 'thinking', content: thought, raw };
			}
		}

		// 2. 텍스트 응답 (Text)
		if (eventType === 'text' || partType === 'text') {
			const text = extractTextFromUnknown(
				part?.text || part?.content || obj.content || obj.text || obj.delta || obj.message
			);
			if (text) {
				return { type: 'text', content: text, raw };
			}
		}

		// 3. 도구 호출 및 실행 결과 (Tool Use / Tool Call / Tool Result)
		if (
			eventType === 'tool_call' ||
			eventType === 'tool_use' ||
			eventType === 'call' ||
			partType === 'tool'
		) {
			const toolName = (
				part?.tool ||
				obj.name ||
				(obj.tool as Record<string, unknown>)?.name ||
				obj.tool ||
				'tool'
			) as string;

			const state = (part?.state && typeof part.state === 'object' ? part.state : undefined) as Record<string, unknown> | undefined;
			const args = (
				state?.input ||
				part?.input ||
				obj.input ||
				obj.arguments ||
				obj.args ||
				{}
			) as Record<string, unknown>;

			const output = extractTextFromUnknown(
				state?.output || part?.output || obj.output || obj.result || ''
			);
			const error = extractTextFromUnknown(
				state?.error || part?.error || obj.error || ''
			);
			const status = (state?.status || obj.status) as string | undefined;

			const events: CliEvent[] = [];

			events.push({
				type: 'tool_call',
				toolCall: { name: toolName, arguments: args },
				raw,
			});

			const candidatePath = (args.path || args.file || args.targetFile || args.filePath) as string | undefined;
			if (candidatePath && typeof candidatePath === 'string') {
				const lowerName = toolName.toLowerCase();
				if (lowerName.includes('write') || lowerName.includes('edit') || lowerName.includes('create') || lowerName.includes('modify')) {
					events.push({
						type: 'file_edit',
						fileEdit: { path: candidatePath, action: 'modify' },
						raw,
					});
				} else if (lowerName.includes('delete') || lowerName.includes('remove')) {
					events.push({
						type: 'file_edit',
						fileEdit: { path: candidatePath, action: 'delete' },
						raw,
					});
				}
			}

			if (status === 'completed' || status === 'error' || output || error) {
				events.push({
					type: 'tool_result',
					toolResult: { name: toolName, output, error: error || undefined },
					raw,
				});
			}

			return events.length === 1 ? events[0] : events;
		}

		// 4. 별도 도구 결과 (Tool Result)
		if (eventType === 'tool_result' || eventType === 'result') {
			if (obj.output !== undefined || obj.result !== undefined || obj.error !== undefined) {
				const name = (obj.name || obj.tool || 'tool') as string;
				const output = extractTextFromUnknown(obj.output || obj.result || '');
				const error = extractTextFromUnknown(obj.error || '');
				return {
					type: 'tool_result',
					toolResult: { name, output, error: error || undefined },
					raw,
				};
			}
		}

		// 5. 파일 편집 (File Edit)
		if (eventType === 'file_edit' || eventType === 'file_write' || eventType === 'file_change') {
			const path = (obj.path || obj.file || '') as string;
			const action = (obj.action || 'modify') as 'create' | 'modify' | 'delete';
			return {
				type: 'file_edit',
				fileEdit: { path, action },
				raw,
			};
		}

		// 6. 스텝 완료 및 토큰 사용량 (Step Finish / Usage / Summary)
		if (
			eventType === 'step_finish' ||
			eventType === 'usage' ||
			eventType === 'summary' ||
			partType === 'step-finish'
		) {
			const resText = extractTextFromUnknown(obj.response || obj.result || obj.data);
			if (resText) {
				return { type: 'text', content: resText, raw };
			}

			const tokens = (part?.tokens || obj.usage || obj.tokenUsage) as Record<string, unknown> | undefined;
			if (tokens && typeof tokens === 'object') {
				const inputTokens = Number(tokens.input || tokens.inputTokens || tokens.input_tokens || 0);
				const outputTokens = Number(tokens.output || tokens.outputTokens || tokens.output_tokens || 0);
				const totalTokens = Number(tokens.total || tokens.totalTokens || tokens.total_tokens || (inputTokens + outputTokens));
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

		// 7. 에러 (Error)
		if (eventType === 'error') {
			let errorMsg = '';
			if (typeof obj.error === 'string') {
				errorMsg = obj.error;
			} else if (obj.error && typeof obj.error === 'object') {
				const errObj = obj.error as Record<string, unknown>;
				const dataObj = errObj.data as Record<string, unknown> | undefined;
				errorMsg = String(dataObj?.message || errObj.message || errObj.name || JSON.stringify(obj.error));
			} else if (typeof obj.message === 'string') {
				errorMsg = obj.message;
			} else {
				errorMsg = JSON.stringify(obj);
			}
			return { type: 'error', content: errorMsg, raw };
		}

		// 8. 스텝 시작 상태 알림 (Step Start)
		if (eventType === 'step_start' || partType === 'step-start') {
			return { type: 'activity_status', content: 'Processing...', raw };
		}

		// 9. 텍스트 청크 및 포괄적 fallback
		const extractedText = extractTextFromUnknown(
			part?.text || part?.content || obj.content || obj.text || obj.delta || obj.message
		);
		if (extractedText) {
			return { type: 'text', content: extractedText, raw };
		}

		return null;
	}
}
