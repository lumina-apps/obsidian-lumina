import { TextParser } from './TextParser';

/** 지원하는 확장자 목록 */
export const SUPPORTED_EXTENSIONS = new Set([
	'md', 'txt', 'csv', 'json', 'jsonl', 'html', 'htm',
	'pdf', 'docx', 'xlsx', 'xls',
	'pptx', 'epub', 'yaml', 'yml',
]);

export class DocumentParserRouter {
	/** 원시 텍스트 데이터를 파싱합니다. */
	static async parseText(text: string, ext: string): Promise<string> {
		if (ext === 'md') {
			return text;
		}
		return await TextParser.parse(text, ext);
	}

	/** 바이너리 파일 ArrayBuffer에서 텍스트를 추출합니다. */
	static async parseBinary(buffer: ArrayBuffer, ext: string): Promise<string> {
		const lowerExt = ext.toLowerCase();
		try {
			if (lowerExt === 'pdf') {
				const { PdfParser } = await import('./PdfParser');
				return await PdfParser.parse(buffer);
			} else if (lowerExt === 'docx') {
				const { DocxParser } = await import('./DocxParser');
				return await DocxParser.parse(buffer);
			} else if (lowerExt === 'xlsx' || lowerExt === 'xls') {
				const { XlsxParser } = await import('./XlsxParser');
				return await XlsxParser.parse(buffer);
			} else if (lowerExt === 'pptx') {
				const { PptxParser } = await import('./PptxParser');
				return await PptxParser.parse(buffer);
			} else if (lowerExt === 'epub') {
				const { EpubParser } = await import('./EpubParser');
				return await EpubParser.parse(buffer);
			}
		} catch {
			return '';
		}
		return '';
	}
}

