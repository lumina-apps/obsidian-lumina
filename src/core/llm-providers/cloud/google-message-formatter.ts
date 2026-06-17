/**
 * google-message-formatter.ts
 * ChatMessage 배열을 Gemini API 요청 형식으로 변환
 */
import type { ChatMessage, ToolDefinition } from '../../../shared/types/llm.types';
import { isMockToolText } from '../utils';

/**
 * system instruction 추출 (Gemini 전용: { parts: [{ text }] } 형식)
 */
export function getGeminiSystemInstruction(messages: ChatMessage[]) {
	const systemMsgs = messages.filter(m => m.role === 'system');
	if (systemMsgs.length === 0) return undefined;
	return {
		parts: [{ text: systemMsgs.map(m => m.content).join('\n') }]
	};
}

/**
 * ChatMessage[] → Gemini contents[]
 * - system role은 getGeminiSystemInstruction으로 분리했으므로 제외
 * - user role은 text + image_url multimodal 지원
 * - assistant role은 model role로 매핑 (text + functionCall parts)
 * - tool role은 function role로 매핑 (functionResponse parts)
 */
export function formatGeminiMessages(messages: ChatMessage[]) {
	const filtered = messages.filter(m => m.role !== 'system');
	return filtered.map((m) => {
		switch (m.role) {
			case 'user':
				return formatUserMessage(m);
			case 'assistant':
				return formatAssistantMessage(m);
			case 'tool':
				return formatToolMessage(m);
			default:
				return { role: 'user', parts: [{ text: String(m.content) }] };
		}
	});
}

/**
 * Gemini tools → [{ functionDeclarations }] 형식
 */
export function formatGeminiTools(tools?: ToolDefinition[]) {
	if (!tools || tools.length === 0) return undefined;
	return [{
		functionDeclarations: tools.map(td => ({
			name: td.name,
			description: td.description,
			parameters: td.inputSchema,
		}))
	}];
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function formatUserMessage(m: ChatMessage) {
	if (Array.isArray(m.content)) {
		const parts = m.content.map(c => {
			if (c.type === 'text') {
				return { text: c.text };
			} else {
				const match = c.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
				if (match) {
					return {
						inlineData: {
							mimeType: match[1],
							data: match[2],
						}
					};
				}
				return { text: '[Image Url]' };
			}
		});
		return { role: 'user', parts };
	}
	return { role: 'user', parts: [{ text: m.content }] };
}

function formatAssistantMessage(m: ChatMessage) {
	const parts: Array<
		| { text: string }
		| { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
	> = [];

	const contentText = typeof m.content === 'string' ? m.content : '';
	if (contentText && !isMockToolText(contentText)) {
		parts.push({ text: contentText });
	}

	if (m.tool_calls && m.tool_calls.length > 0) {
		for (const tc of m.tool_calls) {
			parts.push({
				functionCall: {
					name: tc.name,
					args: tc.arguments,
				},
				...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {})
			});
		}
	}

	return { role: 'model', parts };
}

function formatToolMessage(m: ChatMessage) {
	let responseObj: Record<string, unknown> = { content: m.content };
	try {
		if (typeof m.content === 'string') {
			const parsed = JSON.parse(m.content) as unknown;
			if (typeof parsed === 'object' && parsed !== null) {
				responseObj = parsed as Record<string, unknown>;
			}
		}
	} catch {
		// not a JSON string, keep wrapping
	}

	return {
		role: 'function',
		parts: [
			{
				functionResponse: {
					name: m.name || '',
					response: responseObj,
				},
				...(m.thoughtSignature ? { thoughtSignature: m.thoughtSignature } : {})
			}
		]
	};
}