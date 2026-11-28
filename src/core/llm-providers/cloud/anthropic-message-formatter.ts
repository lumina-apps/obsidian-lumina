/**
 * anthropic-message-formatter.ts
 * ChatMessage → Anthropic API 메시지 포맷 변환
 */
import type { AnthropicThinkingBlock, ChatMessage, ToolDefinition } from '../../../shared/types/llm.types';
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
			if (Array.isArray(m.content)) {
				const contentArray = m.content.map(c => {
					if (c.type === 'text') {
						return { type: 'text' as const, text: c.text };
					}
					if (c.type === 'image_url') {
						const match = c.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
						if (match) {
							const mediaType = match[1];
							const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
							if (allowedTypes.includes(mediaType)) {
								return {
									type: 'image' as const,
									source: {
										type: 'base64' as const,
										media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
										data: match[2],
									},
								};
							}
							return { type: 'text' as const, text: `[Unsupported image type: ${mediaType}]` };
						}
						return { type: 'text' as const, text: `[Image: ${c.image_url.url}]` };
					}
					return { type: 'text' as const, text: '' };
				});
				return { role: 'user', content: contentArray };
			}
			return { role: 'user', content: m.content };
		}
		if (m.role === 'assistant') {
			const contentArray: Array<
				| AnthropicThinkingBlock
				| { type: 'text'; text: string }
				| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
			> = [];
			// Anthropic tool use 루프에서 직전 턴의 서명된 thinking 블록을 수정 없이 선두에 복원
			if (m.thinkingBlocks && m.thinkingBlocks.length > 0) {
				for (const tb of m.thinkingBlocks) {
					contentArray.push(tb);
				}
			}
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
			if (contentArray.length === 0 && contentText) {
				contentArray.push({ type: 'text', text: contentText });
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

	// Anthropic API는 role이 반드시 교대해야 함 → 먼저 연속된 user(tool_result) 메시지 병합
	const toolMerged: typeof mapped = [];
	for (const msg of mapped) {
		const prev = toolMerged[toolMerged.length - 1];
		if (
			prev && prev.role === 'user' && msg.role === 'user'
			&& Array.isArray(prev.content) && Array.isArray(msg.content)
			&& (prev.content as { type: string }[]).every(c => c.type === 'tool_result')
			&& (msg.content as { type: string }[]).every(c => c.type === 'tool_result')
		) {
			(prev.content as unknown[]).push(...(msg.content as unknown[]));
		} else {
			toolMerged.push(msg);
		}
	}

	// Anthropic API 제약: 첫 메시지는 반드시 일반 'user' 역할이어야 함 (assistant나 단독 tool_result로 시작 불가)
	while (
		toolMerged.length > 0 &&
		(
			toolMerged[0].role !== 'user' ||
			(Array.isArray(toolMerged[0].content) &&
				(toolMerged[0].content as { type: string }[]).some(c => c.type === 'tool_result'))
		)
	) {
		toolMerged.shift();
	}

	// 빈 assistant 블록 제거 및 연속된 동일 role(user->user, assistant->assistant) 안전 병합
	const merged: typeof mapped = [];
	for (const msg of toolMerged) {
		if (msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.length === 0) {
			continue;
		}
		const prev = merged[merged.length - 1];
		if (prev && prev.role === msg.role) {
			if (typeof prev.content === 'string' && typeof msg.content === 'string') {
				prev.content = `${prev.content}\n\n${msg.content}`;
			} else {
				const prevArr = Array.isArray(prev.content)
					? (prev.content as unknown[])
					: String(prev.content)
						? [{ type: 'text' as const, text: String(prev.content) }]
						: [];
				const msgArr = Array.isArray(msg.content)
					? (msg.content as unknown[])
					: String(msg.content)
						? [{ type: 'text' as const, text: String(msg.content) }]
						: [];
				prev.content = [...prevArr, ...msgArr] as typeof prev.content;
			}
		} else {
			merged.push(msg);
		}
	}

	return merged;
}

export interface AnthropicCacheControl {
	type: 'ephemeral';
}

const CACHE_CONTROL_EPHEMERAL: AnthropicCacheControl = { type: 'ephemeral' };
const SUMMARY_SECTION_MARKER = '\n\n[이전 대화 요약]\n';

export interface AnthropicTextBlock {
	type: 'text';
	text: string;
	cache_control?: AnthropicCacheControl;
}

export type AnthropicFormattedMessage = {
	role: string;
	content: string | Array<Record<string, unknown>>;
};

/**
 * 시스템 프롬프트를 Anthropic API 형식에 맞게 변환합니다.
 * - enableCaching=false: 기존 호환성을 위해 문자열 그대로 반환
 * - enableCaching=true: 정적 시스템 프롬프트에 cache_control을 부착하고,
 *   동적 대화 요약([이전 대화 요약])이 포함된 경우 정적/동적 블록을 분리해 정적 캐시 적중을 유지합니다.
 */
export function formatAnthropicSystem(
	systemContent: string,
	enableCaching: boolean,
): string | AnthropicTextBlock[] {
	if (!enableCaching || !systemContent) {
		return systemContent;
	}

	const markerIdx = systemContent.indexOf(SUMMARY_SECTION_MARKER);
	if (markerIdx > 0) {
		const staticPart = systemContent.slice(0, markerIdx);
		const summaryPart = systemContent.slice(markerIdx);
		if (staticPart.trim().length > 0 && summaryPart.trim().length > 0) {
			return [
				{ type: 'text', text: staticPart, cache_control: { ...CACHE_CONTROL_EPHEMERAL } },
				{ type: 'text', text: summaryPart },
			];
		}
	}

	return [
		{ type: 'text', text: systemContent, cache_control: { ...CACHE_CONTROL_EPHEMERAL } },
	];
}

/**
 * 최종 정렬/병합된 Anthropic 메시지 목록에 롤링 캐시 브레이크포인트를 최대 2개 적용합니다.
 * tools(1) + system(1) + messages(2) <= 4 (Anthropic 최대 브레이크포인트 제한 준수).
 */
export function applyAnthropicMessageCacheBreakpoints(
	messages: AnthropicFormattedMessage[],
	maxBreakpoints = 2,
): AnthropicFormattedMessage[] {
	if (messages.length === 0 || maxBreakpoints <= 0) {
		return messages;
	}

	// 뒤에서부터 비어있지 않은 user 메시지(일반 user 또는 tool_result 포함) 최대 2개 선택
	const targetIndices: number[] = [];
	for (let i = messages.length - 1; i >= 0 && targetIndices.length < maxBreakpoints; i--) {
		const msg = messages[i];
		if (msg.role !== 'user') continue;
		if (hasNonEmptyCacheableBlock(msg.content)) {
			targetIndices.push(i);
		}
	}

	if (targetIndices.length === 0) {
		return messages;
	}

	const targetSet = new Set(targetIndices);
	return messages.map((msg, idx) => {
		if (!targetSet.has(idx)) {
			return msg;
		}
		if (typeof msg.content === 'string') {
			return {
				...msg,
				content: [
					{
						type: 'text',
						text: msg.content,
						cache_control: { ...CACHE_CONTROL_EPHEMERAL },
					},
				],
			};
		}
		const blocks = [...msg.content];
		for (let b = blocks.length - 1; b >= 0; b--) {
			const block = blocks[b];
			if (isCacheableContentBlock(block)) {
				blocks[b] = { ...block, cache_control: { ...CACHE_CONTROL_EPHEMERAL } };
				break;
			}
		}
		return { ...msg, content: blocks };
	});
}

function isCacheableContentBlock(block: Record<string, unknown>): boolean {
	if (block.type === 'text') {
		return typeof block.text === 'string' && block.text.length > 0;
	}
	return block.type === 'image' || block.type === 'tool_result';
}

function hasNonEmptyCacheableBlock(content: string | Array<Record<string, unknown>>): boolean {
	if (typeof content === 'string') {
		return content.length > 0;
	}
	return Array.isArray(content) && content.some(isCacheableContentBlock);
}

/**
 * ToolDefinition[] 배열을 Anthropic API tools 배열로 변환합니다.
 * 빈 배열이거나 undefined인 경우 undefined를 반환합니다.
 * enableCaching=true일 때 마지막 툴 정의에 cache_control을 부착합니다.
 */
export function formatAnthropicTools(tools?: ToolDefinition[], enableCaching = false) {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((td, idx) => ({
		name: td.name,
		description: td.description,
		input_schema: {
			type: 'object',
			properties: td.inputSchema.properties,
			required: td.inputSchema.required || [],
		},
		...(enableCaching && idx === tools.length - 1
			? { cache_control: { ...CACHE_CONTROL_EPHEMERAL } }
			: {}),
	}));
}