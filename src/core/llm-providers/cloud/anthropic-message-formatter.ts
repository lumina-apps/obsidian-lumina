/**
 * anthropic-message-formatter.ts
 * ChatMessage → Anthropic API 메시지 포맷 변환
 */
import type { ChatMessage, ToolDefinition } from '../../../shared/types/llm.types';
import { isMockToolText } from '../openai-formatter';

/**
 * ChatMessage 배열을 Anthropic API messages 배열로 변환합니다.
 * - system role은 제외 (payload.system으로 별도 전송)
 * - tool role은 tool_result로 변환
 * - assistant role은 tool_use 블록이 있으면 content array로 분리
 */
export function formatAnthropicMessages(messages: ChatMessage[]) {
	const filtered = messages.filter(m => m.role !== 'system');
	const mapped = filtered.map((m) => {
		if (m.role === 'user') {
			return { role: 'user', content: m.content };
		}
		if (m.role === 'assistant') {
			const contentArray: Array<
				| { type: 'text'; text: string }
				| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
			> = [];
			const contentText = typeof m.content === 'string' ? m.content : '';
			if (contentText && !isMockToolText(contentText)) {
				contentArray.push({ type: 'text', text: contentText });
			}
			if (m.tool_calls && m.tool_calls.length > 0) {
				for (const tc of m.tool_calls) {
					contentArray.push({
						type: 'tool_use',
						id: tc.id,
						name: tc.name,
						input: tc.arguments,
					});
				}
			}
			return { role: 'assistant', content: contentArray };
		}
		if (m.role === 'tool') {
			return {
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: m.tool_call_id,
						content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
					}
				]
			};
		}
		return { role: 'user', content: String(m.content) };
	});

	// Anthropic API는 role이 반드시 교대해야 함 → 연속된 user(tool_result) 메시지 병합
	const merged: typeof mapped = [];
	for (const msg of mapped) {
		const prev = merged[merged.length - 1];
		if (
			prev && prev.role === 'user' && msg.role === 'user'
			&& Array.isArray(prev.content) && Array.isArray(msg.content)
			&& (prev.content as { type: string }[]).every(c => c.type === 'tool_result')
			&& (msg.content as { type: string }[]).every(c => c.type === 'tool_result')
		) {
			(prev.content as unknown[]).push(...(msg.content as unknown[]));
		} else {
			merged.push(msg);
		}
	}

	// Anthropic API 제약: 첫 메시지는 반드시 'user' 역할이어야 함
	while (merged.length > 0 && merged[0].role !== 'user') {
		merged.shift();
	}

	return merged;
}

/**
 * ToolDefinition[] 배열을 Anthropic API tools 배열로 변환합니다.
 * 빈 배열이거나 undefined인 경우 undefined를 반환합니다.
 */
export function formatAnthropicTools(tools?: ToolDefinition[]) {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((td) => ({
		name: td.name,
		description: td.description,
		input_schema: {
			type: 'object',
			properties: td.inputSchema.properties,
			required: td.inputSchema.required || [],
		},
	}));
}