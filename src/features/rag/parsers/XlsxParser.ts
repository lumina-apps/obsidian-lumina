import JSZip from 'jszip';
import { debugLogger } from '../../../shared/debugLogger';

/** XML 엔티티 디코딩 */
function unescapeXml(str: string): string {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** 엑셀 열 이름(예: 'A', 'B', 'AA')을 0-based 인덱스로 변환 */
function colLettersToIndex(col: string): number {
	let index = 0;
	const upper = col.toUpperCase();
	for (let i = 0; i < upper.length; i++) {
		index = index * 26 + (upper.charCodeAt(i) - 64);
	}
	return index - 1;
}

export class XlsxParser {
	/** XLSX, CSV ArrayBuffer에서 텍스트를 추출합니다. */
	static async parse(buffer: ArrayBuffer): Promise<string> {
		try {
			// 1. ZIP 아카이브 (XLSX) 시도
			let zip: JSZip;
			try {
				zip = await JSZip.loadAsync(buffer);
			} catch {
				// ZIP 형식이 아닌 경우 (예: 순수 CSV 텍스트) UTF-8 디코딩
				const decoder = new TextDecoder('utf-8');
				return decoder.decode(buffer);
			}

			// 2. xl/sharedStrings.xml 파싱
			const sharedStrings: string[] = [];
			const sstFile = zip.files['xl/sharedStrings.xml'];
			if (sstFile) {
				const sstXml = await sstFile.async('string');
				const siMatches = sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g);
				for (const siMatch of siMatches) {
					const siContent = siMatch[1];
					const tMatches = siContent.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g);
					let str = '';
					for (const t of tMatches) {
						str += t[1];
					}
					sharedStrings.push(unescapeXml(str));
				}
			}

			// 3. xl/workbook.xml에서 시트 목록 파싱
			const wbFile = zip.files['xl/workbook.xml'];
			const sheetEntries: { name: string; sheetId: string; rId?: string }[] = [];
			if (wbFile) {
				const wbXml = await wbFile.async('string');
				const sheetMatches = wbXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*sheetId="([^"]+)"(?:\s+r:id="([^"]+)")?[^>]*\/?>/g);
				for (const m of sheetMatches) {
					sheetEntries.push({ name: m[1], sheetId: m[2], rId: m[3] });
				}
			}

			// 4. xl/worksheets/sheet*.xml 파일 탐색 및 정렬
			const sheetFiles = Object.keys(zip.files)
				.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
				.sort((a, b) => {
					const numA = parseInt(a.match(/sheet(\d+)\.xml$/i)?.[1] ?? '0', 10);
					const numB = parseInt(b.match(/sheet(\d+)\.xml$/i)?.[1] ?? '0', 10);
					return numA - numB;
				});

			let resultText = '';

			for (let i = 0; i < sheetFiles.length; i++) {
				const fileName = sheetFiles[i];
				const sheetFile = zip.files[fileName];
				if (!sheetFile) continue;

				const sheetName = sheetEntries[i]?.name ?? `Sheet${i + 1}`;
				const sheetXml = await sheetFile.async('string');

				const rowMatches = sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g);
				const rows: string[] = [];

				for (const rMatch of rowMatches) {
					const rowXml = rMatch[1];
					const cellMatches = rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g);
					const rowCells: string[] = [];

					for (const cMatch of cellMatches) {
						const attr = cMatch[1];
						const content = cMatch[2];
						const typeMatch = attr.match(/\bt="([^"]+)"/);
						const type = typeMatch ? typeMatch[1] : '';

						let val = '';
						if (type === 's') {
							const vMatch = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
							if (vMatch) {
								const idx = parseInt(vMatch[1].trim(), 10);
								val = sharedStrings[idx] ?? '';
							}
						} else if (type === 'inlineStr') {
							const tMatch = content.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
							val = tMatch ? unescapeXml(tMatch[1]) : '';
						} else if (type === 'b') {
							const vMatch = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
							val = vMatch && vMatch[1].trim() === '1' ? 'TRUE' : 'FALSE';
						} else {
							const vMatch = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
							val = vMatch ? unescapeXml(vMatch[1].trim()) : '';
						}

						// 셀 좌표(예: 'B3')를 파싱하여 빈 열 간격 보정
						const coordMatch = attr.match(/\br="([A-Za-z]+)\d+"/);
						let colIdx = rowCells.length;
						if (coordMatch) {
							colIdx = colLettersToIndex(coordMatch[1]);
						}

						while (rowCells.length < colIdx) {
							rowCells.push('');
						}

						if (val.includes(',') || val.includes('"') || val.includes('\n')) {
							val = `"${val.replace(/"/g, '""')}"`;
						}
						rowCells[colIdx] = val;
					}

					// 빈 행 건너뛰기
					if (rowCells.some((c) => c && c.length > 0)) {
						rows.push(rowCells.join(','));
					}
				}

				if (rows.length > 0) {
					resultText += `--- Sheet: ${sheetName} ---\n${rows.join('\n')}\n\n`;
				}
			}

			return resultText;
		} catch (error) {
			debugLogger.logError('rag', error instanceof Error ? error : new Error(`XLSX/CSV 파싱 오류: ${error}`));
			return '';
		}
	}
}
