import * as pdfjsLib from 'pdfjs-dist';

// 모바일/브라우저 환경에서 워커를 직접 불러오기 위해 CDN 사용
// (오프라인 환경 지원이 필요한 경우 esbuild를 통한 워커 파일 복사 방식 도입 필요)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export class PdfParser {
	/**
	 * PDF ArrayBuffer에서 텍스트를 추출합니다.
	 */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			// ArrayBuffer를 Uint8Array로 변환
			const data = new Uint8Array(buffer);
			const loadingTask = pdfjsLib.getDocument({ data });
			const pdf = await loadingTask.promise;
			let fullText = '';

			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const content = await page.getTextContent();
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const strings = content.items.map((item: any) => item.str);
				fullText += strings.join(' ') + '\n\n';
			}

			return fullText;
		} catch (error) {
			console.error('[Lumina] PDF 파싱 오류:', error);
			return '';
		}
	}
}
