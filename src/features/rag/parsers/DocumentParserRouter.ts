import { App, TFile } from 'obsidian';
import { PdfParser } from './PdfParser';
import { DocxParser } from './DocxParser';
import { XlsxParser } from './XlsxParser';
import { TextParser } from './TextParser';

// 지원하는 확장자 목록 (소문자 기준)
export const SUPPORTED_EXTENSIONS = new Set([
	'md', 'txt', 'csv', 'json', 'jsonl', 'html', 'htm',
	'pdf', 'docx', 'xlsx', 'xls'
]);

export class DocumentParserRouter {
	/**
	 * 파일을 읽고 확장자에 맞는 파서를 통해 텍스트를 추출합니다.
	 * 지원되지 않는 파일이거나 파싱 실패 시 빈 문자열을 반환합니다.
	 */
	static async parse(app: App, file: TFile): Promise<string> {
		const ext = file.extension.toLowerCase();
		
		if (!SUPPORTED_EXTENSIONS.has(ext)) {
			return '';
		}

		try {
			// 바이너리 포맷 라우팅
			if (['pdf', 'docx', 'xlsx', 'xls'].includes(ext)) {
				const buffer = await app.vault.readBinary(file);
				
				switch (ext) {
					case 'pdf':
						return await PdfParser.parse(buffer);
					case 'docx':
						return await DocxParser.parse(buffer);
					case 'xlsx':
					case 'xls':
						return await XlsxParser.parse(buffer);
				}
			} 
			
			// 텍스트 포맷 라우팅
			if (['md', 'txt', 'csv', 'json', 'jsonl', 'html', 'htm'].includes(ext)) {
				const textContent = await app.vault.read(file);
				
				// 마크다운은 별도의 단순 파싱 없이 원본 텍스트 리턴 (이후 전처리 로직에서 처리됨)
				if (ext === 'md') {
					return textContent;
				}
				
				return await TextParser.parse(textContent, ext);
			}
			
		} catch (error) {
			console.error(`[Lumina] 파일 읽기/파싱 실패 (${file.path}):`, error);
		}
		
		return '';
	}
	/**
	 * 원시 ArrayBuffer 데이터를 파싱합니다.
	 */
	static async parseBuffer(buffer: ArrayBuffer, ext: string): Promise<string> {
		switch (ext) {
			case 'pdf':
				return await PdfParser.parse(buffer);
			case 'docx':
				return await DocxParser.parse(buffer);
			case 'xlsx':
			case 'xls':
				return await XlsxParser.parse(buffer);
		}
		return '';
	}

	/**
	 * 원시 텍스트 데이터를 파싱합니다.
	 */
	static async parseText(text: string, ext: string): Promise<string> {
		if (ext === 'md') {
			return text;
		}
		return await TextParser.parse(text, ext);
	}
}
