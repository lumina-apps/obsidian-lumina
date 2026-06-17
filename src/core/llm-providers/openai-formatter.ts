/**
 * openai-formatter.ts
 * ChatMessage / ToolDefinition 을 OpenAI 호환 API 요청 형식으로 변환하는 포맷터
 */

import type { ChatMessage, ToolDefinition } from '../../shared/types/llm.types';

/**
 * assistant content가 mock tool call 텍스트인지 판별합니다.
 * "Calling tool"로 시작하는 텍스트는 실제 응답이 아닌 UI 표시용입니다.
 */
export function isMockToolText(content: string): boolean {
	return content.startsWith('Calling tool');
}

/**
 * ChatMessage 배열을 OpenAI 호환 messages 배열로 변환합니다.
 */
export function formatOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
	return messages.map((m) => {
		if (m.role === 'system') {
			return { role: 'system', content: m.content };
		}
		if (m.role === 'user') {
			return { role: 'user', content: m.content };
		}
		if (m.role === 'assistant') {
			const contentText = typeof m.content === 'string' ? m.content : '';
			const payload: Record<string, unknown> = {
				role: 'assistant',
				content: (contentText && !isMockToolText(contentText)) ? contentText : null,
			};
			if (m.tool_calls && m.tool_calls.length > 0) {
				payload.tool_calls = m.tool_calls.map((tc) => ({
					id: tc.id,
					type: 'function',
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments),
					},
				}));
			}
			return payload;
		}
		if (m.role === 'tool') {
			return {
				role: 'tool',
				tool_call_id: m.tool_call_id,
				content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
			};
		}
		return { role: 'user', content: String(m.content) };
	});
}

/**
 * ToolDefinition 배열을 OpenAI 호환 tools 배열로 변환합니다.
 */
export function formatOpenAITools(tools?: ToolDefinition[]): Array<{
	type: 'function';
	function: { name: string; description: string; parameters: ToolDefinition['inputSchema'] };
}> | undefined {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((td) => ({
		type: 'function' as const,
		function: {
			name: td.name,
			description: td.description,
			parameters: td.inputSchema,
		},
	}));
}