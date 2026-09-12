import * as mammoth from 'mammoth';
import { debugLogger } from '../../../shared/debugLogger';

export class DocxParser {
	/** DOCX ArrayBuffer에서 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			const result = await mammoth.extractRawText({ arrayBuffer: buffer });
			return result.value || '';
		} catch (error) {
			debugLogger.logError('rag', error instanceof Error ? error : new Error(`DOCX 파싱 오류: ${error}`));
			return '';
		}
	}
}
