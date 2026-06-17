/**
 * LLM 응답에서 <lumina_tool_call> 블록을 파싱.
 * 닫는 태그가 있는 완전한 블록 → 없으면 폴백(스트리밍 중 잘림) 순으로 처리한다.
 */

import type { ToolCall } from '../../../../shared/types/llm.types';
import { TOOL_CALL_TAG_ALT } from '../../../../shared/constants/toolCallTags';
import { tryParseBlock } from './blockParsers';

// ─── 모듈 레벨 정규식 ────────────────────────────────────────────────────────

/** 닫는 태그가 있는 완전한 블록 */
const CLOSED_TAG_REGEX = new RegExp(
	`[<$]*(${TOOL_CALL_TAG_ALT})[>]*\\s*([\\s\\S]*?)\\s*<\\/(?:${TOOL_CALL_TAG_ALT})>`,
	'gi',
);

/** 열린 태그만 있는 폴백 (스트리밍 잘림 대응) */
const OPEN_TAG_REGEX = new RegExp(
	`[<$]*(${TOOL_CALL_TAG_ALT})[>]*\\s+([\\s\\S]{1,})$`,
	'i',
);

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/** <lumina_tool_call> 블록 파싱. @returns 파싱된 toolCall 목록과 순수 텍스트 */
export function parseTextToolCalls(content: string): {
	toolCalls: ToolCall[];
	cleanContent: string;
} {
	const toolCalls: ToolCall[] = [];

	// 1차: 닫는 태그가 있는 완전한 블록 파싱
	CLOSED_TAG_REGEX.lastIndex = 0;
	const parts: string[] = [];
	let lastEnd = 0;
	let match: RegExpExecArray | null;

	while ((match = CLOSED_TAG_REGEX.exec(content)) !== null) {
		parts.push(content.substring(lastEnd, match.index));
		const blockContent = match[2].trim();
		if (blockContent) {
			const result = tryParseBlock(blockContent);
			if (result) {
				toolCalls.push(result);
			}
		}
		lastEnd = CLOSED_TAG_REGEX.lastIndex;
	}

	// 2차: 닫는 태그 없이 끝난 경우 폴백 (스트리밍 도중 잘린 경우)
	if (toolCalls.length === 0) {
		OPEN_TAG_REGEX.lastIndex = 0;
		const openMatch = OPEN_TAG_REGEX.exec(content);
		if (openMatch) {
			const blockContent = openMatch[2].trim();
			if (blockContent) {
				const result = tryParseBlock(blockContent);
				if (result) {
					toolCalls.push(result);
					// 태그 시작 전까지만 cleanContent로 유지
					parts.push(content.substring(0, openMatch.index));
					lastEnd = content.length;
				}
			}
		}
	}

	if (lastEnd < content.length) {
		parts.push(content.substring(lastEnd));
	}

	return {
		toolCalls,
		cleanContent: parts.join('').trim(),
	};
}