/**
 * MCP 툴 수집 및 프롬프트 주입 헬퍼.
 */

import { debugLogger } from '../../../shared/debugLogger';
import { buildTextToolPrompt } from './textToolParser';
import type { ChatMessage, ToolDefinition } from '../../../shared/types/llm.types';
import type { McpTool } from '../../../core/mcp/mcpClient';

/** MCP 툴 목록 수집 및 toolServerMap 구성 */
export function collectMcpTools(params: {
	agentEnabled: boolean;
	clientToolsEnabled: boolean;
	mcpManager: { getAllTools(): McpTool[] } | null;
}): {
	mcpTools: ToolDefinition[];
	toolServerMap: Record<string, string>;
} {
	const { agentEnabled, clientToolsEnabled, mcpManager } = params;
	const mcpTools: ToolDefinition[] = [];
	const toolServerMap: Record<string, string> = {};

	if (!agentEnabled || !mcpManager || !clientToolsEnabled) {
		debugLogger.logMcp('Tools Init', 'MCP 툴 비활성화됨 (clientToolsEnabled=false 또는 mcpManager 없음)');
		return { mcpTools, toolServerMap };
	}

	const rawTools = mcpManager.getAllTools();
	debugLogger.logMcp('Tools Init', `MCP 툴 ${rawTools.length}개 수집`, rawTools.map((t: McpTool) => t.name));

	for (const tool of rawTools) {
		const schema = tool.inputSchema ?? { type: 'object', properties: {} };
		const properties: Record<string, unknown> & { _serverId?: unknown } = { ...(schema.properties ?? {}) };
		// _serverId를 inputSchema에 숨겨서 LLM이 tool call 시 arguments에 포함하도록 함
		properties._serverId = { type: 'string', description: 'DO NOT FILL - internal use' };
		mcpTools.push({
			name: tool.name,
			description: tool.description ?? '',
			inputSchema: {
				type: 'object',
				properties: properties as Record<string, { type: string; description: string }>,
				required: schema.required ?? [],
			},
		});
		toolServerMap[tool.name] = tool._serverId ?? '';
	}

	return { mcpTools, toolServerMap };
}

/** 모델 타입에 따라 툴 사용 지침을 system 메시지에 주입 */
export function injectToolPrompts(
	llmMessages: ChatMessage[],
	mcpTools: ToolDefinition[],
	useTextTools: boolean,
): ChatMessage[] {
	if (mcpTools.length === 0) return llmMessages;

	let systemContent: string | null = null;
	if (llmMessages.length > 0 && llmMessages[0].role === 'system') {
		systemContent = llmMessages[0].content as string;
	}

	if (useTextTools) {
		const textToolPrompt = buildTextToolPrompt(mcpTools);
		if (systemContent !== null) {
			llmMessages[0].content = systemContent + textToolPrompt;
		} else {
			llmMessages.unshift({ role: 'system', content: textToolPrompt });
		}
	} else {
		const cloudToolPrompt =
			`\n\n[Tool Use Instruction]\nYou have access to tools. If the user asks you to do something that can be done with a tool (e.g., modifying, writing, appending to, or reading Obsidian notes/files, or running a search), you MUST call the appropriate tool to execute the action. Do not just describe what you would do or output the raw text in the chat; always execute it via tool calling.`;
		if (systemContent !== null) {
			llmMessages[0].content = systemContent + cloudToolPrompt;
		} else {
			llmMessages.unshift({ role: 'system', content: cloudToolPrompt });
		}
	}

	return llmMessages;
}