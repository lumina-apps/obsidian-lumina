/**
 * 단일 MCP tool call을 실행하고 결과 ChatMessage를 반환. 실패 시에도 오류 메시지 반환.
 */

import { t } from '../../../shared/locales/helpers';
import { debugLogger } from '../../../shared/debugLogger';
import { extractToolResultText, truncateToolResult } from '../../../shared/utils/toolResultFormatter';
import type { ChatMessage, ToolCall } from '../../../shared/types/llm.types';
import type { McpManager } from '../../../core/mcp/mcpManager';
import { executeWebSearch } from '../../web-search/webSearchTool';
import type { WebSearchSettings } from '../../../core/settings/settings.types';

/** 단일 tool call 실행 → tool result ChatMessage 반환 */
export async function executeToolCall(
	tc: ToolCall,
	mcpManager: McpManager | null,
	toolServerMap: Record<string, string>,
	useTextTools: boolean,
	webSearchSettings?: WebSearchSettings,
	signal?: AbortSignal,
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
		if (resolvedServerId === '__web_search__') {
			if (!webSearchSettings) throw new Error('Web search settings not provided.');
			const resStr = await executeWebSearch(cleanArgs, webSearchSettings);
			toolResult = { content: [{ type: 'text', text: resStr }] };
		} else if (resolvedServerId && mcpManager) {
			toolResult = await mcpManager.callTool(resolvedServerId, tc.name, cleanArgs, signal);
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