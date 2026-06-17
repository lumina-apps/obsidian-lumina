import { TextParser } from './TextParser';

/** 지원하는 확장자 목록 */
export const SUPPORTED_EXTENSIONS = new Set([
	'md', 'txt', 'csv', 'json', 'jsonl', 'html', 'htm',
	'pdf', 'docx', 'xlsx', 'xls'
]);

export class DocumentParserRouter {
	/** 원시 텍스트 데이터를 파싱합니다. */
	static async parseText(text: string, ext: string): Promise<string> {
		if (ext === 'md') {
			return text;
		}
		return await TextParser.parse(text, ext);
	}
}

