import * as xlsx from 'xlsx-js-style';

export class XlsxParser {
	/** XLSX, XLS, CSV ArrayBuffer에서 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			const workbook = xlsx.read(buffer, { type: 'buffer' });
			let text = '';
			
			for (const sheetName of workbook.SheetNames) {
				const sheet = workbook.Sheets[sheetName];
				const csv = xlsx.utils.sheet_to_csv(sheet);
				if (csv.trim()) {
					text += `--- Sheet: ${sheetName} ---\n${csv}\n\n`;
				}
			}
			
			return text;
		} catch (error) {
			console.error('[Lumina] XLSX/CSV 파싱 오류:', error);
			return '';
		}
	}
}
