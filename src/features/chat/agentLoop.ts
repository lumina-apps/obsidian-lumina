/**
 * agentLoop.ts
 *
 * MCP tool-calling 에이전트 루프.
 * chatController.ts의 sendMessage에서 분리된 while-loop 로직을 담당한다.
 *
 * 역할:
 *   - LLM 호출 → tool call 감지 → tool 실행 → 결과 주입 → 반복
 *   - 최대 라운드(maxRounds) 또는 tool call 없음 → 루프 종료
 *   - 중복 tool call 3회 연속 감지 시 강제 종료
 *   - streaming / non-streaming, cloud(bindTools) / local(textTools) 모드 모두 지원
 */

import { t } from '../../shared/locales/helpers';
import type { ChatMessage, ChatOptions, ToolCall, TokenUsage, ILLMProvider } from '../../shared/types/llm.types';
import type { ChatSettings } from '../../core/settings/settings.types';
import type { McpManager } from '../../core/mcp/mcpManager';
import { appendChunk, syncMessageContent } from '../../core/store/chatStore';
import { debugLogger as originalDebugLogger } from '../../shared/debugLogger';
import { parseTextToolCalls } from './utils/textToolParser';

interface IDebugLogger {
	logMcp(action: string, message: string, data?: unknown): void;
}
const debugLogger = originalDebugLogger as unknown as IDebugLogger;

const MAX_TOOL_RESULT_CHARS = 4000;

// ─── 공개 타입 ───────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
	/** 어시스턴트 메시지 ID (chatStore에서 UI 업데이트 시 사용) */
	assistantId: string;
	/** LLM에 보낼 현재 메시지 배열 (복사본을 전달할 것) */
	messagesForLLM: ChatMessage[];
	chatOptions: ChatOptions;
	provider: ILLMProvider;
	chatSettings: ChatSettings;
	mcpManager: McpManager | null;
	/** toolName → serverId 매핑 */
	toolServerMap: Record<string, string>;
	/** true = 로컬/추론 모델 텍스트 파싱 모드, false = bindTools 모드 */
	useTextTools: boolean;
	signal?: AbortSignal;
}

export interface AgentLoopResult {
	fullResponse: string;
	tokenUsage: TokenUsage | undefined;
	hasTokenLimitBeenHit: boolean;
}

// ─── 공개 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * LLM finishReason이 토큰 한도 도달을 의미하는지 판단한다.
 * streaming / non-streaming / tool loop 세 곳에서 공통 사용.
 */
export function isTokenLimitReached(finishReason?: string): boolean {
	return (
		finishReason === 'length' ||
		finishReason === 'max_tokens' ||
		finishReason === 'MAX_TOKENS'
	);
}

// ─── 메인 에이전트 루프 ───────────────────────────────────────────────────────

/**
 * MCP tool calling 루프를 실행한다.
 * tool call이 없거나 maxRounds에 도달하면 반환한다.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
	const {
		assistantId,
		chatOptions,
		provider,
		chatSettings,
		mcpManager,
		toolServerMap,
		useTextTools,
		signal,
	} = opts;

	const maxRounds = chatSettings.agentMaxSteps || 15;
	let toolRound = 0;
	let messagesForLLM = [...opts.messagesForLLM];
	let lastToolCallKeys: string[] = []; // 중복 호출 감지용 (최근 2개 키)

	let fullResponse = '';
	let accumulatedText = '';
	let tokenUsage: TokenUsage | undefined;
	let hasTokenLimitBeenHit = false;

	while (toolRound < maxRounds) {
		if (signal?.aborted) break;
		toolRound++;

		debugLogger.logMcp('Loop Round', `🔄 툴 루프 라운드 ${toolRound}/${maxRounds} 시작`);

		// ── LLM 호출 ──────────────────────────────────────────────────────────
		let currentChunkText = '';
		const rawResponse = await provider.chat(messagesForLLM, chatOptions, (chunk) => {
			if (chatSettings.streaming) {
				currentChunkText += chunk;
				fullResponse = accumulatedText + (accumulatedText && currentChunkText ? '\n\n' : '') + currentChunkText;
				appendChunk(assistantId, chunk);
			}
		});

		// ── 토큰 한도 체크 ────────────────────────────────────────────────────
		if (isTokenLimitReached(rawResponse.finishReason)) {
			hasTokenLimitBeenHit = true;
			fullResponse = accumulatedText || (rawResponse.content || '');
			if (!useTextTools && fullResponse) {
				fullResponse = fullResponse.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, '').trim();
			}
			break;
		}

		// ── 텍스트 기반 tool call 파싱 (로컬 모델) ───────────────────────────
		let resolvedToolCalls = rawResponse.toolCalls;
		let currentRoundText = rawResponse.content || '';

		if (useTextTools && currentRoundText) {
			const parsed = parseTextToolCalls(currentRoundText);
			if (parsed.toolCalls.length > 0) {
				debugLogger.logMcp('Text Parse', `📝 텍스트 tool call 파싱: ${parsed.toolCalls.length}개 발견`, parsed.toolCalls.map(tc => tc.name));
				resolvedToolCalls = parsed.toolCalls;
				currentRoundText = parsed.cleanContent;
			}
		}

		// ── 현재 라운드 텍스트 누적 ───────────────────────────────────────────
		if (currentRoundText.trim()) {
			let textToAdd = currentRoundText;
			// 툴 호출이 있는 중간 라운드라면 텍스트를 <think>로 래핑 (추론 과정으로 표시)
			if (resolvedToolCalls && resolvedToolCalls.length > 0) {
				const stripped = textToAdd.replace(/<\/?think>/gi, '').trim();
				textToAdd = stripped ? `<think>\n${stripped}\n</think>` : '';
			}
			if (textToAdd) {
				accumulatedText = accumulatedText ? accumulatedText + '\n\n' + textToAdd : textToAdd;
			}
		}

		// ── token usage 누적 ──────────────────────────────────────────────────
		if (rawResponse.usage) {
			if (!tokenUsage) {
				tokenUsage = { ...rawResponse.usage };
			} else {
				tokenUsage.inputTokens += rawResponse.usage.inputTokens;
				tokenUsage.outputTokens += rawResponse.usage.outputTokens;
				tokenUsage.totalTokens += rawResponse.usage.totalTokens;
			}
		}

		debugLogger.logMcp('LLM Output', `LLM 응답: content=${currentRoundText?.length ?? 0}자, toolCalls=${resolvedToolCalls?.length ?? 0}개`);

		// ── tool call이 없으면 종료 ───────────────────────────────────────────
		if (!resolvedToolCalls || resolvedToolCalls.length === 0) {
			fullResponse = accumulatedText;
			debugLogger.logMcp('Loop End', `✅ 툴 루프 완료 (라운드 ${toolRound}), 최종 응답: ${fullResponse.length}자`);
			if (!chatSettings.streaming) {
				appendChunk(assistantId, fullResponse);
			} else {
				// 스트리밍 중이라도 최종적으로 UI를 깨끗하게 동기화
				syncMessageContent(assistantId, fullResponse);
			}
			break;
		}

		// ── streaming 시 UI 정리 (툴 호출 코드 제거) ─────────────────────────
		if (chatSettings.streaming) {
			fullResponse = accumulatedText;
			syncMessageContent(assistantId, fullResponse);
		}

		// ── 중복 호출 감지 ────────────────────────────────────────────────────
		const currentKey = buildToolCallKey(resolvedToolCalls);
		if (lastToolCallKeys.length >= 2 && lastToolCallKeys.every(k => k === currentKey)) {
			debugLogger.logMcp('Loop Error', '⚠️ 동일한 툴 호출 3회 연속 감지, 루프 강제 종료');
			fullResponse = accumulatedText || t('uiMessages.agentRepeatedToolCalls');
			appendChunk(assistantId, fullResponse);
			break;
		}
		lastToolCallKeys.push(currentKey);
		if (lastToolCallKeys.length > 2) lastToolCallKeys.shift();

		debugLogger.logMcp('Tool Requested', `🔧 LLM이 ${resolvedToolCalls.length}개 툴 호출 요청`, resolvedToolCalls.map((tc: ToolCall) => tc.name));

		// ── assistant tool call 메시지 추가 ──────────────────────────────────
		const assistantMsg = buildAssistantToolMessage(resolvedToolCalls, currentRoundText, useTextTools);
		messagesForLLM.push(assistantMsg);

		// ── 각 tool call 실행 후 결과 메시지 추가 ───────────────────────────
		for (const tc of resolvedToolCalls) {
			const toolResultMsg = await executeToolCall(tc, mcpManager, toolServerMap, useTextTools);
			messagesForLLM.push(toolResultMsg);
		}
	}

	// ── 최대 라운드 도달 ──────────────────────────────────────────────────────
	// 루프가 maxRounds에 의해 종료되었고 아직 fullResponse가 없으면 안내 메시지 출력
	if (toolRound >= maxRounds) {
		if (!fullResponse) {
			fullResponse = t('uiMessages.agentMaxStepsReached');
			debugLogger.logMcp('Loop Error', '⚠️ 최대 툴 루프 라운드 도달');
			appendChunk(assistantId, fullResponse);
		}
	}

	return { fullResponse, tokenUsage, hasTokenLimitBeenHit };
}

/** 중복 tool call 감지용 키 생성 (_serverId 제외). */
function buildToolCallKey(toolCalls: ToolCall[]): string {
	return toolCalls.map((tc: ToolCall) => {
		const args = { ...tc.arguments } as Record<string, unknown> & { _serverId?: unknown };
		delete args._serverId;
		return `${tc.name}:${JSON.stringify(args)}`;
	}).join('|');
}

/**
 * tool call이 있는 라운드의 assistant 메시지를 구성한다.
 * - 로컬(textTools): <lumina_tool_call> 블록 포함 텍스트
 * - 클라우드: tool_calls 필드 사용, <think> 블록 제거
 */
function buildAssistantToolMessage(
	resolvedToolCalls: ToolCall[],
	currentRoundText: string,
	useTextTools: boolean,
): ChatMessage {
	let assistantContent = currentRoundText || '';

	// 클라우드 모델: <think> 블록 제거 (DeepSeek API 오류 방지)
	if (!useTextTools) {
		assistantContent = assistantContent.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, '').trim();
	}

	if (useTextTools && resolvedToolCalls.length > 0) {
		const toolCallBlocks = resolvedToolCalls.map((tc: ToolCall) =>
			`<lumina_tool_call>\n${JSON.stringify({ name: tc.name, arguments: tc.arguments })}\n</lumina_tool_call>`
		).join('\n\n');
		assistantContent = assistantContent ? `${assistantContent}\n\n${toolCallBlocks}` : toolCallBlocks;
	} else if (!useTextTools && !assistantContent) {
		assistantContent = resolvedToolCalls.map((tc: ToolCall) => `Calling tool: ${tc.name}`).join(', ');
	}

	return {
		role: 'assistant',
		content: assistantContent,
		tool_calls: useTextTools
			? undefined
			: resolvedToolCalls.map((tc: ToolCall) => ({
				id: tc.id,
				name: tc.name,
				arguments: tc.arguments,
				thoughtSignature: tc.thoughtSignature,
			})),
	};
}

/**
 * 단일 tool call을 실행하고 tool result ChatMessage를 반환한다.
 * 실패 시에도 오류 메시지를 포함한 tool result를 반환 (루프 중단하지 않음).
 */
async function executeToolCall(
	tc: ToolCall,
	mcpManager: McpManager | null,
	toolServerMap: Record<string, string>,
	useTextTools: boolean,
): Promise<ChatMessage> {
	const toolMsgRole = useTextTools ? 'user' : 'tool';

	try {
		// _serverId를 제거한 인자로 실행
		const serverId = (tc.arguments as { _serverId?: string })._serverId;
		const cleanArgs = { ...tc.arguments } as Record<string, unknown> & { _serverId?: unknown };
		delete cleanArgs._serverId;

		const resolvedServerId = serverId || toolServerMap[tc.name];
		debugLogger.logMcp('Tool Execute', `▶️ 툴 실행: ${tc.name}`, { serverId: resolvedServerId, args: cleanArgs });

		let toolResult: unknown;
		if (resolvedServerId && mcpManager) {
			toolResult = await mcpManager.callTool(resolvedServerId, tc.name, cleanArgs);
		} else {
			toolResult = {
				isError: true,
				content: [{ type: 'text', text: t('uiMessages.agentToolNotFound', { name: tc.name }) }],
			};
		}

		const resultText = truncateToolResult(extractToolResultText(toolResult), tc.name);
		debugLogger.logMcp('Tool Result', `◀️ 툴 결과: ${tc.name} → ${resultText.length}자`, { result: resultText });

		return {
			role: toolMsgRole,
			name: tc.name,
			content: useTextTools
				? t('uiMessages.agentToolResultFor', { name: tc.name }) + '\n' + resultText
				: resultText,
			...(useTextTools ? {} : { tool_call_id: tc.id }),
			thoughtSignature: tc.thoughtSignature,
		};
	} catch (e) {
		debugLogger.logMcp('Tool Error', `❌ 툴 실행 오류 ${tc.name}`, { error: (e as Error).message });

		return {
			role: toolMsgRole,
			name: tc.name,
			content: useTextTools
				? t('uiMessages.agentToolError', { name: tc.name, error: (e as Error).message })
				: t('uiMessages.agentToolExecuteError', { error: (e as Error).message }),
			...(useTextTools ? {} : { tool_call_id: tc.id }),
			thoughtSignature: tc.thoughtSignature,
		};
	}
}

/** tool 결과를 텍스트로 변환한다. */
function extractToolResultText(toolResult: unknown): string {
	const typedResult = toolResult as { content?: Array<{ text?: string }>; isError?: boolean } | null | undefined;
	if (typedResult?.content) {
		return typedResult.content.map((c) => c.text ?? '').join('\n');
	}
	if (typeof toolResult === 'string') return toolResult;
	return JSON.stringify(toolResult);
}

/** tool 결과 텍스트를 최대 길이로 자른다. */
function truncateToolResult(text: string, toolName: string): string {
	if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
	const truncationNote = t('uiMessages.agentToolTruncatedNote', { total: text.length, max: MAX_TOOL_RESULT_CHARS });
	debugLogger.logMcp('Tool Result', `⚠️ ${toolName} 결과 잘림: ${text.length}자 → ${MAX_TOOL_RESULT_CHARS}자`);
	return text.substring(0, MAX_TOOL_RESULT_CHARS) + truncationNote;
}
