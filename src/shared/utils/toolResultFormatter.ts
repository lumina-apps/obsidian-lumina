/** MCP 툴 실행 결과 텍스트 변환 및 길이 제한 유틸리티 */

import { t } from '../locales/helpers';
import { stripMaskTokens } from './llmTextSanitizer';
import { debugLogger } from '../debugLogger';

export const MAX_TOOL_RESULT_CHARS = 1_000_000;

/** MCP tool call 결과에서 텍스트 추출 */
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

/** 툴 결과 텍스트를 최대 길이로 자르고 마스크 토큰 제거 */
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