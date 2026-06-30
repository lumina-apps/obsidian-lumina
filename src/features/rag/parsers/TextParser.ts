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
			} else if (extension === 'yaml' || extension === 'yml') {
				return TextParser.parseYaml(content);
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

	/**
	 * YAML 텍스트를 key: value 형태의 구조화된 텍스트로 변환합니다.
	 * 외부 라이브러리 없이 정규식으로 처리하며, 주석과 빈 줄을 정리합니다.
	 */
	static parseYaml(content: string): string {
		const lines = content.split('\n');
		const result: string[] = [];

		for (const line of lines) {
			// 빈 줄과 주석 제거
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;

			// 리스트 항목 (- value 또는 - key: value)
			const listMatch = line.match(/^(\s*)-\s+(.+)$/);
			if (listMatch) {
				const indent = listMatch[1].length;
				const value = listMatch[2].trim();
				const prefix = indent > 0 ? '  '.repeat(Math.floor(indent / 2)) + '• ' : '• ';
				result.push(prefix + value);
				continue;
			}

			// key: value 형태
			const kvMatch = line.match(/^(\s*)([^:#\s][^:]*?):\s*(.*)$/);
			if (kvMatch) {
				const indent = kvMatch[1].length;
				const key = kvMatch[2].trim();
				const value = kvMatch[3].trim();
				const prefix = indent > 0 ? '  '.repeat(Math.floor(indent / 2)) : '';
				if (value) {
					// 따옴표 제거
					const cleanValue = value.replace(/^["'](.*)["']$/, '$1');
					result.push(`${prefix}${key}: ${cleanValue}`);
				} else {
					// 값이 없으면 다음 줄들이 중첩 구조 → 섹션 헤더로 표시
					result.push(`${prefix}[${key}]`);
				}
				continue;
			}

			// 그 외 (멀티라인 스칼라 등) 그대로 포함
			if (trimmed) result.push(trimmed);
		}

		return result.join('\n');
	}
}
