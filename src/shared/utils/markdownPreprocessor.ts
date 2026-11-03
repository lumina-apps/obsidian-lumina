/** 마크다운 전처리: frontmatter 제거 + 히스토리 직렬화 주석 제거 + 인라인 base64 이미지 제거 + 위키링크 텍스트 추출 */
export function preprocessMarkdown(content: string): string {
	return content
		.replace(/^---[\s\S]*?---\r?\n?/, '')
		.replace(/<!--\s*LUMINA_HISTORY_DATA_V2:[\s\S]*?-->/g, '')
		.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g, '$1')
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.trim();
}
