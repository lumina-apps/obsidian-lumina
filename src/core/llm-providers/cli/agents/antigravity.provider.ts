import type {
	AutopilotType,
	AutopilotExecuteOptions,
	AutopilotEvent,
} from '../../../../shared/types/autopilot.types';
import { BaseCliAgent, type CliAgentConfig } from '../base-cli-agent';
import { ProcessManager, getDefaultCwd } from '../process-manager';
import { extractTextFromUnknown, stripAnsiCodes, parseRawCliLine } from '../ndjson-parser';
import { debugLogger } from '../../../../shared/debugLogger';

export class AntigravityProvider extends BaseCliAgent {
	readonly autopilotType: AutopilotType = 'antigravity';
	readonly displayName = 'Antigravity (Google)';

	constructor(config: CliAgentConfig) {
		super(config);
	}

	protected getDefaultBinary(): string {
		return 'agy';
	}

	public static readonly FALLBACK_MODELS: string[] = [
		'gemini-3.8-flash-medium',
		'gemini-3.8-flash-high',
		'gemini-3.7-flash-medium',
		'gemini-3.1-pro-high',
		'claude-sonnet-4-6',
	];

	/**
	 * agy models 명령어를 실행하여 지원 모델 목록을 동적으로 조회합니다.
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
			debugLogger.logWarn('cli-agent', `Failed to dynamically list Antigravity models: ${err instanceof Error ? err.message : String(err)}`);
		}
		return [...AntigravityProvider.FALLBACK_MODELS];
	}

	/**
	 * agy models 명령어의 출력(JSON 또는 텍스트)을 파싱하여 모델 식별자 배열을 추출합니다.
	 */
	public parseModelsOutput(output: string): string[] {
		const clean = stripAnsiCodes(output).trim();
		if (!clean) return [];

		// 1. JSON 포맷 파싱 시도
		try {
			const parsed = JSON.parse(clean);
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
			// JSON이 아닌 경우 텍스트 라인 파싱으로 진행
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
				lower.startsWith('fetching') ||
				lower.startsWith('usage:') ||
				lower.startsWith('flags:') ||
				lower.startsWith('error')
			) {
				continue;
			}

			// 불릿 기호(*, -, •) 제거
			const trimmed = line.replace(/^[\*\-\•\s]+/, '').trim();
			if (!trimmed) continue;

			// 첫 번째 단어 (공백이나 탭 기준 분리)
			const firstToken = trimmed.split(/\s+/)[0];
			// 유효한 모델 ID 패턴: 영문/숫자로 시작하고 하이픈, 마침표, 언더스코어 포함
			if (/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(firstToken) && firstToken.length > 2) {
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
			effectivePrompt = `[SYSTEM: Tool execution is disabled. Provide a direct conversational answer.]\n\n${prompt}`;
		} else if (isReadOnly) {
			effectivePrompt = `[SYSTEM: You are in READ-ONLY mode. Do NOT modify files or run destructive commands. Inspect only.]\n\n${prompt}`;
		}

		const args: string[] = ['--output-format', 'stream-json'];

		const model = options.model || this.config.defaultModel;
		if (model && model !== 'default') {
			args.push('--model', model);
		}

		if (!isAgentEnabled || isReadOnly) {
			// 에이전트 비활성화 또는 읽기 모드: 계획(plan) 모드로 파일 수정을 방지
			args.push('--mode', 'plan');
		} else {
			// 수정 모드: accept-edits 모드 적용
			args.push('--mode', 'accept-edits');
		}

		// 헤드리스(--print) 비대화형 실행 모드에서는 TTY 대화형 권한 확인이 불가능하므로
		// read_file 등 도구 조회가 auto-denied 되는 오류를 방지하기 위해 항상 권한 스킵을 적용
		args.push('--dangerously-skip-permissions');

		// 프롬프트는 --print 플래그의 인자로 전달
		args.push('--print', effectivePrompt);

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

		const eventType = (obj.event || obj.type) as string;

		// 1. Antigravity step_update 이벤트 (한 번에 여러 속성이 올 수 있으므로 모두 수집)
		if (eventType === 'step_update' && obj.step_update && typeof obj.step_update === 'object') {
			const step = obj.step_update as Record<string, unknown>;
			const events: AutopilotEvent[] = [];

			// 사고 과정 (Thinking)
			const stepThinking = extractTextFromUnknown(step.thinking_delta || step.thinking || step.thought);
			if (stepThinking) {
				events.push({ type: 'thinking', content: stepThinking, raw });
			}

			// 도구 호출
			if (step.tool_call || step.step_type === 'tool_call') {
				const tc = (step.tool_call || step) as Record<string, unknown>;
				const name = (tc.tool_name || tc.name || 'tool') as string;
				const args = (tc.arguments || tc.input || {}) as Record<string, unknown>;
				events.push({
					type: 'tool_call',
					toolCall: { name, arguments: args },
					raw,
				});
			}

			// 도구 결과
			if (step.tool_result || step.step_type === 'tool_result') {
				const tr = (step.tool_result || step) as Record<string, unknown>;
				const name = (tr.tool_name || tr.name || 'tool') as string;
				const output = extractTextFromUnknown(tr.output || tr.result || '');
				const error = extractTextFromUnknown(tr.error || '');
				events.push({
					type: 'tool_result',
					toolResult: { name, output, error: error || undefined },
					raw,
				});
			}

			// 파일 편집 감지
			if (step.file_edit || step.file_change) {
				const fe = (step.file_edit || step.file_change) as Record<string, unknown>;
				const path = (fe.path || fe.file || '') as string;
				const action = (fe.action || 'modify') as 'create' | 'modify' | 'delete';
				events.push({
					type: 'file_edit',
					fileEdit: { path, action },
					raw,
				});
			}

			// 텍스트 청크
			const stepText = extractTextFromUnknown(step.text_delta || step.content || step.text);
			if (stepText) {
				events.push({ type: 'text', content: stepText, raw });
			}

			// 토큰 사용량
			if (step.usage && typeof step.usage === 'object') {
				const u = step.usage as Record<string, number>;
				events.push({
					type: 'usage',
					usage: {
						inputTokens: u.input_tokens || u.inputTokens,
						outputTokens: u.output_tokens || u.outputTokens,
						totalTokens: u.total_tokens || u.totalTokens,
					},
					raw,
				});
			}

			if (events.length > 0) {
				return events.length === 1 ? events[0] : events;
			}
		}

		// 2. 사고 과정 (Thinking / Thought)
		if (eventType === 'thought' || eventType === 'thinking' || obj.thought || obj.thinking) {
			const thoughtText = extractTextFromUnknown(obj.thought || obj.thinking || obj.content || obj.delta);
			if (thoughtText) {
				return { type: 'thinking', content: thoughtText, raw };
			}
		}

		// 3. Antigravity result / response / message 이벤트
		if (eventType === 'result' || eventType === 'response') {
			const resText = extractTextFromUnknown(obj.result || obj.response || obj.data || obj.content);
			if (resText) {
				return { type: 'text', content: resText, raw };
			}
		}

		// 4. Gemini Candidates 형식 ({ candidates: [{ content: { parts: [{ text: "..." }] } }] })
		if (Array.isArray(obj.candidates) && obj.candidates.length > 0) {
			const cand = obj.candidates[0] as Record<string, unknown>;
			const candText = extractTextFromUnknown(cand.content || cand);
			if (candText) {
				return { type: 'text', content: candText, raw };
			}
		}

		// 5. Message 이벤트 ({ type: "message", role: "assistant", content: ... })
		if (eventType === 'message') {
			const msgText = extractTextFromUnknown(obj.content || obj.message);
			if (msgText) {
				return { type: 'text', content: msgText, raw };
			}
		}

		// 6. 일반적인 텍스트 / 델타 fallback
		if (eventType === 'text' || eventType === 'content_block_delta' || eventType === 'text_delta') {
			const delta = obj.delta as Record<string, unknown> | undefined;
			if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
				return { type: 'text', content: stripAnsiCodes(delta.text), raw };
			}
			const extracted = extractTextFromUnknown(obj.content || obj.text || obj.delta);
			if (extracted) {
				return { type: 'text', content: extracted, raw };
			}
		}

		// 7. 에러 이벤트
		if (eventType === 'error') {
			const errorMsg = (obj.message || obj.error || JSON.stringify(obj)) as string;
			return { type: 'error', content: errorMsg, raw };
		}

		// 8. 사용량 (Usage) 이벤트
		if (obj.usage && typeof obj.usage === 'object') {
			const u = obj.usage as Record<string, number>;
			return {
				type: 'usage',
				usage: {
					inputTokens: u.input_tokens || u.inputTokens,
					outputTokens: u.output_tokens || u.outputTokens,
					totalTokens: u.total_tokens || u.totalTokens,
				},
				raw,
			};
		}

		// 9. 포괄적 텍스트 추출 fallback
		const fallbackText = extractTextFromUnknown(obj.content || obj.text || obj.message || obj.delta);
		if (fallbackText) {
			return { type: 'text', content: fallbackText, raw };
		}

		return null;
	}
}
