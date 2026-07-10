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

/** Qwen 등에서 발생하는 변형 태그 포맷 (ex: <tool_name><argument>{...}</argument></lumina_tool_call>) */
const MALFORMED_XML_REGEX = new RegExp(
	`<([a-zA-Z0-9_]+)>\\s*(?:<argument>\\s*)?(\\{[\\s\\S]*?\\})(?:\\s*<\\/argument>)?\\s*(?:<\\/(?:${TOOL_CALL_TAG_ALT})>|<\\/\\1>)`,
	'gi',
);

// ─── $...$ 구분자 정규화 ─────────────────────────────────────────────────────

/**
 * $lumina_tool_call$ ... $lumina_tool_call$ 형식을
 * <lumina_tool_call> ... </lumina_tool_call> 형식으로 정규화한다.
 * $/tag$ → </tag>, 짝이 맞지 않는 $tag$는 <tag> / </tag> 교대로 변환.
 */
function normalizeDollarDelimiters(content: string): string {
	// 1) $/tag$ 또는 $/tag → </tag>
	let result = content.replace(
		new RegExp(`\\$/(${TOOL_CALL_TAG_ALT})\\$?`, 'gi'),
		'</$1>',
	);

	// 2) 남은 $tag$ 또는 $tag 패턴: 첫 번째는 <tag>, 이후는 </tag> 교대로 변환
	let isOpen = false;
	result = result.replace(
		new RegExp(`\\$(${TOOL_CALL_TAG_ALT})\\$?`, 'gi'),
		(_match, tag) => {
			if (!isOpen) {
				isOpen = true;
				return `<${tag}>`;
			}
			isOpen = false;
			return `</${tag}>`;
		},
	);

	return result;
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/** <lumina_tool_call> 블록 파싱. $...$ 구분자도 지원. @returns 파싱된 toolCall 목록과 순수 텍스트 */
export function parseTextToolCalls(content: string): {
	toolCalls: ToolCall[];
	cleanContent: string;
} {
	// $...$ 구분자를 XML 태그로 정규화
	content = normalizeDollarDelimiters(content);
	const toolCalls: ToolCall[] = [];
	const parts: string[] = [];
	let lastEnd = 0;

	// 1차: 닫는 태그가 있는 완전한 블록 파싱
	CLOSED_TAG_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = CLOSED_TAG_REGEX.exec(content)) !== null) {
		const blockContent = match[2].trim();
		if (blockContent) {
			const result = tryParseBlock(blockContent);
			if (result) {
				parts.push(content.substring(lastEnd, match.index));
				toolCalls.push(result);
				lastEnd = CLOSED_TAG_REGEX.lastIndex;
			}
		}
	}

	// 2차: Qwen 등에서 발생하는 변형 태그 포맷 파싱
	if (toolCalls.length === 0) {
		MALFORMED_XML_REGEX.lastIndex = 0;
		while ((match = MALFORMED_XML_REGEX.exec(content)) !== null) {
			const toolName = match[1];
			// think 등 내부 태그는 무시
			if (toolName.toLowerCase() !== 'think') {
				try {
					const args = JSON.parse(match[2]) as Record<string, unknown>;
					parts.push(content.substring(lastEnd, match.index));
					toolCalls.push({
						id: crypto.randomUUID(),
						name: toolName,
						arguments: args,
					});
					lastEnd = MALFORMED_XML_REGEX.lastIndex;
				} catch {
					// JSON 파싱 실패시 무시
				}
			}
		}
	}

	// 3차: 닫는 태그 없이 끝난 경우 폴백 (스트리밍 도중 잘린 경우)
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