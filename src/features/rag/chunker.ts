/**
 * chunker.ts
 *
 * 마크다운 문서를 overlap이 있는 청크로 분할합니다.
 */

import type { DocumentChunk, RawDocument } from '../../shared/types/rag.types';
import { preprocessMarkdown } from '../../shared/utils/markdownPreprocessor';

/**
 * 마크다운 문서를 overlap이 있는 청크로 분할.
 * chunkSize/chunkOverlap은 문자 수 기준 (토큰 수 근사값으로 사용).
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
		// 다음 청크 시작점 = 현재 끝 - overlap (최소 1자 전진 보장)
		start = Math.max(start + 1, end - chunkOverlap);
	}

	return chunks;
}