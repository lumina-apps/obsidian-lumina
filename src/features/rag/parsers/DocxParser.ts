import * as mammoth from 'mammoth';
import { debugLogger } from '../../../shared/debugLogger';
import { normalizeError } from '../../../shared/utils/errorUtils';

export class DocxParser {
	/** DOCX ArrayBuffer에서 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			const result = await mammoth.extractRawText({ arrayBuffer: buffer });
			return result.value || '';
		} catch (error) {
			debugLogger.logError('rag', normalizeError(error, `DOCX 파싱 오류: ${error}`));
			return '';
		}
	}
}
