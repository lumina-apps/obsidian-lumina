/**
 * search.ts
 *
 * 임베딩 벡터 기반 코사인 유사도 검색.
 * - cosineSimilarity(): 두 벡터 간 유사도 계산 (0 ~ 1)
 * - searchVault(): 쿼리를 임베딩해서 top-K 청크 반환
 * - formatRagContext(): 결과를 LLM 컨텍스트 문자열로 변환
 */

import type { DocumentChunk, SearchResult } from '../../shared/types/rag.types';
import { calculateBM25 } from './bm25';
import { t } from '../../shared/locales/helpers';

// ─── Similarity ───────────────────────────────────────────────────────────────

/**
 * 두 벡터 간 코사인 유사도 계산 (0 ~ 1).
 * 벡터 길이가 다르거나 비어있으면 0 반환.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;

	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dot   += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * 쿼리 텍스트에 대한 벡터 검색 + BM25 하이브리드 검색.
 *
 * @param query         검색 쿼리 텍스트
 * @param chunks        임베딩이 채워진 청크 목록
 * @param embedFn       텍스트를 임베딩 벡터로 변환하는 함수
 * @param topK          반환할 최대 결과 수
 * @param minSimilarity 최소 유사도 임계값 (0~1). (벡터 점수 기준)
 * @param alpha         하이브리드 점수 가중치 (1.0: 임베딩 전용, 0.0: BM25 전용)
 */
export async function searchVault(
	query: string,
	chunks: DocumentChunk[],
	embedFn: (texts: string[]) => Promise<number[][]>,
	topK: number,
	minSimilarity = 0.65,
	alpha = 0.5,
): Promise<SearchResult[]> {
	const embeddedChunks = chunks.filter(c => c.embedding && c.embedding.length > 0);
	if (embeddedChunks.length === 0) return [];

	// 1. 쿼리 임베딩
	const [queryEmbedding] = await embedFn([query]);

	// 2. 벡터 코사인 유사도 계산
	const vectorResults = embeddedChunks.map(chunk => ({
		chunk,
		vectorScore: cosineSimilarity(queryEmbedding, chunk.embedding!),
	}));

	// 3. BM25 점수 계산
	const bm25Results = calculateBM25(query, embeddedChunks);

	// 4. 점수 정규화 (Max 비율 정규화)
	const maxVectorScore = Math.max(...vectorResults.map(r => r.vectorScore), 0.0001);
	const maxBm25Score = Math.max(...bm25Results.map(r => r.score), 0.0001);

	const hybridResults: SearchResult[] = vectorResults.map((vr, i) => {
		const br = bm25Results[i];
		const normalizedVector = Math.max(0, vr.vectorScore / maxVectorScore);
		const normalizedBm25 = Math.max(0, br.score / maxBm25Score);

		// 하이브리드 점수 결합
		const hybridScore = (alpha * normalizedVector) + ((1 - alpha) * normalizedBm25);

		return {
			chunk: vr.chunk,
			score: hybridScore,
			vectorScore: vr.vectorScore,
			bm25Score: br.score,
		};
	});

	// 벡터 점수가 임계값을 넘거나 BM25 텍스트 매칭 점수가 존재하는 경우만 필터링 후 정렬
	return hybridResults
		.filter(r => (r.vectorScore !== undefined && r.vectorScore >= minSimilarity) || (r.bm25Score !== undefined && r.bm25Score > 0))
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * SearchResult 배열을 LLM에게 전달할 RAG 컨텍스트 문자열로 변환.
 */
export function formatRagContext(results: SearchResult[]): string {
	if (results.length === 0) return '';

	return results
		.map((r, i) => `[${i + 1}] (${t('uiMessages.searchSource')}: ${r.chunk.path})\n${r.chunk.text}`)
		.join('\n\n---\n\n');
}

/**
 * 검색 결과의 텍스트에서 해시태그를 추출하고,
 * 빈도와 문서 유사도를 기반으로 추천 태그 목록을 생성합니다.
 */
export function extractRecommendedTags(results: SearchResult[]): { tag: string; score: number }[] {
	const tagScores: Record<string, number> = {};

	for (const result of results) {
		const text = result.chunk.text;
		const regex = /#[a-zA-Z0-9가-힣_]+/g;
		const matches = text.match(regex);
		
		if (matches) {
			const uniqueTags = Array.from(new Set(matches));
			for (const tag of uniqueTags) {
				// 유사도가 높은 문서에서 나온 태그일수록 높은 점수
				tagScores[tag] = (tagScores[tag] || 0) + result.score;
			}
		}
	}

	return Object.entries(tagScores)
		.map(([tag, score]) => ({ tag, score }))
		.sort((a, b) => b.score - a.score)
		.slice(0, 5); // 상위 5개 반환
}
