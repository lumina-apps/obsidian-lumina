/**
 * textToolParser.ts
 *
 * 로컬/추론 모델용 텍스트 기반 tool calling 파싱 유틸리티.
 * LLM이 <lumina_tool_call> 블록으로 tool call을 표현할 때 이를 파싱하여
 * 구조화된 ToolCall 배열로 변환한다.
 *
 * chatController.ts에서 분리되어 독립적으로 테스트/유지보수 가능.
 */

import type { ToolDefinition } from '../../../shared/types/llm.types';

// ─── buildTextToolPrompt ─────────────────────────────────────────────────────

/**
 * 로컬/추론 모델용 시스템 프롬프트에 삽입할 텍스트 기반 툴 사용 안내를 생성한다.
 */
export function buildTextToolPrompt(tools: ToolDefinition[]): string {
	const toolDescs = tools.map((t: ToolDefinition) => {
		const props = t.inputSchema?.properties ?? {};
		const required = t.inputSchema?.required ?? [];
		const argsDesc = Object.entries(props)
			.filter(([key]) => key !== '_serverId')
			.map(([key, val]) => {
				const isRequired = required.includes(key) ? ' (required)' : ' (optional)';
				const valObj = val as { description?: string; type?: string };
				return `    ${key}: ${valObj.description || valObj.type}${isRequired}`;
			})
			.join('\n');
		return `- ${t.name}: ${t.description}\n  Arguments:\n${argsDesc || '    (none)'}`;
	}).join('\n');

	return `\n\n## Available Tools
You have access to the following tools. To use a tool, you MUST output your reasoning in <think> tags first, followed by a JSON block like this:

<think>
I need to use the tool to find the information the user requested.
</think>
<lumina_tool_call>
{"name": "tool_name", "arguments": {"arg1": "value1"}}
</lumina_tool_call>

The tool result will be provided to you in the next message. You may call multiple tools, but only output ONE <lumina_tool_call> block per response. If you do not need any tools, just respond normally.

Available tools:
${toolDescs}

IMPORTANT: ALWAYS explain your reasoning inside <think>...</think> tags BEFORE outputting a <lumina_tool_call> block.
CRITICAL: If you decide to use a tool, you MUST output the <lumina_tool_call> JSON block immediately after the </think> tag. Do NOT output any conversational text or explanation outside of the <think> tags when calling a tool. Never output <lumina_tool_call> without thinking first.`;
}

// ─── parsePythonArgs ─────────────────────────────────────────────────────────

/**
 * Python 스타일 키워드 인자 문자열을 파싱하여 Record로 반환한다.
 * 예: `path="foo.md", content="bar"` → `{ path: "foo.md", content: "bar" }`
 */
export function parsePythonArgs(argsStr: string): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	let i = 0;
	const len = argsStr.length;

	function skipWhitespace() {
		while (i < len && /\s/.test(argsStr[i])) {
			i++;
		}
	}

	while (i < len) {
		skipWhitespace();
		if (i >= len) break;

		// 1. Read key
		let key = '';
		while (i < len && /[a-zA-Z0-9_-]/.test(argsStr[i])) {
			key += argsStr[i];
			i++;
		}

		if (!key) {
			i++;
			continue;
		}

		skipWhitespace();
		if (i >= len || argsStr[i] !== '=') {
			continue;
		}
		i++; // skip '='
		skipWhitespace();

		if (i >= len) break;

		let val: unknown = undefined;
		const char = argsStr[i];

		if (char === '"' || char === "'") {
			const quoteChar = char;
			let isTriple = false;
			if (i + 2 < len && argsStr[i + 1] === quoteChar && argsStr[i + 2] === quoteChar) {
				isTriple = true;
				i += 3;
			} else {
				i++;
			}

			let strValue = '';
			while (i < len) {
				if (isTriple) {
					if (i + 2 < len && argsStr[i] === quoteChar && argsStr[i + 1] === quoteChar && argsStr[i + 2] === quoteChar) {
						i += 3;
						break;
					}
				} else {
					if (argsStr[i] === quoteChar && argsStr[i - 1] !== '\\') {
						i++;
						break;
					}
				}
				if (!isTriple && argsStr[i] === '\\' && i + 1 < len) {
					const next = argsStr[i + 1];
					if (next === 'n') strValue += '\n';
					else if (next === 't') strValue += '\t';
					else if (next === 'r') strValue += '\r';
					else strValue += next;
					i += 2;
				} else {
					strValue += argsStr[i];
					i++;
				}
			}
			val = strValue;
		} else if (char === '{') {
			let braceCount = 0;
			let dictStr = '';
			while (i < len) {
				const c = argsStr[i];
				dictStr += c;
				if (c === '{') braceCount++;
				else if (c === '}') {
					braceCount--;
					if (braceCount === 0) {
						i++;
						break;
					}
				}
				i++;
			}
			try {
				val = JSON.parse(dictStr.replace(/'/g, '"'));
			} catch {
				val = dictStr;
			}
		} else if (char === '[') {
			let bracketCount = 0;
			let listStr = '';
			while (i < len) {
				const c = argsStr[i];
				listStr += c;
				if (c === '[') bracketCount++;
				else if (c === ']') {
					bracketCount--;
					if (bracketCount === 0) {
						i++;
						break;
					}
				}
				i++;
			}
			try {
				val = JSON.parse(listStr.replace(/'/g, '"'));
			} catch {
				val = listStr;
			}
		} else {
			let valStr = '';
			while (i < len && !/[\s,]/.test(argsStr[i]) && argsStr[i] !== ')') {
				valStr += argsStr[i];
				i++;
			}
			valStr = valStr.trim();
			if (valStr.toLowerCase() === 'true') val = true;
			else if (valStr.toLowerCase() === 'false') val = false;
			else if (valStr.toLowerCase() === 'none' || valStr.toLowerCase() === 'null') val = null;
			else if (!isNaN(Number(valStr)) && valStr !== '') val = Number(valStr);
			else val = valStr;
		}

		args[key] = val;

		skipWhitespace();
		if (i < len && argsStr[i] === ',') {
			i++;
		}
	}

	return args;
}

// ─── parsePythonCall ─────────────────────────────────────────────────────────

/**
 * Python 스타일 함수 호출 문자열을 파싱하여 tool name과 arguments를 반환한다.
 * 예: `write_note(path="foo.md", content="bar")` → `{ name: "write_note", arguments: {...} }`
 */
export function parsePythonCall(code: string): { name: string; arguments: Record<string, unknown> } | null {
	code = code.trim();
	if (code.startsWith('print(') && code.endsWith(')')) {
		code = code.substring(6, code.length - 1).trim();
	}

	const callMatch = code.match(/^([a-zA-Z0-9_-]+)\s*\(([\s\S]*)\)$/);
	if (!callMatch) return null;

	const name = callMatch[1];
	const argsString = callMatch[2].trim();

	const args = parsePythonArgs(argsString);
	return { name, arguments: args };
}

// ─── parseTextToolCalls ───────────────────────────────────────────────────────

interface TextToolCallJson {
	name: string;
	arguments?: Record<string, unknown>;
}

/**
 * LLM 응답 텍스트에서 <lumina_tool_call> (및 유사 태그) 블록을 파싱한다.
 *
 * @returns toolCalls: 파싱된 tool call 목록, cleanContent: 태그 블록을 제거한 순수 텍스트
 */
export function parseTextToolCalls(content: string): {
	toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
	cleanContent: string;
} {
	const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
	// 시작 태그의 오타($lumina_tool_call 등)를 허용하기 위해 더 관대하게 파싱
	const regex = /[<$]*(lumina_tool_call|tool_code|tool_call|use_tool)[>]*\s*([\s\S]*?)\s*<\/\1>/gi;
	let match;
	const parts: string[] = [];
	let lastEnd = 0;

	while ((match = regex.exec(content)) !== null) {
		parts.push(content.substring(lastEnd, match.index));
		const blockContent = match[2].trim();
		try {
			const json = JSON.parse(blockContent) as TextToolCallJson | null | undefined;
			if (json?.name) {
				toolCalls.push({
					id: crypto.randomUUID(),
					name: json.name,
					arguments: json.arguments || {},
				});
			}
		} catch (e) {
			const parsedPy = parsePythonCall(blockContent);
			if (parsedPy) {
				toolCalls.push({
					id: crypto.randomUUID(),
					name: parsedPy.name,
					arguments: parsedPy.arguments,
				});
			} else {
				// XML 스타일 폴백 (예: <name>tool</name><arguments>{}</arguments>)
				const nameMatch = blockContent.match(/<name>\s*(.*?)\s*<\/name>/i) || blockContent.match(/"name"\s*:\s*"([^"]+)"/i);
				const argsMatch = blockContent.match(/<arguments>\s*([\s\S]*?)(?:<\/arguments>|$)/i);

				if (nameMatch) {
					const toolName = nameMatch[1].trim();
					let toolArgs: Record<string, unknown> = {};
					if (argsMatch) {
						const argsStr = argsMatch[1].trim();
						try {
							toolArgs = JSON.parse(argsStr) as Record<string, unknown>;
						} catch {
							// JSON 파싱 실패 시 빈 객체로 fallback
						}
					}
					toolCalls.push({
						id: crypto.randomUUID(),
						name: toolName,
						arguments: toolArgs,
					});
				} else {
					// 파싱 실패 — 로그는 호출자(agentLoop)가 처리
					console.warn('[Lumina] textToolParser: tool call 파싱 실패', { error: (e as Error).message, text: blockContent });
				}
			}
		}
		lastEnd = regex.lastIndex;
	}

	if (lastEnd < content.length) {
		parts.push(content.substring(lastEnd));
	}

	return {
		toolCalls,
		cleanContent: parts.join('').trim(),
	};
}
