/**
 * 마크다운 문서를 overlap 청크로 분할합니다.
 */

import type { DocumentChunk, RawDocument } from '../../shared/types/rag.types';
import { preprocessMarkdown } from '../../shared/utils/markdownPreprocessor';

/**
 * 마크다운 문서를 overlap 청크로 분할. chunkSize/chunkOverlap은 문자 수 기준.
 */
export function chunkDocument(
	doc: RawDocument,
	chunkSize: number,
	chunkOverlap: number,
): DocumentChunk[] {
	const text = preprocessMarkdown(doc.content);

	if (!text.trim()) return [];

	const chunks: DocumentChunk[] = [];
	let start = 0;
	let index = 0;

	while (start < text.length) {
		const end = Math.min(start + chunkSize, text.length);
		const chunkText = text.slice(start, end).trim();

		if (chunkText) {
			chunks.push({
				id: `${doc.path}::chunk_${index}`,
				path: doc.path,
				text: chunkText,
				chunkIndex: index,
			});
			index++;
		}

		if (end >= text.length) break;
		start = Math.max(start + 1, end - chunkOverlap);
	}

	return chunks;
}