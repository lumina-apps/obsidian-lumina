/**
 * toolCallTags.ts
 *
 * 텍스트 기반 tool call 파싱에서 사용하는 태그 상수.
 * LLM별 변형(tool_calls, tool_use 등)을 포함한 공통 정규식 패턴.
 */

/** 지원하는 tool call 태그 목록 (정규식 alternation용) */
export const TOOL_CALL_TAG_ALT = 'lumina_tool_call|tool_calls|tool_call|tool_code|tool_use|use_tool';