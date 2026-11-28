/**
 * MCP 툴 수집 및 프롬프트 주입 헬퍼.
 */

import { debugLogger } from '../../../shared/debugLogger';
import { buildTextToolPrompt } from './textToolParser';
import type { ChatMessage, ToolDefinition } from '../../../shared/types/llm.types';
import type { McpTool } from '../../../core/mcp/mcpClient';
import { isDangerousTool } from '../../../shared/utils/mcpUtils';

/** MCP 툴 목록 수집 및 toolServerMap 구성 */
export function collectMcpTools(params: {
	agentEnabled: boolean;
	clientToolsEnabled: boolean;
	mcpManager: { getAllTools(): McpTool[] } | null;
	agentExecutionMode: 'read' | 'edit';
}): {
	mcpTools: ToolDefinition[];
	toolServerMap: Record<string, string>;
} {
	const { agentEnabled, clientToolsEnabled, mcpManager, agentExecutionMode } = params;
	const mcpTools: ToolDefinition[] = [];
	const toolServerMap: Record<string, string> = {};

	if (!agentEnabled || !mcpManager || !clientToolsEnabled) {
		// 프롬프트 캐시 적중률 유지를 위해 툴 목록을 이름순으로 결정적 정렬
	mcpTools.sort((a, b) => a.name.localeCompare(b.name));

	return { mcpTools, toolServerMap };
	}

	const rawTools = mcpManager.getAllTools();
	if (rawTools.length > 0) {
		debugLogger.logMcp('Tools Init', `MCP 툴 ${rawTools.length}개 수집 (mode=${agentExecutionMode})`, rawTools.map((t: McpTool) => t.name));
	}

	for (const tool of rawTools) {


		if (agentExecutionMode === 'read' && isDangerousTool(tool.name)) {
			continue;
		}

		const schema = tool.inputSchema ?? { type: 'object', properties: {} };
		const properties: Record<string, unknown> = { ...(schema.properties ?? {}) };
		mcpTools.push({
			name: tool.name,
			description: tool.description ?? '',
			inputSchema: {
				type: 'object',
				properties: properties,
				required: schema.required ?? [],
			},
		});
		toolServerMap[tool.name] = tool._serverId ?? '';
	}

	// 프롬프트 캐시 적중률 유지를 위해 툴 목록을 이름순으로 결정적 정렬
	mcpTools.sort((a, b) => a.name.localeCompare(b.name));

	return { mcpTools, toolServerMap };
}

/** 시스템 프롬프트 내 `<context>` 또는 `[이전 대화 요약]` 마커 직전에 툴 사용 지침을 삽입합니다. */
function insertToolPromptBeforeDynamicSections(systemContent: string, toolPrompt: string): string {
	const contextIdx = systemContent.indexOf('<context>\n');
	const summaryIdx = systemContent.indexOf('[이전 대화 요약]\n');
	const candidates = [contextIdx, summaryIdx].filter((idx) => idx >= 0);
	if (candidates.length === 0) {
		return systemContent + toolPrompt;
	}
	const insertIdx = Math.min(...candidates);
	const before = systemContent.slice(0, insertIdx).replace(/\n+$/, '');
	const after = systemContent.slice(insertIdx);
	const trimmedTool = toolPrompt.replace(/^\n+/, '');
	return before ? `${before}\n\n${trimmedTool}\n\n${after}` : `${trimmedTool}\n\n${after}`;
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

	const toolPrompt = useTextTools
		? buildTextToolPrompt(mcpTools)
		: `\n\n[Tool Use Instruction]\nYou have access to Obsidian vault tools. If the user asks you to do something that involves notes or files (e.g., summarizing, explaining, analyzing, reading, modifying, writing, appending, or searching), you MUST call the appropriate tool first (such as \`read_active_note\`, \`read_note\`, or search tools to retrieve content before summarizing or answering, and write tools to apply changes). Do not claim a task is unsupported just because there is no single-step tool for it (e.g., summarize by calling \`read_active_note\` or \`read_note\` first, then summarizing the retrieved text).`;

	if (systemContent !== null) {
		llmMessages[0].content = insertToolPromptBeforeDynamicSections(systemContent, toolPrompt);
	} else {
		llmMessages.unshift({ role: 'system', content: toolPrompt });
	}

	return llmMessages;
}