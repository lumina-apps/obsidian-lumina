import JSZip from 'jszip';

export class EpubParser {
	/** EPUB ArrayBuffer에서 챕터 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			const zip = await JSZip.loadAsync(buffer);

			// 1. META-INF/container.xml에서 OPF 파일 경로 확인
			const containerFile = zip.files['META-INF/container.xml'];
			if (!containerFile) {
				console.warn('[Lumina] EPUB: META-INF/container.xml 없음');
				return '';
			}

			const containerXml = await containerFile.async('string');
			const opfPathMatch = containerXml.match(/full-path="([^"]+\.opf)"/);
			if (!opfPathMatch) {
				console.warn('[Lumina] EPUB: OPF 파일 경로를 찾을 수 없음');
				return '';
			}

			const opfPath = opfPathMatch[1];
			const opfBase = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

			// 2. OPF 파일에서 manifest 및 spine 순서 파싱
			const opfFile = zip.files[opfPath];
			if (!opfFile) return '';

			const opfXml = await opfFile.async('string');

			// manifest에서 id → href 매핑 (xhtml 항목만)
			const manifestMap = new Map<string, string>();
			const manifestMatches = opfXml.matchAll(
				/<item\s[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*media-type="application\/xhtml\+xml"[^>]*\/?>/g
			);
			for (const m of manifestMatches) {
				manifestMap.set(m[1], m[2]);
			}
			// media-type이 앞에 오는 경우도 처리
			const manifestMatches2 = opfXml.matchAll(
				/<item\s[^>]*media-type="application\/xhtml\+xml"[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*\/?>/g
			);
			for (const m of manifestMatches2) {
				if (!manifestMap.has(m[1])) {
					manifestMap.set(m[1], m[2]);
				}
			}

			// spine에서 읽기 순서 추출
			const spineMatches = opfXml.matchAll(/<itemref\s[^>]*idref="([^"]+)"[^>]*\/?>/g);
			const orderedHrefs: string[] = [];
			for (const m of spineMatches) {
				const href = manifestMap.get(m[1]);
				if (href) orderedHrefs.push(href);
			}

			// spine이 비어 있으면 manifest 전체 사용
			const hrefs = orderedHrefs.length > 0 ? orderedHrefs : Array.from(manifestMap.values());

			// 3. 각 XHTML 파일에서 텍스트 추출
			const chapterTexts: string[] = [];

			for (const href of hrefs) {
				const fullPath = opfBase + href;
				const chapterFile = zip.files[fullPath] ?? zip.files[href];
				if (!chapterFile) continue;

				const html = await chapterFile.async('string');
				// body 내용 추출
				const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
				const bodyContent = bodyMatch ? bodyMatch[1] : html;

				const text = bodyContent
					.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
					.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
					.replace(/<[^>]+>/g, ' ')
					.replace(/&amp;/g, '&')
					.replace(/&lt;/g, '<')
					.replace(/&gt;/g, '>')
					.replace(/&nbsp;/g, ' ')
					.replace(/&quot;/g, '"')
					.replace(/&#(\d+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 10)))
					.replace(/\s+/g, ' ')
					.trim();

				if (text) chapterTexts.push(text);
			}

			return chapterTexts.join('\n\n');
		} catch (error) {
			console.error('[Lumina] EPUB 파싱 오류:', error);
			return '';
		}
	}
}
