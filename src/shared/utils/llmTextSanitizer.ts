/**
 * llmTextSanitizer.ts
 *
 * LLM 응답 및 툴 결과 텍스트 정제 유틸리티.
 * - 마스크 토큰 제거 (Qwen, Mistral 등 로컬 모델)
 * - <think> 블록 제거 (DeepSeek 등 추론 모델)
 * - tool_call 태그 제거 (텍스트 기반 tool call)
 * - <think> 블록 추출 (UI 표시용)
 *
 * agentLoop.ts, toolExecutor, Message.svelte 등 여러 곳에서 공통 사용.
 */

import { TOOL_CALL_TAG_ALT } from "../constants/toolCallTags";

/**
 * 로컬 LLM(Qwen, Mistral 등)이 삽입하는 <|mask_start|>...<|mask_end|> 특수 토큰을 제거한다.
 */
export function stripMaskTokens(text: string): string {
	return text
		.replace(/<\|mask_start\|>[\s\S]*?<\|mask_end\|>/g, '')
		.replace(/<\|mask_start\|>/g, '')
		.replace(/<\|mask_end\|>/g, '')
		.trim();
}

/**
 * DeepSeek 등 추론 모델의 <think>...</think> 블록을 제거한다.
 * API 호환성 문제 방지 (DeepSeek API는 assistant 메시지에 <think> 포함 시 오류 발생).
 */
export function stripThinkTags(text: string): string {
	return text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, '').trim();
}

/**
 * 텍스트 기반 tool call 태그를 제거한다.
 * 지원 태그: lumina_tool_call, tool_calls, tool_call, tool_code, tool_use, use_tool
 */
export function stripToolCallTags(text: string): string {
	const pattern = new RegExp(`<(${TOOL_CALL_TAG_ALT})>[\\s\\S]*?(?:<\\/\\1>|$)`, 'gi');
	return text.replace(pattern, '').trim();
}

/**
 * 텍스트에서 <think>...</think> 블록의 내용만 추출하여 배열로 반환한다.
 * UI에서 추론 과정을 별도로 표시할 때 사용.
 */
export function extractThinkBlocks(text: string): string[] {
	const matches = Array.from(text.matchAll(/<think>([\s\S]*?)(?:<\/think>|$)/gi));
	return matches.map(m => m[1].trim()).filter(Boolean);
}

/**
 * 텍스트에서 모든 비표시 태그를 제거한 표시용 컨텐츠를 반환한다.
 * think, tool_call, mask 토큰을 모두 제거.
 */
export function sanitizeDisplayContent(text: string): string {
	let content = stripThinkTags(text);
	content = stripToolCallTags(content);
	content = stripMaskTokens(content);
	return content;
}