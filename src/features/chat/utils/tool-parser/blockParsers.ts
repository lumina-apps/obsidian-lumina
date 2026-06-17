/**
 * blockParsers.ts
 *
 * 텍스트 tool call 블록을 파싱하는 전략 함수들.
 * JSON, Python, XML 포맷을 순차적으로 시도한다.
 *
 * textToolParser.ts에서 분리되어 독립적으로 테스트/유지보수 가능.
 */

import type { ToolCall } from '../../../../shared/types/llm.types';
import { parsePythonCall } from './pythonArgsParser';
import { debugLogger } from '../../../../shared/debugLogger';

// ─── 전략: JSON 블록 ──────────────────────────────────────────────────────────

/** JSON 포맷의 tool call 블록을 파싱한다. */
function tryParseJsonBlock(blockContent: string): ToolCall | null {
	try {
		const json = JSON.parse(blockContent) as { name?: string; arguments?: Record<string, unknown> } | null;
		if (json?.name) {
			return {
				id: crypto.randomUUID(),
				name: json.name,
				arguments: json.arguments || {},
			};
		}
	} catch {
		// JSON 파싱 실패 → 다음 전략으로
	}
	return null;
}

// ─── 전략: Python 호출 ────────────────────────────────────────────────────────

/** Python 함수 호출 스타일의 tool call 블록을 파싱한다. */
function tryParsePythonBlock(blockContent: string): ToolCall | null {
	const parsedPy = parsePythonCall(blockContent);
	if (parsedPy) {
		return {
			id: crypto.randomUUID(),
			name: parsedPy.name,
			arguments: parsedPy.arguments,
		};
	}
	return null;
}

// ─── 전략: XML 폴백 ───────────────────────────────────────────────────────────

/** XML 스타일(<name>tool</name><arguments>{}</arguments>) 폴백 파싱. */
function tryParseXmlBlock(blockContent: string): ToolCall | null {
	const nameMatch =
		blockContent.match(/<name>\s*(.*?)\s*<\/name>/i) ||
		blockContent.match(/"name"\s*:\s*"([^"]+)"/i);
	const argsMatch = blockContent.match(/<arguments>\s*([\s\S]*?)(?:<\/arguments>|$)/i);

	if (!nameMatch) return null;

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

	return {
		id: crypto.randomUUID(),
		name: toolName,
		arguments: toolArgs,
	};
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 단일 tool call 블록 내용을 파싱한다.
 * JSON → Python → XML 순서로 시도하며, 첫 성공 시 즉시 반환한다.
 * 모든 전략이 실패하면 null을 반환하고 경고 로그를 남긴다.
 */
export function tryParseBlock(blockContent: string): ToolCall | null {
	const trimmed = blockContent.trim();
	if (!trimmed) return null;

	const result = tryParseJsonBlock(trimmed) || tryParsePythonBlock(trimmed) || tryParseXmlBlock(trimmed);

	if (!result) {
		debugLogger.logMcp(
			'Text Parse',
			'⚠️ tool call 블록 파싱 실패 (JSON/Python/XML 모두 실패)',
		);
	}

	return result;
}