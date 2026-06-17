/**
 * toolResultFormatter.ts
 *
 * MCP 툴 실행 결과를 텍스트로 변환하고 최대 길이로 자르는 유틸리티.
 * agentLoop.ts의 executeToolCall / truncateToolResult 로직에서 추출.
 */

import { t } from '../locales/helpers';
import { stripMaskTokens } from './llmTextSanitizer';
import { debugLogger } from '../debugLogger';

/** 툴 결과 텍스트 최대 길이 */
export const MAX_TOOL_RESULT_CHARS = 4000;

/**
 * MCP tool call 결과(unknown)에서 텍스트를 추출한다.
 * content 배열 또는 문자열 지원.
 */
export function extractToolResultText(toolResult: unknown): string {
	const typedResult = toolResult as {
		content?: Array<{ text?: string }>;
		isError?: boolean;
	} | null | undefined;
	if (typedResult?.content) {
		return typedResult.content.map((c) => c.text ?? '').join('\n');
	}
	if (typeof toolResult === 'string') return toolResult;
	return JSON.stringify(toolResult);
}

/**
 * 툴 결과 텍스트를 최대 길이로 자르고, 초과 시 truncation 안내를 추가한다.
 * 마스크 토큰도 함께 제거한다.
 */
export function truncateToolResult(text: string, toolName: string): string {
	const sanitized = stripMaskTokens(text);
	if (sanitized.length <= MAX_TOOL_RESULT_CHARS) return sanitized;

	const truncationNote = t('uiMessages.agentToolTruncatedNote', {
		total: sanitized.length,
		max: MAX_TOOL_RESULT_CHARS,
	});
	debugLogger.logMcp(
		'Tool Result',
		`⚠️ ${toolName} 결과 잘림: ${sanitized.length}자 → ${MAX_TOOL_RESULT_CHARS}자`,
	);
	return sanitized.substring(0, MAX_TOOL_RESULT_CHARS) + truncationNote;
}