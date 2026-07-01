import type { SearchResult } from '../../shared/types/rag.types';
import type { LLMProviderConfig } from '../../shared/types/settings.types';
import { createProvider } from '../../core/llm-providers';
import { debugLogger } from '../../shared/debugLogger';

/**
 * Task 전용 모델을 이용한 RAG 청크 컨텍스트 압축.
 * 청크 내에서 쿼리와 관련된 핵심 정보만 추출하여 토큰을 절약합니다.
 * 오류 발생 시(Fallback) 원본 청크를 유지합니다.
 */
export async function compressChunks(
	query: string,
	chunks: SearchResult[],
	providerConfig: LLMProviderConfig,
	modelId: string,
	signal?: AbortSignal
): Promise<SearchResult[]> {
	if (chunks.length === 0) return chunks;

	try {
		const provider = createProvider(providerConfig);

		const compressPromises = chunks.map(async (c) => {
			const prompt = `Extract the most relevant information from the following document chunk that helps answer the user's query. If the chunk is not highly relevant, simply summarize its main point briefly.

CRITICAL RULES:
1. DO NOT include any conversational filler or preamble (e.g., "The most relevant information is...", "Here is the summary:"). Output ONLY the extracted/summarized text.
2. MUST respond in the EXACT SAME LANGUAGE as the Document Chunk.
3. Do not change the original meaning.

User Query:
${query}

Document Chunk:
${c.chunk.text}`;

			try {
				const response = await provider.chat(
					[{ role: 'user', content: prompt }],
					{
						model: modelId,
						temperature: 0.3,
						maxOutputTokens: 500,
						signal
					}
				);

				// 불필요한 생각 과정(추론 모델) 제거
				const finalContent = response.content.replace(/<think>[\s\S]*?<\/think>\n*/gi, '').trim();

				// 원본 객체를 복제하여 텍스트만 갱신
				return {
					...c,
					chunk: {
						...c.chunk,
						text: finalContent
					}
				};
			} catch (innerErr) {
				if (innerErr instanceof Error && innerErr.name === 'AbortError') {
					throw innerErr;
				}
				debugLogger.logError('rag_compress_chunk', innerErr instanceof Error ? innerErr : new Error(String(innerErr)));
				return c; // Fallback to original
			}
		});

		return await Promise.all(compressPromises);
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw e;
		}
		debugLogger.logError('rag_compress', e instanceof Error ? e : new Error(`Compression failed: ${e}`));
		return chunks; // Fallback to original
	}
}
