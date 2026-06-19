import type { SearchResult } from '../../shared/types/rag.types';
import type { LLMProviderConfig } from '../../shared/types/settings.types';
import { createProvider } from '../../core/llm-providers';
import { debugLogger } from '../../shared/debugLogger';

/**
 * 프롬프트 기반 Listwise Reranking 구현체.
 * RAG의 1차 검색 결과를 받아 쿼리 연관성 기준으로 재정렬한 후 지정된 개수만큼 반환합니다.
 * 오류 발생 시(Fallback) 원본 정렬 상태의 상위 N개를 그대로 반환합니다.
 */
export async function rerankChunks(
	query: string,
	chunks: SearchResult[],
	providerConfig: LLMProviderConfig,
	modelId: string,
	topK: number,
	signal?: AbortSignal
): Promise<SearchResult[]> {
	if (chunks.length === 0) return chunks;

	try {
		const provider = createProvider(providerConfig);

		const prompt = `You are an expert relevance ranker.
Given the following user query and a list of document chunks, rank the chunks by their relevance to the query.

CRITICAL RULES:
1. Return ONLY a comma-separated list of chunk indices (e.g., 2,0,1,3) ordered from most relevant to least relevant.
2. DO NOT include any other text, explanation, or markdown formatting.

User Query:
${query}

Document Chunks:
${chunks.map((c, i) => `[${i}] ${c.chunk.text.slice(0, 300)}...`).join('\n\n')}
`;

		const response = await provider.chat(
			[{ role: 'user', content: prompt }],
			{
				model: modelId,
				temperature: 0.1,
				maxOutputTokens: 150,
				signal
			}
		);

		const resultText = response.content.trim();
		// Extract numbers using regex in case the LLM wrapped it in markdown or text
		const matches = resultText.match(/\d+/g);
		const orderedIndices = matches ? matches.map(s => parseInt(s)).filter(n => !isNaN(n) && n >= 0 && n < chunks.length) : [];

		const rankedChunks: SearchResult[] = [];
		const added = new Set<number>();

		for (const idx of orderedIndices) {
			if (!added.has(idx)) {
				rankedChunks.push(chunks[idx]);
				added.add(idx);
			}
		}

		// 누락된 청크는 뒤에 덧붙임
		for (let i = 0; i < chunks.length; i++) {
			if (!added.has(i)) {
				rankedChunks.push(chunks[i]);
				added.add(i);
			}
		}

		return rankedChunks.slice(0, topK);
	} catch (e) {
		debugLogger.logError('rag_rerank', e instanceof Error ? e : new Error(`Reranking failed: ${e}`));
		// Fallback: 기존 1차 검색 순위대로 잘라서 반환
		return chunks.slice(0, topK);
	}
}
