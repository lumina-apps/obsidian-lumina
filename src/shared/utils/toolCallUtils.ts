/**
 * toolCallUtils.ts
 *
 * 중복 tool call 감지를 위한 키 생성 등 tool call 관련 공통 유틸리티.
 * agentLoop.ts의 buildToolCallKey()에서 추출.
 */

import type { ToolCall } from '../types/llm.types';

/**
 * 중복 tool call 감지용 키 생성.
 * toolName:JSON(args) 조합으로 구성하며, _serverId는 제외한다.
 * 여러 tool call은 '|'로 연결.
 */
export function buildToolCallKey(toolCalls: ToolCall[]): string {
	return toolCalls
		.map((tc: ToolCall) => {
			const args = { ...tc.arguments } as Record<string, unknown> & { _serverId?: unknown };
			delete args._serverId;
			return `${tc.name}:${JSON.stringify(args)}`;
		})
		.join('|');
}