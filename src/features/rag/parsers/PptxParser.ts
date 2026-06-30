import JSZip from 'jszip';

export class PptxParser {
	/** PPTX ArrayBuffer에서 슬라이드 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			const zip = await JSZip.loadAsync(buffer);
			const slideFiles = Object.keys(zip.files)
				.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
				.sort((a, b) => {
					const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10);
					const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10);
					return numA - numB;
				});

			const slideTexts: string[] = [];

			for (const slideName of slideFiles) {
				const slideFile = zip.files[slideName];
				if (!slideFile) continue;

				const xml = await slideFile.async('string');
				// <a:t> 태그에서 텍스트 추출
				const matches = xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g);
				const parts: string[] = [];
				for (const match of matches) {
					const text = match[1].trim();
					if (text) parts.push(text);
				}

				if (parts.length > 0) {
					const slideNum = slideName.match(/slide(\d+)\.xml$/)?.[1] ?? '';
					slideTexts.push(`--- 슬라이드 ${slideNum} ---\n${parts.join(' ')}`);
				}
			}

			return slideTexts.join('\n\n');
		} catch (error) {
			console.error('[Lumina] PPTX 파싱 오류:', error);
			return '';
		}
	}
}
