/**
 * MCP tool-calling 에이전트 루프.
 * LLM 호출 → tool call 감지 → 실행 → 결과 주입을 반복하며,
 * 최대 라운드 도달, tool call 없음, 중복 3회 연속 감지 시 종료된다.
 */

import { t } from '../../shared/locales/helpers';
import type { ChatMessage, ChatOptions, ToolCall, TokenUsage, ILLMProvider } from '../../shared/types/llm.types';
import type { ChatSettings } from '../../core/settings/settings.types';
import type { McpManager } from '../../core/mcp/mcpManager';
import { appendChunk, syncMessageContent } from '../../core/store/chatStore';
import { debugLogger } from '../../shared/debugLogger';
import { parseTextToolCalls } from './utils/textToolParser';
import { stripMaskTokens, stripThinkTags } from '../../shared/utils/llmTextSanitizer';
import { buildToolCallKey } from '../../shared/utils/toolCallUtils';
import { buildAssistantToolMessage } from './utils/toolMessageBuilder';
import { executeToolCall } from './utils/toolExecutor';

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

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

/** token usage 누적 */
function accumulateTokenUsage(
	current: TokenUsage | undefined,
	incoming: TokenUsage,
): TokenUsage {
	if (!current) {
		return { ...incoming };
	}
	return {
		inputTokens: current.inputTokens + incoming.inputTokens,
		outputTokens: current.outputTokens + incoming.outputTokens,
		totalTokens: current.totalTokens + incoming.totalTokens,
	};
}

/** 중간 라운드의 자연어 텍스트를 <think> 블록으로 래핑 */
function wrapThinkBlock(text: string): string {
	const stripped = text.replace(/<\/?think>/gi, '').trim();
	return stripped ? `<think>\n${stripped}\n</think>` : '';
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
	let lastToolCallKeys: string[] = [];

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
				const full = accumulatedText + (accumulatedText && currentChunkText ? '\n\n' : '') + currentChunkText;
				appendChunk(assistantId, chunk);
			}
		});

		// ── 토큰 한도 체크 ────────────────────────────────────────────────────
		if (isTokenLimitReached(rawResponse.finishReason)) {
			hasTokenLimitBeenHit = true;
			const finalContent = accumulatedText || (rawResponse.content || '');
			const fullResponse = !useTextTools
				? stripThinkTags(finalContent)
				: finalContent;
			return {
				fullResponse,
				tokenUsage,
				hasTokenLimitBeenHit,
			};
		}

		// ── 텍스트 기반 tool call 파싱 (로컬 모델) ───────────────────────────
		let resolvedToolCalls = rawResponse.toolCalls;
		let currentRoundText = rawResponse.content || '';

		if (useTextTools && currentRoundText) {
			currentRoundText = stripMaskTokens(currentRoundText);
			const parsed = parseTextToolCalls(currentRoundText);
			if (parsed.toolCalls.length > 0) {
				debugLogger.logMcp(
					'Text Parse',
					`📝 텍스트 tool call 파싱: ${parsed.toolCalls.length}개 발견`,
					parsed.toolCalls.map(tc => tc.name),
				);
				resolvedToolCalls = parsed.toolCalls;
				currentRoundText = parsed.cleanContent;
			}
		}

		// ── 현재 라운드 텍스트 누적 ───────────────────────────────────────────
		if (currentRoundText.trim()) {
			let textToAdd = currentRoundText;
			if (resolvedToolCalls && resolvedToolCalls.length > 0) {
				textToAdd = wrapThinkBlock(textToAdd);
			}
			if (textToAdd) {
				accumulatedText = accumulatedText ? accumulatedText + '\n\n' + textToAdd : textToAdd;
			}
		}

		// ── token usage 누적 ──────────────────────────────────────────────────
		if (rawResponse.usage) {
			tokenUsage = accumulateTokenUsage(tokenUsage, rawResponse.usage);
		}

		debugLogger.logMcp(
			'LLM Output',
			`LLM 응답: content=${currentRoundText?.length ?? 0}자, toolCalls=${resolvedToolCalls?.length ?? 0}개`,
		);

		// ── tool call이 없으면 종료 ───────────────────────────────────────────
		if (!resolvedToolCalls || resolvedToolCalls.length === 0) {
			const fullResponse = accumulatedText;
			debugLogger.logMcp(
				'Loop End',
				`✅ 툴 루프 완료 (라운드 ${toolRound}), 최종 응답: ${fullResponse.length}자`,
			);
			if (!chatSettings.streaming) {
				appendChunk(assistantId, fullResponse);
			} else {
				syncMessageContent(assistantId, fullResponse);
			}
			return { fullResponse, tokenUsage, hasTokenLimitBeenHit };
		}

		// ── streaming 시 UI 정리 (툴 호출 코드 제거) ─────────────────────────
		if (chatSettings.streaming) {
			syncMessageContent(assistantId, accumulatedText);
		}

		// ── 중복 호출 감지 ────────────────────────────────────────────────────
		const currentKey = buildToolCallKey(resolvedToolCalls);
		if (lastToolCallKeys.length >= 2 && lastToolCallKeys.every(k => k === currentKey)) {
			debugLogger.logMcp('Loop Error', '⚠️ 동일한 툴 호출 3회 연속 감지, 루프 강제 종료');
			const fullResponse = accumulatedText || t('uiMessages.agentRepeatedToolCalls');
			appendChunk(assistantId, fullResponse);
			return { fullResponse, tokenUsage, hasTokenLimitBeenHit };
		}
		lastToolCallKeys.push(currentKey);
		if (lastToolCallKeys.length > 2) lastToolCallKeys.shift();

		debugLogger.logMcp(
			'Tool Requested',
			`🔧 LLM이 ${resolvedToolCalls.length}개 툴 호출 요청`,
			resolvedToolCalls.map((tc: ToolCall) => tc.name),
		);

		// ── assistant tool call 메시지 추가 ──────────────────────────────────
		messagesForLLM.push(buildAssistantToolMessage(resolvedToolCalls, currentRoundText, useTextTools));

		// ── 각 tool call 실행 후 결과 메시지 추가 ───────────────────────────
		for (const tc of resolvedToolCalls) {
			messagesForLLM.push(await executeToolCall(tc, mcpManager, toolServerMap, useTextTools));
		}
	}

	// ── 최대 라운드 도달 ──────────────────────────────────────────────────────
	const fullResponse = accumulatedText || t('uiMessages.agentMaxStepsReached');
	debugLogger.logMcp('Loop Error', '⚠️ 최대 툴 루프 라운드 도달');
	appendChunk(assistantId, fullResponse);
	return { fullResponse, tokenUsage, hasTokenLimitBeenHit };
}