import type { DebugLogEntry } from '../../../shared/types/debug.types';

/** 하이라이트 분할 세그먼트 */
export interface HighlightSegment {
	text: string;
	matched: boolean;
}

/** 엔트리별 소문자 검색 텍스트 캐시 (링 버퍼에서 제거 시 자동 GC) */
const searchableTextCache = new WeakMap<DebugLogEntry, string>();

/**
 * 순환 참조 및 BigInt를 안전하게 처리하여 값을 JSON 문자열로 직렬화합니다.
 */
export function safeJsonStringify(value: unknown, space?: number): string {
	const seen = new WeakSet<object>();
	try {
		const result = JSON.stringify(
			value,
			(_key: string, current: unknown): unknown => {
				if (typeof current === 'bigint') {
					return current.toString();
				}
				if (typeof current === 'object' && current !== null) {
					if (seen.has(current)) {
						return '[Circular]';
					}
					seen.add(current);
				}
				return current;
			},
			space,
		);
		return result ?? String(value);
	} catch {
		return String(value);
	}
}

/**
 * 검색어를 공백 기준으로 분리하고 소문자·중복 제거된 토큰 배열을 반환합니다.
 */
export function tokenizeSearchQuery(query: string): string[] {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) return [];
	const parts = trimmed.split(/\s+/).filter(Boolean);
	return Array.from(new Set(parts));
}

/**
 * 디버그 로그 엔트리의 검색 대상 텍스트를 추출하고 소문자로 정규화해 캐싱합니다.
 */
export function getSearchableText(entry: DebugLogEntry): string {
	const cached = searchableTextCache.get(entry);
	if (cached !== undefined) {
		return cached;
	}

	const parts: string[] = [entry.type];

	switch (entry.type) {
		case 'llm-request': {
			parts.push(entry.model, entry.provider);
			if (entry.reasoning) parts.push(entry.reasoning);
			parts.push(entry.systemPrompt);
			for (const msg of entry.messages) {
				parts.push(msg.role, msg.content);
			}
			if (entry.ragChunks) {
				for (const chunk of entry.ragChunks) {
					parts.push(chunk.filePath, chunk.preview, chunk.fullContent);
				}
			}
			break;
		}
		case 'llm-response': {
			parts.push(entry.model, entry.requestId);
			if (entry.stopReason) parts.push(entry.stopReason);
			parts.push(entry.content);
			break;
		}
		case 'rag': {
			parts.push(entry.query);
			for (const chunk of entry.chunks) {
				parts.push(chunk.filePath, chunk.preview, chunk.fullContent);
			}
			break;
		}
		case 'system': {
			parts.push(entry.event, entry.message);
			if (entry.meta !== undefined) {
				parts.push(safeJsonStringify(entry.meta));
			}
			break;
		}
		case 'error': {
			parts.push(entry.domain, entry.message);
			if (entry.stack) parts.push(entry.stack);
			break;
		}
		case 'mcp': {
			parts.push(entry.action, entry.message);
			if (entry.data !== undefined) {
				parts.push(
					typeof entry.data === 'string'
						? entry.data
						: safeJsonStringify(entry.data),
				);
			}
			break;
		}
	}

	const normalized = parts.join('\n').toLowerCase();
	searchableTextCache.set(entry, normalized);
	return normalized;
}

/**
 * 엔트리가 모든 검색 토큰을 포함하는지(AND 매칭) 검사합니다.
 */
export function matchesSearchQuery(
	entry: DebugLogEntry,
	tokens: readonly string[],
): boolean {
	if (tokens.length === 0) return true;
	const searchable = getSearchableText(entry);
	return tokens.every((token) => searchable.includes(token));
}

/** 정규식 메타문자 이스케이프 */
function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 원본 문자열을 검색 토큰 기준 하이라이트 세그먼트 배열로 분할합니다.
 * 긴 토큰을 우선 매칭하며, 매칭된 구간의 원본 대소문자를 보존합니다.
 */
export function splitHighlightSegments(
	text: string,
	tokens: readonly string[],
): HighlightSegment[] {
	if (!text || tokens.length === 0) {
		return [{ text, matched: false }];
	}

	const uniqueTokens = Array.from(
		new Set(tokens.map((t) => t.trim()).filter(Boolean)),
	).sort((a, b) => b.length - a.length);

	if (uniqueTokens.length === 0) {
		return [{ text, matched: false }];
	}

	const pattern = uniqueTokens.map(escapeRegExp).join('|');
	const regex = new RegExp(`(${pattern})`, 'gi');
	const segments: HighlightSegment[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(regex)) {
		const matchIndex = match.index ?? 0;
		const matchedText = match[0];
		if (!matchedText) continue;

		if (matchIndex > lastIndex) {
			segments.push({
				text: text.slice(lastIndex, matchIndex),
				matched: false,
			});
		}
		segments.push({
			text: matchedText,
			matched: true,
		});
		lastIndex = matchIndex + matchedText.length;
	}

	if (lastIndex < text.length) {
		segments.push({
			text: text.slice(lastIndex),
			matched: false,
		});
	}

	return segments.length > 0 ? segments : [{ text, matched: false }];
}
