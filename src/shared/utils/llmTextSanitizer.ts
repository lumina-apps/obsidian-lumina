/** LLM 응답 텍스트 정제 유틸리티 */
import { TOOL_CALL_TAG_ALT } from "../constants/toolCallTags";

/** <|mask_start|>...<|mask_end|> 특수 토큰 제거 */
export function stripMaskTokens(text: string): string {
	return text
		.replace(/<\|mask_start\|>[\s\S]*?<\|mask_end\|>/g, '')
		.replace(/<\|mask_start\|>/g, '')
		.replace(/<\|mask_end\|>/g, '')
		.trim();
}

/** <think>/<thinking>/<response>/<thought>/<reasoning> 등 추론/사고 블록 제거 */
export function stripThinkTags(text: string): string {
	const thinkTags = ['think', 'thinking', 'response', 'thought', 'reasoning'];
	let result = text;
	for (const tag of thinkTags) {
		const pattern = new RegExp(`<${tag}>([\\s\\S]*?)(?:<\\/${tag}>|$)`, 'gi');
		result = result.replace(pattern, '');
	}
	return result.trim();
}

/** 텍스트 기반 tool call 태그 제거 */
export function stripToolCallTags(text: string): string {
	const pattern = new RegExp(`<(${TOOL_CALL_TAG_ALT})>[\\s\\S]*?(?:<\\/\\1>|$)`, 'gi');
	return text.replace(pattern, '').trim();
}

/** <think>/<thinking>/<response>/<thought>/<reasoning> 블록 내용만 추출 (UI 표시용) */
export function extractThinkBlocks(text: string): string[] {
	const thinkTags = ['think', 'thinking', 'response', 'thought', 'reasoning'];
	const results: string[] = [];
	for (const tag of thinkTags) {
		const pattern = new RegExp(`<${tag}>([\\s\\S]*?)(?:<\\/${tag}>|$)`, 'gi');
		const matches = Array.from(text.matchAll(pattern));
		results.push(...matches.map(m => m[1].trim()).filter(Boolean));
	}
	return results;
}

/** 모든 특수 태그 제거 후 표시용 콘텐츠 반환 */
export function sanitizeDisplayContent(text: string): string {
	let content = stripThinkTags(text);
	content = stripToolCallTags(content);
	content = stripMaskTokens(content);
	return content;
}