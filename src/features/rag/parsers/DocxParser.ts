import JSZip from 'jszip';
import { debugLogger } from '../../../shared/debugLogger';
import { normalizeError } from '../../../shared/utils/errorUtils';

/** XML 엔티티 디코딩 */
function unescapeXml(str: string): string {
	return str
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/&amp;/g, '&');
}

/** WordprocessingML XML에서 단락 및 텍스트를 추출합니다. */
function extractTextFromWordXml(xml: string): string {
	// 삭제된 변경 추적 텍스트(<w:del>) 및 필드 명령어(<w:instrText>) 제거
	const cleaned = xml
		.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '')
		.replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '');

	const paragraphs: string[] = [];
	const pMatches = cleaned.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g);

	let hasParagraphTag = false;
	for (const pMatch of pMatches) {
		hasParagraphTag = true;
		const pXml = pMatch[1];
		let pText = '';
		const tokenMatches = pXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:(?:br|cr)\b[^>]*\/?>/g);
		for (const token of tokenMatches) {
			if (token[1] !== undefined) {
				pText += unescapeXml(token[1]);
			} else if (token[0].startsWith('<w:tab')) {
				pText += '\t';
			} else {
				pText += '\n';
			}
		}
		paragraphs.push(pText);
	}

	if (!hasParagraphTag) {
		const fallbackParts: string[] = [];
		for (const tMatch of cleaned.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
			fallbackParts.push(unescapeXml(tMatch[1]));
		}
		return fallbackParts.join('');
	}

	return paragraphs.join('\n\n') + (paragraphs.length > 0 ? '\n\n' : '');
}

/** _rels/.rels에서 메인 문서 XML 경로를 탐색합니다. */
async function resolveMainDocumentPath(zip: JSZip): Promise<string> {
	const relsFile = zip.files['_rels/.rels'];
	if (relsFile) {
		const relsXml = await relsFile.async('string');
		const relMatches = relsXml.matchAll(/<Relationship\b[^>]*\/?>/g);
		for (const rel of relMatches) {
			const tag = rel[0];
			if (/Type="[^"]*\/officeDocument"/i.test(tag)) {
				const targetMatch = tag.match(/Target="([^"]+)"/i);
				if (targetMatch) {
					const normalized = targetMatch[1].replace(/^\/+/, '');
					if (zip.files[normalized]) {
						return normalized;
					}
				}
			}
		}
	}
	return 'word/document.xml';
}

export class DocxParser {
	/** DOCX ArrayBuffer에서 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			const zip = await JSZip.loadAsync(buffer);
			const mainDocPath = await resolveMainDocumentPath(zip);
			const docFile = zip.files[mainDocPath];
			if (!docFile) {
				throw new Error('Could not find main document part in DOCX archive.');
			}

			const baseDir = mainDocPath.includes('/')
				? mainDocPath.substring(0, mainDocPath.lastIndexOf('/') + 1)
				: 'word/';

			const parts: string[] = [];
			const mainXml = await docFile.async('string');
			const mainText = extractTextFromWordXml(mainXml);
			if (mainText) parts.push(mainText);

			// 각주(footnotes) 및 미주(endnotes)가 존재하면 함께 추출
			for (const noteFile of [`${baseDir}footnotes.xml`, `${baseDir}endnotes.xml`]) {
				const entry = zip.files[noteFile];
				if (entry) {
					const noteXml = await entry.async('string');
					const noteText = extractTextFromWordXml(noteXml);
					if (noteText.trim()) parts.push(noteText);
				}
			}

			return parts.join('');
		} catch (error) {
			debugLogger.logError('rag', normalizeError(error, `DOCX 파싱 오류: ${error}`));
			return '';
		}
	}
}
