/**
 * 임베딩 벡터 기반 코사인 유사도 검색 + BM25 하이브리드.
 */

import type { SearchResult, ParentChunk, ChildChunk } from '../../shared/types/rag.types';
import { calculateBM25 } from './bm25';
import { t } from '../../shared/locales/helpers';
import type { OramaStore } from './oramaStore';
import { debugLogger } from '../../shared/debugLogger';

// ─── Similarity ───────────────────────────────────────────────────────────────

/** 두 벡터 간 코사인 유사도 계산 (0~1). 길이가 다르거나 비어있으면 0. */
export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
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
 * 쿼리 텍스트에 대한 벡터 + BM25 하이브리드 검색.
 * Orama를 이용한 하위 청크 벡터 검색 후 상위 청크로 병합합니다.
 */
export async function searchVault(
	query: string,
	parentChunks: ParentChunk[],
	oramaDb: OramaStore | null,
	embedFn: (texts: string[]) => Promise<number[][]>,
	topK: number,
	minSimilarity = 0.65,
	alpha = 0.5,
	activeFilePath?: string | null,
): Promise<SearchResult[]> {
	if (!oramaDb) return [];
	if (parentChunks.length === 0) return [];

	const parentMap = new Map<string, ParentChunk>();
	for (const p of parentChunks) {
		parentMap.set(p.id, p);
	}

	// 1. 쿼리 임베딩
	const [queryEmbedding] = await embedFn([query]);

	// 2. Orama 벡터 검색 (여유있게 topK의 2배 이상, 최소 10개)
	const limit = Math.max(10, topK * 2);
	const hits = await oramaDb.search(queryEmbedding, limit, activeFilePath);
	debugLogger.logDebug('rag', `Orama hits: ${hits.length}`);

	// 3. 하위 청크 결과를 상위 청크 기준으로 그룹화
	const parentVectorScores = new Map<string, { maxScore: number; sumScore: number; count: number; bestChildText?: string }>();

	for (const hit of hits) {
		const child = hit.activeDocument as unknown as ChildChunk;
		if (!child || !child.parentId) continue;
		
		const parentId = child.parentId;
		const score = hit.score;

		if (!parentVectorScores.has(parentId)) {
			parentVectorScores.set(parentId, { maxScore: score, sumScore: score, count: 1, bestChildText: child.text });
		} else {
			const current = parentVectorScores.get(parentId)!;
			if (score > current.maxScore) {
				current.maxScore = score;
				current.bestChildText = child.text;
			}
			current.sumScore += score;
			current.count += 1;
		}
	}

	// 4. 상위 청크 대상 BM25 점수 계산 (키워드 매칭 최적화)
	const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
	const bm25Candidates = parentChunks.filter(p => {
		const lowerText = p.text.toLowerCase();
		return queryTerms.some(term => lowerText.includes(term));
	});

	const bm25Results = calculateBM25(query, bm25Candidates);
	const bm25ScoreMap = new Map<string, number>();
	let maxBm25Score = 0.0001;
	for (let i = 0; i < bm25Candidates.length; i++) {
		const score = bm25Results[i].score;
		bm25ScoreMap.set(bm25Candidates[i].id, score);
		if (score > maxBm25Score) {
			maxBm25Score = score;
		}
	}

	const hybridResults: SearchResult[] = [];
	let maxVectorScore = 0.0001;

	// 하위 청크 검색 결과가 있는 상위 청크들 처리
	for (const [parentId, stats] of parentVectorScores.entries()) {
		const parentChunk = parentMap.get(parentId);
		if (!parentChunk) continue;

		// 가중치 증가 로직: 동일 상위 청크의 하위 청크가 여러 개 매칭될 경우
		// 최대 점수에 (하위 청크 개수 - 1) * 0.05 의 보너스를 부여
		const vectorScore = stats.maxScore + (stats.count - 1) * 0.05;
		if (vectorScore > maxVectorScore) {
			maxVectorScore = vectorScore;
		}

		const bm25Score = bm25ScoreMap.get(parentId) ?? 0;

		hybridResults.push({
			chunk: parentChunk,
			score: 0, // 나중에 정규화 후 계산
			vectorScore,
			bm25Score,
			bestChildText: stats.bestChildText,
		});
		
		// BM25 맵에서 제거하여 나중에 중복 처리되지 않게 함
		bm25ScoreMap.delete(parentId);
	}

	// 벡터 검색 결과는 없지만 BM25 점수가 높은 상위 청크들 추가 (키워드 매칭)
	for (const [parentId, bm25Score] of bm25ScoreMap.entries()) {
		if (bm25Score > 0) {
			const parentChunk = parentMap.get(parentId);
			if (parentChunk) {
				hybridResults.push({
					chunk: parentChunk,
					score: 0,
					vectorScore: 0,
					bm25Score,
				});
			}
		}
	}

	// 5. 점수 정규화 및 최종 하이브리드 점수 계산
	for (const r of hybridResults) {
		const normalizedVector = Math.max(0, (r.vectorScore ?? 0) / maxVectorScore);
		const normalizedBm25 = Math.max(0, (r.bm25Score ?? 0) / maxBm25Score);
		r.score = (alpha * normalizedVector) + ((1 - alpha) * normalizedBm25);
	}

	// 벡터 점수 ≥ 임계값 또는 BM25 점수 > 0 인 결과만 필터링 후 정렬
	const finalResults = hybridResults
		.filter(r => (r.vectorScore !== undefined && r.vectorScore >= minSimilarity) || (r.bm25Score !== undefined && r.bm25Score > 0))
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
		
	debugLogger.logDebug('rag', `hybridResults before filter: ${hybridResults.length}, after filter: ${finalResults.length}`);
	return finalResults;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** SearchResult 배열을 LLM RAG 컨텍스트 문자열로 변환합니다. */
export function formatRagContext(results: SearchResult[]): string {
	if (results.length === 0) return '';

	return results
		.map((r, i) => `[${i + 1}] (${t('uiMessages.searchSource')}: ${r.chunk.path})\n${r.chunk.text}`)
		.join('\n\n---\n\n');
}
