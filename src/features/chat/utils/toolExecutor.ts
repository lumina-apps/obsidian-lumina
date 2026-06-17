/**
 * toolExecutor.ts
 *
 * 단일 MCP tool call을 실행하고 결과 ChatMessage를 반환하는 유틸리티.
 * agentLoop.ts의 executeToolCall()에서 추출.
 *
 * 실패 시에도 오류 메시지를 포함한 tool result를 반환 (루프 중단하지 않음).
 */

import { t } from '../../../shared/locales/helpers';
import { debugLogger } from '../../../shared/debugLogger';
import { extractToolResultText, truncateToolResult } from '../../../shared/utils/toolResultFormatter';
import type { ChatMessage, ToolCall } from '../../../shared/types/llm.types';
import type { McpManager } from '../../../core/mcp/mcpManager';

/**
 * 단일 tool call을 실행하고 tool result ChatMessage를 반환한다.
 * 실패 시에도 오류 메시지를 포함한 tool result를 반환 (상위 루프에서 처리).
 *
 * @param tc 실행할 tool call
 * @param mcpManager MCP 매니저 인스턴스 (null이면 툴 없음 응답)
 * @param toolServerMap toolName → serverId 매핑
 * @param useTextTools 로컬 텍스트 파싱 모드 여부 (role: user/tool, 응답 포맷 결정)
 */
export async function executeToolCall(
	tc: ToolCall,
	mcpManager: McpManager | null,
	toolServerMap: Record<string, string>,
	useTextTools: boolean,
): Promise<ChatMessage> {
	const toolMsgRole = useTextTools ? 'user' : 'tool';

	try {
		// _serverId를 제거한 인자로 실행
		const serverId = (tc.arguments as { _serverId?: string })._serverId;
		const cleanArgs = { ...tc.arguments } as Record<string, unknown> & { _serverId?: unknown };
		delete cleanArgs._serverId;

		const resolvedServerId = serverId || toolServerMap[tc.name];
		debugLogger.logMcp('Tool Execute', `▶️ 툴 실행: ${tc.name}`, {
			serverId: resolvedServerId,
			args: cleanArgs,
		});

		let toolResult: unknown;
		if (resolvedServerId && mcpManager) {
			toolResult = await mcpManager.callTool(resolvedServerId, tc.name, cleanArgs);
		} else {
			toolResult = {
				isError: true,
				content: [
					{
						type: 'text',
						text: t('uiMessages.agentToolNotFound', { name: tc.name }),
					},
				],
			};
		}

		const resultText = truncateToolResult(extractToolResultText(toolResult), tc.name);
		debugLogger.logMcp('Tool Result', `◀️ 툴 결과: ${tc.name} → ${resultText.length}자`, {
			result: resultText,
		});

		return {
			role: toolMsgRole,
			name: tc.name,
			content: useTextTools
				? t('uiMessages.agentToolResultFor', { name: tc.name }) + '\n' + resultText
				: resultText,
			...(useTextTools ? {} : { tool_call_id: tc.id }),
			thoughtSignature: tc.thoughtSignature,
		};
	} catch (e) {
		debugLogger.logMcp('Tool Error', `❌ 툴 실행 오류 ${tc.name}`, {
			error: (e as Error).message,
		});

		return {
			role: toolMsgRole,
			name: tc.name,
			content: useTextTools
				? t('uiMessages.agentToolError', {
						name: tc.name,
						error: (e as Error).message,
					})
				: t('uiMessages.agentToolExecuteError', { error: (e as Error).message }),
			...(useTextTools ? {} : { tool_call_id: tc.id }),
			thoughtSignature: tc.thoughtSignature,
		};
	}
}