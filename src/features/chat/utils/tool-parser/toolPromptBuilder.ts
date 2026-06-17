/**
 * toolPromptBuilder.ts
 *
 * 로컬/추론 모델용 시스템 프롬프트에 삽입할 텍스트 기반 툴 사용 안내를 생성한다.
 *
 * textToolParser.ts에서 분리되어 독립적으로 테스트/유지보수 가능.
 */

import type { ToolDefinition } from '../../../../shared/types/llm.types';

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────────

/** 단일 툴의 인자 설명 문자열을 생성한다. */
function formatArgsDescription(
	properties: Record<string, { description?: string; type?: string }>,
	required: string[],
): string {
	const entries = Object.entries(properties)
		.filter(([key]) => key !== '_serverId')
		.map(([key, val]) => {
			const isRequired = required.includes(key) ? ' (required)' : ' (optional)';
			return `    ${key}: ${val.description || val.type}${isRequired}`;
		});

	return entries.join('\n') || '    (none)';
}

/** 단일 툴의 설명 문자열을 생성한다. */
function formatToolDescription(tool: ToolDefinition): string {
	const props = tool.inputSchema?.properties ?? {};
	const required = tool.inputSchema?.required ?? [];
	const argsDesc = formatArgsDescription(props, required);
	return `- ${tool.name}: ${tool.description}\n  Arguments:\n${argsDesc}`;
}

/** 모든 툴의 설명을 모아 하나의 문자열로 생성한다. */
function formatAllToolDescriptions(tools: ToolDefinition[]): string {
	return tools.map(formatToolDescription).join('\n');
}

// ─── 프롬프트 템플릿 ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT_TEMPLATE = `\n\n## Available Tools
You have access to the following tools. To use a tool, you MUST output your reasoning in <think> tags first, followed by a JSON block.

The EXACT format you MUST use (the tag is called <lumina_tool_call>, not <tool_call> or <tool_calls>):

<think>
I need to use the tool to find the information the user requested.
</think>
<lumina_tool_call>
{"name": "tool_name", "arguments": {"arg1": "value1"}}
</lumina_tool_call>

The tool result will be provided to you in the next message. You may call multiple tools, but only output ONE <lumina_tool_call> block per response. If you do not need any tools, just respond normally.

Available tools:
{{TOOL_DESCRIPTIONS}}

## Workflow Guidelines
- When the user says "지금 노트에 넣어줘", "현재 노트에 추가해줘", "insert into current note", or any similar phrase referring to the currently open note:
  1. FIRST call \`read_active_note\` (no arguments needed) to retrieve the current note's path and content.
  2. THEN call \`append_to_note\` with the \`path\` from step 1 and your \`content\`.
  NEVER call \`append_to_note\` with a null or empty path — always obtain the path from \`read_active_note\` first.
- When reading a specific note before writing, use \`read_note\` with the correct path.
- Multi-step tasks require multiple tool calls across multiple rounds. Plan ahead in <think> tags.

IMPORTANT: ALWAYS explain your reasoning inside <think>...</think> tags BEFORE outputting a <lumina_tool_call> block.
CRITICAL: If you decide to use a tool, you MUST output the <lumina_tool_call> JSON block immediately after the </think> tag. Do NOT output any conversational text or explanation outside of the <think> tags when calling a tool. Never output <lumina_tool_call> without thinking first.`;

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 로컬/추론 모델용 시스템 프롬프트에 삽입할 텍스트 기반 툴 사용 안내를 생성한다.
 */
export function buildTextToolPrompt(tools: ToolDefinition[]): string {
	const toolDescs = formatAllToolDescriptions(tools);
	return SYSTEM_PROMPT_TEMPLATE.replace('{{TOOL_DESCRIPTIONS}}', toolDescs);
}