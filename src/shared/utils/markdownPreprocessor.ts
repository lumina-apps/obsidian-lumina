/** 마크다운 전처리: frontmatter 제거 + 위키링크 텍스트 추출 */
export function preprocessMarkdown(content: string): string {
	return content
		.replace(/^---[\s\S]*?---\n?/, '')
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.trim();
}
