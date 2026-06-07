export class TextParser {
	/**
	 * 단순 텍스트 기반 파일의 내용을 파싱합니다.
	 */
	static async parse(content: string, extension: string): Promise<string> {
		try {
			if (extension === 'html' || extension === 'htm') {
				// HTML 태그 제거 및 정리
				return content
					.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
					.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
					.replace(/<[^>]+>/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
			} else if (extension === 'json' || extension === 'jsonl') {
				// JSON 객체의 경우 가독성을 위해 포맷팅
				try {
					// jsonl 처리를 위해 줄바꿈 기준으로 파싱 시도
					if (extension === 'jsonl') {
						return content.split('\n')
							.filter(line => line.trim())
							.map(line => {
								try {
									return JSON.stringify(JSON.parse(line), null, 2);
								} catch {
									return line;
								}
							}).join('\n');
					} else {
						const parsed = JSON.parse(content);
						return JSON.stringify(parsed, null, 2);
					}
				} catch {
					// 파싱 실패 시 원본 반환
					return content;
				}
			}
			
			// txt, md 등 기타 단순 텍스트는 그대로 반환
			return content;
		} catch (error) {
			console.error(`[Lumina] ${extension} 파싱 오류:`, error);
			return '';
		}
	}
}
