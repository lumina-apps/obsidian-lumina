import type { ToolCall } from '../types/llm.types';

/** 중복 tool call 감지용 키: toolName:JSON(args) 조합 */
export function buildToolCallKey(toolCalls: ToolCall[]): string {
	return toolCalls
		.map((tc: ToolCall) => {
			const args = { ...tc.arguments } as Record<string, unknown> & { _serverId?: unknown };
			delete args._serverId;
			return `${tc.name}:${JSON.stringify(args)}`;
		})
		.join('|');
}