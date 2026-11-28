import type {
	CliExecuteOptions,
	CliEvent,
} from '../../../../shared/types/cliAgent.types';
import { BaseCliAgent, type CliAgentConfig } from '../base-cli-agent';
import { ProcessManager, getDefaultCwd } from '../process-manager';
import {
	extractTextFromUnknown,
	stripAnsiCodes,
	parseRawCliLine,
	inferFileEditEventsFromToolCall,
} from '../ndjson-parser';
import { debugLogger } from '../../../../shared/debugLogger';

export class AntigravityProvider extends BaseCliAgent {
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
				env: this.config.env,
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
			const trimmed = line.replace(/^[*•\-\s]+/, '').trim();
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

	public buildCommandArgs(prompt: string, options: CliExecuteOptions): string[] {
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

		const eventType = (obj.event || obj.type) as string;

		// 1. Antigravity step_update 이벤트 (한 번에 여러 속성이 올 수 있으므로 모두 수집)
		if (eventType === 'step_update' && obj.step_update && typeof obj.step_update === 'object') {
			const step = obj.step_update as Record<string, unknown>;
			const events: CliEvent[] = [];

			// 사고 과정 (Thinking)
			const stepThinking = extractTextFromUnknown(step.thinking_delta || step.thinking || step.thought);
			if (stepThinking) {
				events.push({ type: 'thinking', content: stepThinking, raw });
			}

			// 파일 편집 감지 (명시적 file_edit / file_change 우선 확인)
			const emittedEditPaths = new Set<string>();
			let explicitFileEditEvent: CliEvent | null = null;
			if (step.file_edit || step.file_change) {
				const fe = (step.file_edit || step.file_change) as Record<string, unknown>;
				const path = (fe.path || fe.file || fe.targetFile || fe.TargetFile || fe.file_path || fe.filePath || '') as string;
				const action = (fe.action || 'modify') as 'create' | 'modify' | 'delete';
				if (path) {
					emittedEditPaths.add(path);
				}
				explicitFileEditEvent = {
					type: 'file_edit',
					fileEdit: { path, action },
					raw,
				};
			}

			// 도구 호출 / 실행 결과 (신규 agy step_type: "tool" 및 기존 step.tool_call / step.tool_result 통합 지원)
			if (step.step_type === 'tool') {
				const toolInfo = (step.tool_info && typeof step.tool_info === 'object' ? step.tool_info : undefined) as Record<string, unknown> | undefined;
				const name = (step.tool_name || toolInfo?.name || step.name || 'tool') as string;
				const args = (toolInfo?.parameters || toolInfo?.arguments || toolInfo?.input || step.parameters || step.arguments || step.input || {}) as Record<string, unknown>;
				const state = String(step.state || '').toUpperCase();

				if (state !== 'DONE') {
					events.push({
						type: 'tool_call',
						toolCall: { name, arguments: args },
						raw,
					});
					for (const inferred of inferFileEditEventsFromToolCall(name, args, raw)) {
						if (inferred.fileEdit && !emittedEditPaths.has(inferred.fileEdit.path)) {
							emittedEditPaths.add(inferred.fileEdit.path);
							events.push(inferred);
						}
					}
				} else {
					const output = extractTextFromUnknown(toolInfo?.output ?? step.output ?? step.result ?? '');
					const error = extractTextFromUnknown(toolInfo?.error ?? step.error ?? '');
					events.push({
						type: 'tool_result',
						toolResult: { name, output, error: error || undefined },
						raw,
					});
				}
			}

			if (step.tool_call || step.step_type === 'tool_call') {
				const tc = (step.tool_call || step) as Record<string, unknown>;
				const toolInfo = (tc.tool_info && typeof tc.tool_info === 'object' ? tc.tool_info : undefined) as Record<string, unknown> | undefined;
				const name = (tc.tool_name || toolInfo?.name || tc.name || 'tool') as string;
				const args = (tc.arguments || tc.input || tc.parameters || toolInfo?.parameters || {}) as Record<string, unknown>;
				events.push({
					type: 'tool_call',
					toolCall: { name, arguments: args },
					raw,
				});
				for (const inferred of inferFileEditEventsFromToolCall(name, args, raw)) {
					if (inferred.fileEdit && !emittedEditPaths.has(inferred.fileEdit.path)) {
						emittedEditPaths.add(inferred.fileEdit.path);
						events.push(inferred);
					}
				}
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

			if (explicitFileEditEvent) {
				events.push(explicitFileEditEvent);
			}

			// 텍스트 청크
			const stepText = extractTextFromUnknown(step.text_delta || step.content || step.text);
			if (stepText) {
				events.push({ type: 'text', content: stepText, raw });
			}

			// 토큰 사용량
			if (step.usage && typeof step.usage === 'object') {
				events.push({
					type: 'usage',
					usage: buildAntigravityUsage(step.usage as Record<string, unknown>),
					raw,
				});
			}

			if (events.length > 0) {
				return events.length === 1 ? events[0] : events;
			}
		}

		// 1.5. Antigravity assistant / message content 배열 내 tool_use · tool_result · text 블록 처리
		const msgObj = (obj.message && typeof obj.message === 'object' ? obj.message : obj) as Record<string, unknown>;
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
					events.push(...inferFileEditEventsFromToolCall(name, args, raw));
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

		// 1.6. 최상위 tool_use / tool_call / tool_result / file_edit 이벤트 처리
		if (eventType === 'tool_use' || eventType === 'tool_call') {
			const name = (obj.name || obj.tool_name || (obj.tool as Record<string, unknown>)?.name || 'tool') as string;
			const args = (obj.input || obj.arguments || {}) as Record<string, unknown>;
			const events: CliEvent[] = [
				{
					type: 'tool_call',
					toolCall: { name, arguments: args },
					raw,
				},
				...inferFileEditEventsFromToolCall(name, args, raw),
			];
			return events.length === 1 ? events[0] : events;
		}

		if (eventType === 'tool_result') {
			const name = (obj.name || obj.tool_name || 'tool') as string;
			const output = extractTextFromUnknown(obj.output || obj.result || '');
			const error = extractTextFromUnknown(obj.error || '');
			return {
				type: 'tool_result',
				toolResult: { name, output, error: error || undefined },
				raw,
			};
		}

		if (eventType === 'file_edit' || eventType === 'file_change') {
			const path = (obj.path || obj.file || obj.targetFile || obj.TargetFile || obj.file_path || obj.filePath || '') as string;
			const action = (obj.action || 'modify') as 'create' | 'modify' | 'delete';
			return {
				type: 'file_edit',
				fileEdit: { path, action },
				raw,
			};
		}

		// 2. 사고 과정 (Thinking / Thought)
		if (eventType === 'thought' || eventType === 'thinking' || obj.thought || obj.thinking) {
			const thoughtText = extractTextFromUnknown(obj.thought || obj.thinking || obj.content || obj.delta);
			if (thoughtText) {
				return { type: 'thinking', content: thoughtText, raw };
			}
		}

		// 3. Antigravity result / response / message 이벤트 (usage 동시 포함 및 중첩 result.usage 지원)
		if (eventType === 'result' || eventType === 'response') {
			const events: CliEvent[] = [];
			const nestedResult = obj.result && typeof obj.result === 'object' ? (obj.result as Record<string, unknown>) : undefined;
			const usageObj = obj.usage || nestedResult?.usage;
			if (usageObj && typeof usageObj === 'object') {
				events.push({
					type: 'usage',
					usage: buildAntigravityUsage(usageObj as Record<string, unknown>),
					raw,
				});
			}
			const resText = extractTextFromUnknown(obj.result || obj.response || obj.data || obj.content);
			if (resText) {
				events.push({ type: 'text', content: resText, raw });
			}
			if (events.length > 0) {
				return events.length === 1 ? events[0] : events;
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
			return {
				type: 'usage',
				usage: buildAntigravityUsage(obj.usage as Record<string, unknown>),
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

/** Antigravity CLI usage 객체에서 캐시 토큰을 포함해 CliUsage를 구성합니다. */
function buildAntigravityUsage(u: Record<string, unknown>): NonNullable<CliEvent['usage']> {
	const cacheCreationTokens = Number(u.cache_creation_tokens || u.cache_creation_input_tokens || 0);
	const cacheReadTokens = Number(
		u.cache_read_tokens || u.cache_read_input_tokens || u.cachedContentTokenCount || u.cached_tokens || 0,
	);
	// agy의 input_tokens에는 이미 cache_read_tokens가 포함되어 있으므로 Anthropic 형식(cache_read_input_tokens)만 추가 합산
	const inputTokens =
		Number(u.input_tokens || u.inputTokens || 0) +
		Number(u.cache_creation_input_tokens || 0) +
		Number(u.cache_read_input_tokens || 0);
	const outputTokens = Number(u.output_tokens || u.outputTokens || 0);
	const totalTokens = Number(u.total_tokens || u.totalTokens || (inputTokens + outputTokens));
	return {
		inputTokens,
		outputTokens,
		totalTokens,
		...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
		...(cacheCreationTokens > 0 ? { cacheCreationTokens } : {}),
	};
}
