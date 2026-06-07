import * as mammoth from 'mammoth';

export class DocxParser {
	/**
	 * DOCX ArrayBuffer에서 텍스트를 추출합니다.
	 */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			// mammoth requires a Node Buffer in some older versions,
			// but modern mammoth usually supports { arrayBuffer }
			const result = await mammoth.extractRawText({ arrayBuffer: buffer });
			return result.value || '';
		} catch (error) {
			console.error('[Lumina] DOCX 파싱 오류:', error);
			return '';
		}
	}
}
