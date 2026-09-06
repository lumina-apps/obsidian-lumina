import type {
	CliExecuteOptions,
	CliEvent,
} from '../../../../shared/types/cliAgent.types';
import { BaseCliAgent, type CliAgentConfig } from '../base-cli-agent';
import { extractTextFromUnknown, stripAnsiCodes, parseRawCliLine } from '../ndjson-parser';

export class ClaudeCodeProvider extends BaseCliAgent {
	readonly displayName = 'Claude Code';

	constructor(config: CliAgentConfig) {
		super(config);
	}

	protected getDefaultBinary(): string {
		return 'claude';
	}

	public static readonly FALLBACK_MODELS: string[] = [
		'claude-3-7-sonnet',
		'claude-3-5-sonnet',
		'claude-3-5-haiku',
	];

	/**
	 * claude CLI는 모델 목록 커맨드가 없으므로 공식 지원 모델 목록을 즉시 반환합니다.
	 */
	public override async listModels(): Promise<string[]> {
		return [...ClaudeCodeProvider.FALLBACK_MODELS];
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

			const trimmed = line.replace(/^[*•\-\s]+/, '').trim();
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

	public buildCommandArgs(prompt: string, options: CliExecuteOptions): string[] {
		let effectivePrompt = prompt;
		const isAgentEnabled = options.agentEnabled ?? true;
		const isReadOnly = options.agentExecutionMode === 'read';

		if (!isAgentEnabled) {
			effectivePrompt = `[SYSTEM: Tool use is disabled. Provide answers purely in conversational text without invoking any tools.]\n\n${prompt}`;
		} else if (isReadOnly) {
			effectivePrompt = `[SYSTEM: You are in READ-ONLY mode. Do NOT create, modify, or delete any files. Inspect and read only.]\n\n${prompt}`;
		}

		const args: string[] = ['-p', effectivePrompt, '--output-format', 'stream-json', '--verbose'];

		const model = options.model || this.config.defaultModel;
		if (model && model !== 'default') {
			args.push('--model', model);
		}

		if (!isAgentEnabled) {
			// 에이전트 비활성화 시: 공식 --disallowed-tools '*' 플래그로 모든 도구 차단
			args.push('--disallowed-tools', '*');
		} else if (isReadOnly) {
			// 읽기 모드: 읽기 및 탐색 공식 내장 도구(Read, Grep, Glob, View)만 화이트리스트 지정 및 파괴적 도구(Edit, Write, Bash) 명시적 차단
			const readTools = ['Read', 'Grep', 'Glob', 'View'];
			args.push('--allowed-tools', readTools.join(','));
			args.push('--disallowed-tools', 'Edit,Write,Bash');
			args.push('--dangerously-skip-permissions');
		} else {
			// 수정 모드: 모든 권한 허용 (특정 도구 필터가 있는 경우만 --allowed-tools 지정하고, 기본은 --dangerously-skip-permissions로 전체 허용)
			const allowedTools = options.allowedTools || this.config.allowedTools;
			if (allowedTools && allowedTools.length > 0) {
				args.push('--allowed-tools', allowedTools.join(','));
			}
			args.push('--dangerously-skip-permissions');
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

		const innerEvent = (obj.event && typeof obj.event === 'object' ? obj.event : undefined) as Record<string, unknown> | undefined;
		const eventType = (innerEvent?.type || obj.type || obj.event) as string;
		const effectiveObj = innerEvent || obj;

		// 1. Anthropic 스트림 델타
		if (eventType === 'content_block_delta') {
			const delta = (effectiveObj.delta || obj.delta) as Record<string, unknown> | undefined;
			if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
				return { type: 'text', content: stripAnsiCodes(delta.text), raw };
			}
			if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
				return { type: 'thinking', content: stripAnsiCodes(delta.thinking), raw };
			}
			if (typeof delta?.text === 'string') {
				return { type: 'text', content: stripAnsiCodes(delta.text), raw };
			}
		}

		// 2. Anthropic content_block_start
		if (eventType === 'content_block_start' && (effectiveObj.content_block || obj.content_block) && typeof (effectiveObj.content_block || obj.content_block) === 'object') {
			const cb = (effectiveObj.content_block || obj.content_block) as Record<string, unknown>;
			if (cb.type === 'tool_use' || cb.type === 'tool_call') {
				const name = (cb.name || 'tool') as string;
				const args = (cb.input || cb.arguments || {}) as Record<string, unknown>;
				return {
					type: 'tool_call',
					toolCall: { name, arguments: args },
					raw,
				};
			}
			if (cb.type === 'thinking' && typeof cb.thinking === 'string') {
				return { type: 'thinking', content: stripAnsiCodes(cb.thinking), raw };
			}
		}

		// 3. 중첩된 message / content 배열 처리 (assistant 또는 user 이벤트)
		const msgObj = (effectiveObj.message && typeof effectiveObj.message === 'object' ? effectiveObj.message : (obj.message && typeof obj.message === 'object' ? obj.message : effectiveObj)) as Record<string, unknown>;
		if (Array.isArray(msgObj.content)) {
			const events: CliEvent[] = [];
			for (const block of msgObj.content) {
				if (!block || typeof block !== 'object') continue;
				const b = block as Record<string, unknown>;
				const bType = (b.type || b.event) as string;

				if (bType === 'thinking' || b.thinking) {
					const thought = extractTextFromUnknown(b.thinking || b.content || b.text);
					if (thought) {
						events.push({ type: 'thinking', content: thought, raw });
					}
				} else if (bType === 'tool_use' || bType === 'tool_call' || b.name) {
					const name = (b.name || (b.tool as Record<string, unknown>)?.name || 'tool') as string;
					const args = (b.input || b.arguments || {}) as Record<string, unknown>;
					events.push({
						type: 'tool_call',
						toolCall: { name, arguments: args },
						raw,
					});

					const candidatePath = (args.file_path || args.path || args.file || args.targetFile || args.filePath) as string | undefined;
					if (candidatePath && typeof candidatePath === 'string') {
						const lowerName = name.toLowerCase();
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
				} else if (bType === 'tool_result') {
					const name = (b.name || 'tool') as string;
					const output = extractTextFromUnknown(b.output || b.result || b.content || '');
					const error = extractTextFromUnknown(b.error || '');
					events.push({
						type: 'tool_result',
						toolResult: { name, output, error: error || undefined },
						raw,
					});
				} else if (bType === 'text' || b.text) {
					const text = extractTextFromUnknown(b.text || b.content);
					if (text) {
						events.push({ type: 'text', content: text, raw });
					}
				}
			}
			if (events.length > 0) {
				return events.length === 1 ? events[0] : events;
			}
		}

		// 4. 사고 과정 (Thinking)
		if (eventType === 'thinking' || eventType === 'reasoning') {
			const thought = extractTextFromUnknown(effectiveObj.content || effectiveObj.thinking || effectiveObj.text || obj.content || obj.thinking || obj.text);
			if (thought) {
				return { type: 'thinking', content: thought, raw };
			}
		}

		// 5. 도구 호출
		if (eventType === 'tool_use' || eventType === 'tool_call') {
			const name = (effectiveObj.name || (effectiveObj.tool as Record<string, unknown>)?.name || obj.name || (obj.tool as Record<string, unknown>)?.name || 'tool') as string;
			const args = (effectiveObj.input || effectiveObj.arguments || obj.input || obj.arguments || {}) as Record<string, unknown>;
			const events: CliEvent[] = [
				{
					type: 'tool_call',
					toolCall: { name, arguments: args },
					raw,
				},
			];

			const candidatePath = (args.file_path || args.path || args.file || args.targetFile || args.filePath) as string | undefined;
			if (candidatePath && typeof candidatePath === 'string') {
				const lowerName = name.toLowerCase();
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

			return events.length === 1 ? events[0] : events;
		}

		// 6. 도구 결과
		if (eventType === 'tool_result') {
			const name = (effectiveObj.name || obj.name || 'tool') as string;
			const output = extractTextFromUnknown(effectiveObj.output || effectiveObj.result || obj.output || obj.result || '');
			const error = extractTextFromUnknown(effectiveObj.error || obj.error || '');
			return {
				type: 'tool_result',
				toolResult: { name, output, error: error || undefined },
				raw,
			};
		}

		// 7. 파일 편집
		if (eventType === 'file_edit' || eventType === 'file_change') {
			const path = (effectiveObj.path || effectiveObj.file || obj.path || obj.file || '') as string;
			const action = (effectiveObj.action || obj.action || 'modify') as 'create' | 'modify' | 'delete';
			return {
				type: 'file_edit',
				fileEdit: { path, action },
				raw,
			};
		}

		// 8. 결과 및 토큰 사용량
		if (
			eventType === 'result' ||
			eventType === 'usage' ||
			eventType === 'message_delta' ||
			eventType === 'message_start'
		) {
			const events: CliEvent[] = [];
			const usageObj = (effectiveObj.usage ||
				obj.usage ||
				(effectiveObj.message as Record<string, unknown> | undefined)?.usage ||
				(obj.message as Record<string, unknown> | undefined)?.usage) as Record<string, number> | undefined;
			if (usageObj && typeof usageObj === 'object') {
				events.push({
					type: 'usage',
					usage: {
						inputTokens: usageObj.input_tokens || usageObj.inputTokens || 0,
						outputTokens: usageObj.output_tokens || usageObj.outputTokens || 0,
						totalTokens: (usageObj.input_tokens || usageObj.inputTokens || 0) + (usageObj.output_tokens || usageObj.outputTokens || 0),
					},
					raw,
				});
			}

			const resultText = extractTextFromUnknown(effectiveObj.result || effectiveObj.data || effectiveObj.response || obj.result || obj.data || obj.response);
			if (resultText) {
				events.push({ type: 'text', content: resultText, raw });
			}

			if (events.length > 0) {
				return events.length === 1 ? events[0] : events;
			}
		}

		// 9. 에러
		if (eventType === 'error') {
			const errObj = obj.error as Record<string, unknown> | undefined;
			const errorMsg =
				(errObj?.message || obj.message || obj.error || JSON.stringify(obj)) as string;
			return { type: 'error', content: errorMsg, raw };
		}

		// 10. 텍스트 청크
		const extractedText = extractTextFromUnknown(obj.content || obj.text || obj.message || obj.delta);
		if (extractedText) {
			return { type: 'text', content: extractedText, raw };
		}

		return null;
	}
}
