/**
 * 마크다운 문서를 상위/하위 overlap 청크로 분할합니다.
 */

import type { ParentChunk, ChildChunk, RawDocument } from '../../shared/types/rag.types';
import { preprocessMarkdown } from '../../shared/utils/markdownPreprocessor';

/**
 * 마크다운 문서를 상위/하위 청크로 분할. 사이즈 및 겹침은 문자 수 기준.
 */
export function chunkDocument(
	doc: RawDocument,
	parentChunkSize: number,
	parentChunkOverlap: number,
	childChunkSize: number,
	childChunkOverlap: number,
): { parentChunks: ParentChunk[]; childChunks: ChildChunk[] } {
	const text = preprocessMarkdown(doc.content);

	if (!text.trim()) return { parentChunks: [], childChunks: [] };

	const parentChunks: ParentChunk[] = [];
	const childChunks: ChildChunk[] = [];
	
	let pStart = 0;
	let pIndex = 0;
	let totalChildIndex = 0;

	while (pStart < text.length) {
		const pEnd = Math.min(pStart + parentChunkSize, text.length);
		const pText = text.slice(pStart, pEnd).trim();

		if (pText) {
			const parentId = `${doc.path}#parent_${pIndex}`;
			parentChunks.push({
				id: parentId,
				path: doc.path,
				text: pText,
				chunkIndex: pIndex,
			});

			let cStart = 0;
			let cIndex = 0;
			
			while (cStart < pText.length) {
				const cEnd = Math.min(cStart + childChunkSize, pText.length);
				const cText = pText.slice(cStart, cEnd).trim();
				
				if (cText) {
					childChunks.push({
						id: `${parentId}#child_${cIndex}`,
						parentId: parentId,
						path: doc.path,
						text: cText,
						chunkIndex: totalChildIndex,
					});
					cIndex++;
					totalChildIndex++;
				}
				
				if (cEnd >= pText.length) break;
				cStart = Math.max(cStart + 1, cEnd - childChunkOverlap);
			}

			pIndex++;
		}

		if (pEnd >= text.length) break;
		pStart = Math.max(pStart + 1, pEnd - parentChunkOverlap);
	}

	return { parentChunks, childChunks };
}