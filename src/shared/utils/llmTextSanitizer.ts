/**
 * llmTextSanitizer.ts
 *
 * LLM 응답 및 툴 결과 텍스트 정제 유틸리티.
 * - 마스크 토큰 제거 (Qwen, Mistral 등 로컬 모델)
 * - <think> 블록 제거 (DeepSeek 등 추론 모델)
 *
 * agentLoop.ts, toolExecutor 등 여러 곳에서 공통 사용.
 */

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