import * as pdfjsLib from 'pdfjs-dist';

// 모바일/브라우저 환경에서 워커를 CDN으로 로드
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export class PdfParser {
	/** PDF ArrayBuffer에서 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			const data = new Uint8Array(buffer);
			const loadingTask = pdfjsLib.getDocument({ data });
			const pdf = await loadingTask.promise;
			let fullText = '';

			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const content = (await page.getTextContent()) as { items: Array<unknown> };
				const strings = content.items
					.filter((item): item is { str: string } => typeof item === 'object' && item !== null && 'str' in item)
					.map((item: { str: string }) => item.str);
				fullText += strings.join(' ') + '\n\n';
			}

			return fullText;
		} catch (error) {
			console.error('[Lumina] PDF 파싱 오류:', error);
			return '';
		}
	}
}
