/**
 * 임베딩 벡터 기반 코사인 유사도 검색 + BM25 하이브리드 + Multi-Query RRF + 1-Hop 위키링크 확장.
 */

import { type App, normalizePath } from 'obsidian';
import type { SearchResult, ParentChunk, ChildChunk } from '../../shared/types/rag.types';
import { calculateBM25 } from './bm25';
import { t } from '../../shared/locales/helpers';
import type { OramaStore } from './oramaStore';
import { getOneHopLinkedNeighbors } from './linkGraph';
import { debugLogger } from '../../shared/debugLogger';

export interface WeightedSearchQuery {
	query: string;
	weight: number;
}

export interface SearchVaultOptions {
	/** 위키링크 1-hop 확장을 위한 Obsidian App 인스턴스 */
	app?: App;
	/** 위키링크 1-hop 확장 활성화 여부 (기본: false) */
	enableLinkExpansion?: boolean;
	/** Multi-Query RRF 병합용 추가 쿼리 목록 */
	extraQueries?: WeightedSearchQuery[];
}

interface SingleQueryCandidate {
	parentId: string;
	rrfScore: number;
	vectorScore: number;
	rawVectorScore?: number;
	bm25Score: number;
	bestChildText?: string;
}

const RRF_K = 60;

/**
 * 단일 쿼리에 대해 이미 확보된 임베딩 벡터와 텍스트를 기반으로
 * Orama 벡터 검색 + BM25 점수 + RRF 순위 점수를 계산합니다.
 */
async function evaluateSingleQuery(
	queryText: string,
	queryEmbedding: number[],
	parentChunks: ParentChunk[],
	parentMap: Map<string, ParentChunk>,
	oramaDb: OramaStore,
	topK: number,
	alpha: number,
	allowedPaths?: string | string[] | null,
	vectorLimitOverride?: number,
): Promise<{
	candidates: Map<string, SingleQueryCandidate>;
	maxBm25Score: number;
}> {
	const limit = vectorLimitOverride ?? Math.max(50, topK * 8);
	const hits = await oramaDb.search(queryEmbedding, limit, allowedPaths);
	debugLogger.logDebug('rag', `Orama hits: ${hits.length}`);

	// 하위 청크 결과를 상위 청크 기준으로 그룹화
	const parentVectorScores = new Map<
		string,
		{ maxScore: number; sumScore: number; count: number; bestChildText?: string }
	>();

	for (const hit of hits) {
		const child = hit.activeDocument as unknown as ChildChunk;
		if (!child || !child.parentId) continue;

		const parentId = child.parentId;
		const score = hit.score;

		const existing = parentVectorScores.get(parentId);
		if (!existing) {
			parentVectorScores.set(parentId, {
				maxScore: score,
				sumScore: score,
				count: 1,
				bestChildText: child.text,
			});
		} else {
			if (score > existing.maxScore) {
				existing.maxScore = score;
				existing.bestChildText = child.text;
			}
			existing.sumScore += score;
			existing.count += 1;
		}
	}

	// 상위 청크 대상 BM25 점수 계산 (키워드 매칭 최적화)
	const bm25Candidates: ParentChunk[] = [];
	if (queryText.trim().length > 0) {
		const fulltextLimit = Math.max(50, topK * 5);
		const fulltextHits = await oramaDb.searchFulltext(queryText, fulltextLimit, allowedPaths);

		const candidateParentIds = new Set<string>();
		for (const hit of fulltextHits) {
			if (hit.parentId) candidateParentIds.add(hit.parentId);
		}
		for (const pid of parentVectorScores.keys()) {
			candidateParentIds.add(pid);
		}

		for (const pid of candidateParentIds) {
			const p = parentMap.get(pid);
			if (p) bm25Candidates.push(p);
		}
	}

	const bm25Results = calculateBM25(queryText, bm25Candidates, 1.2, 0.75, parentChunks.length);
	const bm25ScoreMap = new Map<string, number>();
	let maxBm25Score = 0.0001;
	for (let i = 0; i < bm25Candidates.length; i++) {
		const score = bm25Results[i].score;
		bm25ScoreMap.set(bm25Candidates[i].id, score);
		if (score > maxBm25Score) {
			maxBm25Score = score;
		}
	}

	const rawEntries: Array<{
		parentId: string;
		vectorScore: number;
		rawVectorScore?: number;
		bm25Score: number;
		bestChildText?: string;
	}> = [];

	for (const [parentId, stats] of parentVectorScores.entries()) {
		if (!parentMap.has(parentId)) continue;
		const vectorScore = stats.maxScore + (stats.count - 1) * 0.05;
		const bm25Score = bm25ScoreMap.get(parentId) ?? 0;
		rawEntries.push({
			parentId,
			vectorScore,
			rawVectorScore: stats.maxScore,
			bm25Score,
			bestChildText: stats.bestChildText,
		});
		bm25ScoreMap.delete(parentId);
	}

	for (const [parentId, bm25Score] of bm25ScoreMap.entries()) {
		if (bm25Score > 0 && parentMap.has(parentId)) {
			rawEntries.push({
				parentId,
				vectorScore: 0,
				bm25Score,
			});
		}
	}

	const sortedByVector = [...rawEntries].sort((a, b) => b.vectorScore - a.vectorScore);
	const sortedByBm25 = [...rawEntries].sort((a, b) => b.bm25Score - a.bm25Score);

	const vectorRankMap = new Map<string, number>();
	sortedByVector.forEach((r, i) => vectorRankMap.set(r.parentId, i + 1));

	const bm25RankMap = new Map<string, number>();
	sortedByBm25.forEach((r, i) => bm25RankMap.set(r.parentId, i + 1));

	const candidates = new Map<string, SingleQueryCandidate>();
	for (const entry of rawEntries) {
		const vRank = vectorRankMap.get(entry.parentId)!;
		const bRank = bm25RankMap.get(entry.parentId)!;
		const vScore = entry.vectorScore > 0 ? 1 / (RRF_K + vRank) : 0;
		const bScore = entry.bm25Score > 0 ? 1 / (RRF_K + bRank) : 0;
		const rrfScore = alpha * vScore + (1 - alpha) * bScore;

		candidates.set(entry.parentId, {
			parentId: entry.parentId,
			rrfScore,
			vectorScore: entry.vectorScore,
			rawVectorScore: entry.rawVectorScore,
			bm25Score: entry.bm25Score,
			bestChildText: entry.bestChildText,
		});
	}

	return { candidates, maxBm25Score };
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * 쿼리 텍스트에 대한 벡터 + BM25 하이브리드 검색.
 * 선택적으로 Multi-Query RRF 융합 및 Obsidian 위키링크 1-hop 확장을 수행합니다.
 */
export async function searchVault(
	query: string,
	parentChunks: ParentChunk[],
	oramaDb: OramaStore | null,
	embedFn: (texts: string[]) => Promise<number[][]>,
	topK: number,
	minSimilarity = 0.0,
	alpha = 0.5,
	allowedPaths?: string | string[] | null,
	options?: SearchVaultOptions,
): Promise<SearchResult[]> {
	if (!oramaDb) return [];
	if (parentChunks.length === 0) return [];
	if (Array.isArray(allowedPaths) && allowedPaths.length === 0) return [];

	const parentMap = new Map<string, ParentChunk>();
	for (const p of parentChunks) {
		parentMap.set(p.id, p);
	}

	const hasNonEmptyQuery = query.trim().length > 0;
	const validExtras = hasNonEmptyQuery
		? (options?.extraQueries ?? [])
				.filter(eq => eq.query.trim().length > 0 && eq.weight > 0)
				.slice(0, 2)
		: [];

	// 1. 원본 쿼리 + 추가 쿼리를 배치 1회로 임베딩
	const textsToEmbed = [query, ...validExtras.map(eq => eq.query)];
	const embeddings = await embedFn(textsToEmbed);
	const primaryEmbedding = embeddings?.[0];
	if (!primaryEmbedding || primaryEmbedding.length === 0) return [];

	// 2. 원본 쿼리 1차 평가 (항상 가중치 1.0 기준으로 유지)
	const primaryEval = await evaluateSingleQuery(
		query,
		primaryEmbedding,
		parentChunks,
		parentMap,
		oramaDb,
		topK,
		alpha,
		allowedPaths,
	);

	const mergedMap = new Map<string, SearchResult>();
	for (const [parentId, cand] of primaryEval.candidates.entries()) {
		const chunk = parentMap.get(parentId);
		if (!chunk) continue;
		mergedMap.set(parentId, {
			chunk,
			score: cand.rrfScore,
			vectorScore: cand.vectorScore,
			rawVectorScore: cand.rawVectorScore,
			bm25Score: cand.bm25Score,
			bestChildText: cand.bestChildText,
		});
	}

	let globalMaxBm25 = primaryEval.maxBm25Score;

	// 3. Multi-Query 가중 RRF 병합 (원본 결과를 밀어내지 않는 Additive 융합)
	for (let i = 0; i < validExtras.length; i++) {
		const extraEmb = embeddings[i + 1];
		if (!extraEmb || extraEmb.length === 0) continue;

		const extraQuery = validExtras[i];
		const extraEval = await evaluateSingleQuery(
			extraQuery.query,
			extraEmb,
			parentChunks,
			parentMap,
			oramaDb,
			topK,
			alpha,
			allowedPaths,
			Math.max(30, topK * 4),
		);
		if (extraEval.maxBm25Score > globalMaxBm25) {
			globalMaxBm25 = extraEval.maxBm25Score;
		}

		for (const [parentId, cand] of extraEval.candidates.entries()) {
			const chunk = parentMap.get(parentId);
			if (!chunk) continue;
			const weightedScore = cand.rrfScore * extraQuery.weight;
			const existing = mergedMap.get(parentId);
			if (existing) {
				existing.score += weightedScore;
				if ((existing.bm25Score ?? 0) < cand.bm25Score) {
					existing.bm25Score = cand.bm25Score;
				}
				if ((existing.rawVectorScore ?? 0) < (cand.rawVectorScore ?? 0)) {
					existing.rawVectorScore = cand.rawVectorScore;
				}
				if (!existing.bestChildText && cand.bestChildText) {
					existing.bestChildText = cand.bestChildText;
				}
			} else {
				mergedMap.set(parentId, {
					chunk,
					score: weightedScore,
					vectorScore: cand.vectorScore,
					rawVectorScore: cand.rawVectorScore,
					bm25Score: cand.bm25Score,
					bestChildText: cand.bestChildText,
				});
			}
		}
	}

	// 4. Obsidian 위키링크 1-Hop 그래프 확장 (추가 임베딩 비용 0)
	if (options?.enableLinkExpansion && options?.app && hasNonEmptyQuery && mergedMap.size > 0) {
		const rankedBeforeLink = Array.from(mergedMap.values()).sort((a, b) => b.score - a.score);
		const seedPaths: string[] = [];
		const seenSeedPaths = new Set<string>();
		for (const r of rankedBeforeLink) {
			const np = normalizePath(r.chunk.path);
			if (!seenSeedPaths.has(np)) {
				seenSeedPaths.add(np);
				seedPaths.push(r.chunk.path);
				if (seedPaths.length >= 3) break;
			}
		}

		// 이미 최종 topK 안에 들어갈 상위 결과 경로만 제외하고, topK 밖의 하위 후보(또는 미포함 노트)는 링크 확장 대상에 포함
		const topKPathSet = new Set(
			rankedBeforeLink.slice(0, topK).map(r => normalizePath(r.chunk.path)),
		);

		const allowedPathSet =
			typeof allowedPaths === 'string'
				? new Set([normalizePath(allowedPaths)])
				: Array.isArray(allowedPaths)
					? new Set(allowedPaths.map(p => normalizePath(p)))
					: null;

		const neighbors = getOneHopLinkedNeighbors(options.app, seedPaths, {
			maxNeighborsPerSeed: 4,
			maxTotalNeighbors: 10,
			allowedPathSet,
			excludePathSet: topKPathSet,
		});

		if (neighbors.length > 0) {
			const neighborByPath = new Map(neighbors.map(n => [normalizePath(n.path), n]));
			const existingPathsInMerged = new Set(
				rankedBeforeLink.map(r => normalizePath(r.chunk.path)),
			);

			// 1차 검색 topK 경계 점수를 기준으로 링크 보너스 스케일 산정 (1위 Seed는 넘지 않도록 상한 적용)
			const top1Score = rankedBeforeLink[0]?.score ?? 1 / (RRF_K + 1);
			const topKBoundaryScore =
				rankedBeforeLink[Math.min(topK - 1, rankedBeforeLink.length - 1)]?.score ??
				1 / (RRF_K + Math.max(1, topK));
			const minLinkScore = minSimilarity > 0 ? Math.max(0.12, minSimilarity * 0.7) : 0.12;
			const maxLinkPromotions = Math.min(2, Math.max(1, Math.floor(topK / 2)));

			// 경로당 최고 점수 ParentChunk 1개만 후보로 선정해 단일 연결 노트가 topK를 도배하지 않도록 제한
			interface LinkPromotionCandidate {
				parentId: string;
				path: string;
				score: number;
				rawScore: number;
				bestChildText?: string;
				linkedFrom: string;
				isExistingEntry: boolean;
				existingEntry?: SearchResult;
			}
			const bestCandidateByPath = new Map<string, LinkPromotionCandidate>();

			// (A) 이미 mergedMap에는 있으나 topK 밖으로 밀려 있던 1-hop 이웃 청크 수집 (경로당 최고 1개)
			for (const entry of mergedMap.values()) {
				const np = normalizePath(entry.chunk.path);
				const neighborMeta = neighborByPath.get(np);
				if (!neighborMeta) continue;
				const baseSim = entry.rawVectorScore ?? entry.vectorScore ?? 0;
				if (baseSim < minLinkScore && (entry.bm25Score ?? 0) <= 0) continue;

				const boostedScore = Math.min(
					top1Score * 0.98,
					Math.max(entry.score, topKBoundaryScore) + (1 / (RRF_K + 1)) * 0.35 * neighborMeta.weight,
				);
				const prev = bestCandidateByPath.get(np);
				if (!prev || boostedScore > prev.score) {
					bestCandidateByPath.set(np, {
						parentId: entry.chunk.id,
						path: np,
						score: boostedScore,
						rawScore: baseSim,
						bestChildText: entry.bestChildText,
						linkedFrom: neighborMeta.linkedFrom,
						isExistingEntry: true,
						existingEntry: entry,
					});
				}
			}

			// (B) mergedMap에 아예 없었던 1-hop 이웃 경로만 Orama에서 원본 queryEmbedding으로 추가 조회
			const unretrievedNeighborPaths = neighbors
				.filter(n => !existingPathsInMerged.has(normalizePath(n.path)))
				.map(n => n.path);

			if (unretrievedNeighborPaths.length > 0) {
				const linkLimit = Math.max(15, unretrievedNeighborPaths.length * 2);
				const linkHits = await oramaDb.search(primaryEmbedding, linkLimit, unretrievedNeighborPaths);

				const linkBestByParent = new Map<
					string,
					{ maxScore: number; bestChildText?: string; path: string }
				>();
				for (const hit of linkHits) {
					const child = hit.activeDocument as unknown as ChildChunk;
					if (!child || !child.parentId || !child.path) continue;
					const prev = linkBestByParent.get(child.parentId);
					if (!prev || hit.score > prev.maxScore) {
						linkBestByParent.set(child.parentId, {
							maxScore: hit.score,
							bestChildText: child.text,
							path: child.path,
						});
					}
				}

				for (const [parentId, info] of linkBestByParent.entries()) {
					if (mergedMap.has(parentId)) continue;
					if (info.maxScore < minLinkScore) continue;
					const parentChunk = parentMap.get(parentId);
					if (!parentChunk) continue;
					const np = normalizePath(info.path);
					const neighborMeta = neighborByPath.get(np);
					if (!neighborMeta) continue;

					const linkScore = Math.min(
						top1Score * 0.98,
						topKBoundaryScore + (1 / (RRF_K + 1)) * 0.35 * neighborMeta.weight + info.maxScore * 0.002,
					);
					const prev = bestCandidateByPath.get(np);
					if (!prev || linkScore > prev.score) {
						bestCandidateByPath.set(np, {
							parentId,
							path: np,
							score: linkScore,
							rawScore: info.maxScore,
							bestChildText: info.bestChildText,
							linkedFrom: neighborMeta.linkedFrom,
							isExistingEntry: false,
						});
					}
				}
			}

			// 상위 maxLinkPromotions 개만 실제 승격 반영
			const promotedCandidates = Array.from(bestCandidateByPath.values())
				.sort((a, b) => b.score - a.score)
				.slice(0, maxLinkPromotions);

			for (const cand of promotedCandidates) {
				if (cand.isExistingEntry && cand.existingEntry) {
					cand.existingEntry.score = cand.score;
					cand.existingEntry.expandedViaLink = true;
					cand.existingEntry.linkedFromPath = cand.linkedFrom;
				} else {
					const parentChunk = parentMap.get(cand.parentId);
					if (!parentChunk) continue;
					mergedMap.set(cand.parentId, {
						chunk: parentChunk,
						score: cand.score,
						vectorScore: cand.rawScore,
						rawVectorScore: cand.rawScore,
						bm25Score: 0,
						bestChildText: cand.bestChildText,
						expandedViaLink: true,
						linkedFromPath: cand.linkedFrom,
					});
				}
			}
		}
	}

	const hybridResults = Array.from(mergedMap.values());

	// 벡터 점수(순수 코사인 유사도) ≥ 임계값 또는 유의미한 BM25 점수인 결과만 필터링 후 정렬
	const finalResults = hybridResults
		.filter((r) => {
			if (r.expandedViaLink) return true;
			const hasSufficientVector =
				r.rawVectorScore !== undefined
					? r.rawVectorScore >= minSimilarity
					: r.vectorScore !== undefined && r.vectorScore >= minSimilarity && r.vectorScore > 0;
			if (hasSufficientVector) return true;
			if (minSimilarity <= 0) {
				return (r.bm25Score ?? 0) > 0;
			}
			return r.rawVectorScore === undefined && (r.bm25Score ?? 0) >= Math.max(1.5, globalMaxBm25 * 0.5);
		})
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
		.map((r, i) => {
			const headingSuffix =
				r.chunk.headingPath && r.chunk.headingPath.length > 0
					? ` > ${r.chunk.headingPath.join(' > ')}`
					: '';
			return `[${i + 1}] (${t('uiMessages.searchSource')}: ${r.chunk.path}${headingSuffix})\n${r.chunk.text}`;
		})
		.join('\n\n---\n\n');
}
