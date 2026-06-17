/**
 * toolMessageBuilder.ts
 *
 * tool call이 있는 assistant 메시지를 구성하는 유틸리티.
 * agentLoop.ts의 buildAssistantToolMessage()에서 추출.
 *
 * - 로컬(textTools): <lumina_tool_call> 블록 포함 텍스트
 * - 클라우드: tool_calls 필드 사용, <think> 블록 제거
 */

import { stripThinkTags } from '../../../shared/utils/llmTextSanitizer';
import type { ChatMessage, ToolCall } from '../../../shared/types/llm.types';

/**
 * tool call이 포함된 라운드의 assistant 메시지를 구성한다.
 *
 * @param resolvedToolCalls 이번 라운드에서 실행할 tool call 목록
 * @param currentRoundText assistant의 자연어 응답 텍스트
 * @param useTextTools true = 로컬 모델 텍스트 파싱 모드, false = 클라우드 bindTools 모드
 */
export function buildAssistantToolMessage(
	resolvedToolCalls: ToolCall[],
	currentRoundText: string,
	useTextTools: boolean,
): ChatMessage {
	let assistantContent = currentRoundText || '';

	// 클라우드 모델: <think> 블록 제거 (DeepSeek API 오류 방지)
	if (!useTextTools) {
		assistantContent = stripThinkTags(assistantContent);
	}

	if (useTextTools && resolvedToolCalls.length > 0) {
		// 로컬 모델: <lumina_tool_call> 블록으로 tool call 포함
		const toolCallBlocks = resolvedToolCalls
			.map((tc: ToolCall) =>
				`<lumina_tool_call>\n${JSON.stringify({ name: tc.name, arguments: tc.arguments })}\n</lumina_tool_call>`,
			)
			.join('\n\n');
		assistantContent = assistantContent ? `${assistantContent}\n\n${toolCallBlocks}` : toolCallBlocks;
	} else if (!useTextTools && !assistantContent) {
		// 클라우드 모델: 본문이 비어 있으면 간략한 설명 추가
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