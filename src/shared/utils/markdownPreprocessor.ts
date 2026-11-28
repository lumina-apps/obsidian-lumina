import type { MarkdownFilterOptions, DocumentMetadata } from '../types/rag.types';

const FRONTMATTER_BLOCK_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** YAML 스칼라 문자열의 양끝 따옴표를 제거합니다. */
function unquoteYamlScalar(raw: string): string {
	const trimmed = raw.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/** YAML 인라인/단일 값 또는 멀티라인 리스트 항목에서 배열을 추출합니다. */
function parseYamlListField(lines: string[], startIdx: number, inlineRest: string): string[] {
	const items: string[] = [];
	const trimmedRest = inlineRest.trim();

	if (trimmedRest.startsWith('[') && trimmedRest.endsWith(']')) {
		const inner = trimmedRest.slice(1, -1);
		for (const part of inner.split(',')) {
			const val = unquoteYamlScalar(part);
			if (val) items.push(val);
		}
		return items;
	}

	if (trimmedRest.length > 0) {
		for (const part of trimmedRest.split(',')) {
			const val = unquoteYamlScalar(part);
			if (val) items.push(val);
		}
		return items;
	}

	for (let i = startIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;
		const listMatch = /^\s*-\s+(.+)$/.exec(line);
		if (!listMatch) break;
		const val = unquoteYamlScalar(listMatch[1]);
		if (val) items.push(val);
	}
	return items;
}

/**
 * 마크다운 frontmatter에서 경량 문서 메타데이터(title, tags, aliases)를 추출합니다.
 * 파싱 실패 시 빈 객체를 반환합니다.
 */
export function extractFrontmatterMetadata(content: string): DocumentMetadata {
	if (!content) return {};
	const match = FRONTMATTER_BLOCK_REGEX.exec(content);
	if (!match) return {};

	const yamlBody = match[1];
	const lines = yamlBody.split(/\r?\n/);
	let title: string | undefined;
	const tagSet = new Set<string>();
	const aliasSet = new Set<string>();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fieldMatch = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
		if (!fieldMatch) continue;

		const key = fieldMatch[1].toLowerCase();
		const rest = fieldMatch[2];

		if (key === 'title' && rest.trim()) {
			title = unquoteYamlScalar(rest);
		} else if (key === 'tags' || key === 'tag') {
			const rawTags = parseYamlListField(lines, i, rest);
			for (const raw of rawTags) {
				const cleaned = raw.replace(/^#+/, '').trim();
				if (cleaned) tagSet.add(cleaned);
			}
		} else if (key === 'aliases' || key === 'alias') {
			const rawAliases = parseYamlListField(lines, i, rest);
			for (const raw of rawAliases) {
				if (raw) aliasSet.add(raw);
			}
		}
	}

	const metadata: DocumentMetadata = {};
	if (title) metadata.title = title;
	if (tagSet.size > 0) metadata.tags = Array.from(tagSet).slice(0, 8);
	if (aliasSet.size > 0) metadata.aliases = Array.from(aliasSet).slice(0, 5);
	return metadata;
}

/**
 * 사용자 정의 제외 패턴 문자열을 정규식으로 컴파일합니다.
 * `/pattern/flags` 형식과 일반 정규식 문자열을 모두 지원하며,
 * 유효하지 않은 정규식인 경우 에러를 던지지 않고 null을 반환합니다.
 */
export function compileExcludePattern(rawPattern: string): RegExp | null {
	const trimmed = rawPattern.trim();
	if (!trimmed) return null;

	try {
		const slashMatch = /^\/(.+)\/([gimsuy]*)$/.exec(trimmed);
		if (slashMatch) {
			const flags = slashMatch[2].includes('g') ? slashMatch[2] : `${slashMatch[2]}g`;
			return new RegExp(slashMatch[1], flags);
		}
		return new RegExp(trimmed, 'gm');
	} catch {
		return null;
	}
}

/** 마크다운 전처리: frontmatter 제거 + 히스토리 직렬화 주석 제거 + 콘텐츠 필터(주석/코드블록/이미지/사용자 패턴) + 위키링크 텍스트 추출 */
export function preprocessMarkdown(content: string, options?: MarkdownFilterOptions): string {
	let result = content
		.replace(/^---[\s\S]*?---\r?\n?/, '')
		.replace(/<!--\s*LUMINA_HISTORY_DATA_V2:[\s\S]*?-->/g, '');

	if (options?.excludeComments) {
		result = result
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/%%[\s\S]*?%%/g, '');
	}

	if (options?.excludeCodeBlocks) {
		result = result
			.replace(/```[\s\S]*?```/g, '')
			.replace(/~~~[\s\S]*?~~~/g, '');
	}

	if (options?.excludeImages) {
		result = result
			.replace(/^\[[^\]]+\]:\s*data:image\/[^\r\n]+/gm, '')
			.replace(/<img\b[^>]*>/gi, '')
			.replace(/!\[\[[^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif)(?:[|#][^\]]*)?\]\]/gi, '')
			.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
	} else {
		result = result.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g, '$1');
	}

	if (options?.excludeContentPatterns && options.excludeContentPatterns.length > 0) {
		for (const rawPattern of options.excludeContentPatterns) {
			const regex = compileExcludePattern(rawPattern);
			if (!regex) continue;
			try {
				result = result.replace(regex, '');
			} catch {
				// 정규식 실행 오류 시 안전하게 무시
			}
		}
	}

	return result
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.trim();
}
