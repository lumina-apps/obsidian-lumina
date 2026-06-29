/**
 * 텍스트 tool call 블록 파싱 전략. JSON → Python → XML 순으로 시도.
 */

import type { ToolCall } from '../../../../shared/types/llm.types';
import { parsePythonCall } from './pythonArgsParser';
import { debugLogger } from '../../../../shared/debugLogger';

// ─── 전략: JSON ──────────────────────────────────────────────────────────────

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

// ─── 전략: Python ────────────────────────────────────────────────────────────

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

// ─── 전략: XML 폴백 ──────────────────────────────────────────────────────────

function tryParseXmlBlock(blockContent: string): ToolCall | null {
	const nameMatch =
		blockContent.match(/<name>\s*(.*?)\s*<\/name>/i) ||
		blockContent.match(/"name"\s*:\s*"([^"]+)"/i) ||
		blockContent.match(/^name=["']([^"']+)["']/i);

	if (!nameMatch) return null;

	const toolName = nameMatch[1].trim();
	let toolArgs: Record<string, unknown> = {};

	const argsMatch = blockContent.match(/<arguments>\s*([\s\S]*?)(?:<\/arguments>|$)/i);
	if (argsMatch) {
		const argsStr = argsMatch[1].trim();
		try {
			toolArgs = JSON.parse(argsStr) as Record<string, unknown>;
		} catch {
			// fallback
		}
	} else {
		// Try <parameter name="...">...</parameter> format (e.g. Claude's native format)
		const paramRegex = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
		let paramMatch;
		let foundParams = false;
		while ((paramMatch = paramRegex.exec(blockContent)) !== null) {
			toolArgs[paramMatch[1]] = paramMatch[2].trim();
			foundParams = true;
		}

		if (!foundParams) {
			// If neither <arguments> nor <parameter> are found, check if the block Content itself is JSON
			const strippedBlock = blockContent.replace(/^name=["']([^"']+)["']>?/i, '').trim();
			try {
				const json = JSON.parse(strippedBlock);
				if (typeof json === 'object' && json !== null) {
					toolArgs = json as Record<string, unknown>;
				}
			} catch {
				// ignore
			}
		}
	}

	return {
		id: crypto.randomUUID(),
		name: toolName,
		arguments: toolArgs,
	};
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/** 단일 tool call 블록 파싱. JSON → Python → XML 순, 실패 시 null */
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