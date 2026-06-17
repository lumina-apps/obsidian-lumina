export class TextParser {
	/** 단순 텍스트 기반 파일의 내용을 파싱합니다. */
	static async parse(content: string, extension: string): Promise<string> {
		try {
			if (extension === 'html' || extension === 'htm') {
				return content
					.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
					.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
					.replace(/<[^>]+>/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
			} else if (extension === 'json' || extension === 'jsonl') {
				try {
					if (extension === 'jsonl') {
						return content.split('\n')
							.filter(line => line.trim())
							.map(line => {
								try { return JSON.stringify(JSON.parse(line), null, 2); }
								catch { return line; }
							}).join('\n');
					} else {
						const parsed = JSON.parse(content) as unknown;
						return JSON.stringify(parsed, null, 2);
					}
				} catch {
					return content;
				}
			}
			
			return content;
		} catch (error) {
			console.error(`[Lumina] ${extension} 파싱 오류:`, error);
			return '';
		}
	}
}
