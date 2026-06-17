/**
 * markdownPreprocessor.ts
 *
 * 마크다운 문서 전처리 유틸:
 * - YAML frontmatter 제거
 * - 위키링크 텍스트 추출 ([[링크|텍스트]] → 텍스트)
 */

/**
 * 마크다운 본문을 전처리하여 검색/임베딩에 최적화된 텍스트로 변환합니다.
 */
export function preprocessMarkdown(content: string): string {
	return content
		.replace(/^---[\s\S]*?---\n?/, '')            // frontmatter
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[link|text]] → text
		.replace(/\[\[([^\]]+)\]\]/g, '$1')            // [[link]] → link
		.trim();
}