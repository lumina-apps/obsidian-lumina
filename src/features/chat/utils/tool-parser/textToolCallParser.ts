/**
 * textToolCallParser.ts
 *
 * LLM 응답 텍스트에서 <lumina_tool_call> (및 유사 태그) 블록을 파싱하는 메인 진입점.
 *
 * 두 단계로 처리:
 * 1. 닫는 태그가 있는 완전한 블록 파싱 (정상 응답)
 * 2. 닫는 태그 없이 끝난 경우 폴백 (스트리밍 중 잘린 응답)
 *
 * textToolParser.ts에서 분리되어 독립적으로 테스트/유지보수 가능.
 */

import type { ToolCall } from '../../../../shared/types/llm.types';
import { TOOL_CALL_TAG_ALT } from '../../../../shared/constants/toolCallTags';
import { tryParseBlock } from './blockParsers';

// ─── 모듈 레벨 정규식 (한 번만 생성하여 재사용) ───────────────────────────────

/** 닫는 태그가 있는 완전한 블록을 매칭하는 정규식 */
const CLOSED_TAG_REGEX = new RegExp(
	`[<$]*(${TOOL_CALL_TAG_ALT})[>]*\\s*([\\s\\S]*?)\\s*<\\/(?:${TOOL_CALL_TAG_ALT})>`,
	'gi',
);

/** 열린 태그만 있고 닫는 태그가 없는 폴백 정규식 (스트리밍 잘림 대응) */
const OPEN_TAG_REGEX = new RegExp(
	`[<$]*(${TOOL_CALL_TAG_ALT})[>]*\\s+([\\s\\S]{1,})$`,
	'i',
);

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * LLM 응답 텍스트에서 <lumina_tool_call> (및 유사 태그) 블록을 파싱한다.
 *
 * 두 단계로 처리:
 * 1. 닫는 태그가 있는 완전한 블록 파싱 (정상 응답)
 * 2. 닫는 태그 없이 끝난 경우 폴백 (스트리밍 중 잘린 응답)
 *
 * @returns toolCalls: 파싱된 tool call 목록, cleanContent: 태그 블록을 제거한 순수 텍스트
 */
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