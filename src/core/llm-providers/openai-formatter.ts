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
	const sanitized: ChatMessage[] = [];
	let seenNonToolAfterSystem = false;
	for (const m of messages) {
		if (m.role === 'system') {
			sanitized.push(m);
			continue;
		}
		// 히스토리 절단 시 선두에 남은 고아 tool 메시지 제거 (선행 assistant tool_calls 없이 시작 불가)
		if (!seenNonToolAfterSystem && m.role === 'tool') {
			continue;
		}
		seenNonToolAfterSystem = true;
		sanitized.push(m);
	}

	return sanitized.map((m) => {
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