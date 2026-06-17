/**
 * tool call이 포함된 assistant 메시지 구성.
 * 로컬(textTools)은 <lumina_tool_call> 블록, 클라우드는 tool_calls 필드를 사용한다.
 */

import { stripThinkTags } from '../../../shared/utils/llmTextSanitizer';
import type { ChatMessage, ToolCall } from '../../../shared/types/llm.types';

/** tool call이 포함된 라운드의 assistant 메시지 구성 */
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