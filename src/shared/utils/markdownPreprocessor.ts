import type { MarkdownFilterOptions } from '../types/rag.types';

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
