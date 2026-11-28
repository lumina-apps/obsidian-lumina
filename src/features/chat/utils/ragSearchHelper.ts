/**
 * RAG 벡터 검색 헬퍼. 검색 여부 결정, 쿼리 최적화, 링크 확장, 경량 CRAG 폴백 및 리랭킹을 담당한다.
 */

import type { App } from 'obsidian';
import { searchVault, formatRagContext, type WeightedSearchQuery } from '../../rag/search';
import { setMessageSources, setMessageRagStep } from '../../../core/store/chatStore';
import { debugLogger } from '../../../shared/debugLogger';
import type { ChatRagSource, RagPipelineStep } from '../../../shared/types/chat.types';
import type { RagChunkMeta } from '../../../shared/types/debug.types';
import type { SearchResult } from '../../../shared/types/rag.types';
import type { RagSettings, ConnectionsSettings } from '../../../core/settings/settings.types';
import { rerankChunks } from '../../rag/reranker';
import {
	optimizeSearchQueries,
	generateBroadFallbackQuery,
	type ConversationTurnForQuery,
} from '../../rag/queryOptimizer';
import { findSupportedProvider } from '../../../shared/utils/modelUtils';
import { getAdaptiveMinSimilarity } from '../../rag/utils/searchUtils';
import { getVaultBasePath } from '../../../shared/utils/fileUtils';

/** RAG 검색 수행 여부 결정 */
export function resolveRagSearchFlag(opts: {
	ragEnabled: boolean;
	useRagContext?: boolean;
}): boolean {
	const { ragEnabled, useRagContext } = opts;
	if (!ragEnabled) return false;
	if (useRagContext === false) return false;
	if (useRagContext === true) return true;
	return ragEnabled;
}

export interface PerformRagSearchParams {
	userText: string;
	rag: RagSettings;
	connections: ConnectionsSettings;
	existingContext: string | undefined;
	assistantId?: string;
	indexer: import('../../rag/indexer').VaultIndexer;
	/** Obsidian App 인스턴스 (위키링크 1-hop 확장에 사용) */
	app?: App;
	/** 최근 대화 이력 (쿼리 재작성 시 지시어 해소에 사용) */
	recentHistory?: ConversationTurnForQuery[];
	filterPaths?: string[];
	excludePaths?: string[];
	signal?: AbortSignal;
	/** RAG 단계 변경 커스텀 콜백 (미전달 시 chatStore 직접 업데이트) */
	onStepChange?: (step: RagPipelineStep) => void;
	/** RAG 출처 발견 커스텀 콜백 (미전달 시 chatStore 직접 업데이트) */
	onSourcesFound?: (sources: ChatRagSource[]) => void;
}

export interface RagSearchResult {
	ragContext: string | undefined;
	ragChunksForLog: RagChunkMeta[] | undefined;
}

/** 저신뢰 검색 결과 판정 (임베딩 모델별 적응형 임계값 기반 경량 CRAG 폴백 트리거용) */
function isLowConfidenceResults(results: readonly SearchResult[], adaptiveThreshold: number): boolean {
	if (results.length === 0) return true;
	const top = results[0];
	const rawVec = top.rawVectorScore ?? 0;
	const bm25 = top.bm25Score ?? 0;
	return rawVec < adaptiveThreshold && bm25 < 1.5;
}

/** 1차 결과와 CRAG 재검색 결과를 청크 ID 기준으로 비파괴 병합합니다. */
function mergeSearchResults(
	primary: readonly SearchResult[],
	fallback: readonly SearchResult[],
	limit: number,
): SearchResult[] {
	const merged = new Map<string, SearchResult>();
	for (const r of primary) {
		merged.set(r.chunk.id, r);
	}
	for (const r of fallback) {
		if (!merged.has(r.chunk.id)) {
			// 폴백 결과는 기존 1차 결과보다 우선순위를 낮춰 비파괴 병합
			merged.set(r.chunk.id, { ...r, score: r.score * 0.7 });
		}
	}
	return Array.from(merged.values())
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}

/**
 * RAG 벡터 검색을 수행하고 결과를 ragContext에 병합한다.
 * 검색 결과가 있으면 assistantId 메시지에 RAG 소스도 설정한다.
 */
export async function performRagSearch(params: PerformRagSearchParams): Promise<RagSearchResult> {
	const {
		userText,
		rag,
		connections,
		existingContext,
		assistantId,
		indexer,
		app,
		recentHistory,
		filterPaths,
		excludePaths,
		signal,
		onStepChange,
		onSourcesFound,
	} = params;

	const emitStep = (step: RagPipelineStep): void => {
		if (onStepChange) {
			onStepChange(step);
		} else if (assistantId) {
			setMessageRagStep(assistantId, step);
		}
	};

	const emitSources = (sources: ChatRagSource[]): void => {
		if (onSourcesFound) {
			onSourcesFound(sources);
		} else if (assistantId) {
			setMessageSources(assistantId, sources);
		}
	};

	try {
		let parentChunks = indexer.indexedParentChunks;
		let allowedPaths: string[] | undefined = undefined;

		if (filterPaths && filterPaths.length > 0) {
			parentChunks = parentChunks.filter(c =>
				filterPaths.some(fp => c.path === fp || c.path.startsWith(fp + '/'))
			);
			allowedPaths = Array.from(new Set(parentChunks.map(c => c.path)));
		}

		if (excludePaths && excludePaths.length > 0) {
			const excludeSet = new Set(excludePaths);
			parentChunks = parentChunks.filter(c => !excludeSet.has(c.path));
			if (allowedPaths) {
				allowedPaths = allowedPaths.filter(p => !excludeSet.has(p));
			}
		}

		const ragStart = Date.now();
		const taskProviderConfig = (connections.taskProviderId && connections.taskModelId)
			? findSupportedProvider(connections.providers, connections.taskProviderId)
			: undefined;
		const vaultCwd = app ? getVaultBasePath(app) : undefined;
		const embConfig = connections.embedding;
		const activeModelName =
			embConfig?.mode === 'custom' && embConfig.modelId
				? embConfig.modelId
				: 'ibm-granite/granite-embedding-97m-multilingual-r2';
		const cragThreshold = getAdaptiveMinSimilarity(0.55, activeModelName, rag.minSimilarity);

		// [0] Query Rewriting / Multi-Query (Opt-in + 태스크 모델 가드레일)
		let extraQueries: WeightedSearchQuery[] = [];
		let optimizationStatus = 'disabled';
		let optimizationReason: string | undefined;
		if (rag.enableQueryOptimization && taskProviderConfig && userText.trim().length > 0) {
			emitStep('rewriting');
			const opt = await optimizeSearchQueries({
				userText,
				recentHistory,
				providerConfig: taskProviderConfig,
				modelId: connections.taskModelId,
				signal,
				cwd: vaultCwd,
			});
			extraQueries = opt.extraQueries;
			optimizationStatus = opt.status;
			optimizationReason = opt.reason;
		}

		// [1] Searching (Hybrid + Multi-Query RRF + Obsidian Link 1-hop)
		emitStep('searching');

		const rerankerProviderConfig = (connections.rerankerProviderId && connections.rerankerModelId)
			? findSupportedProvider(connections.providers, connections.rerankerProviderId)
			: undefined;
		const useReranker = Boolean(rerankerProviderConfig);

		// 리랭커 사용 시에는 K * 2 개 추출
		const initialTopK = useReranker ? rag.topK * 2 : rag.topK;
		const hybridAlpha = typeof rag.hybridAlpha === 'number' ? rag.hybridAlpha : 0.5;
		const enableLinkExpansion = rag.enableLinkExpansion !== false;

		let results = await searchVault(
			userText,
			parentChunks,
			indexer.oramaDb,
			(texts: string[]) => indexer.embed(texts),
			initialTopK,
			rag.minSimilarity,
			hybridAlpha,
			allowedPaths,
			{
				app,
				enableLinkExpansion,
				extraQueries,
			},
		);

		// [1.5] 경량 CRAG 1회 폴백 (결과 없음 또는 저신뢰 시 넓은 키워드 재검색)
		let cragTriggered = false;
		if (
			rag.enableCragFallback &&
			taskProviderConfig &&
			userText.trim().length > 0 &&
			isLowConfidenceResults(results, cragThreshold)
		) {
			const broadQuery = await generateBroadFallbackQuery({
				userText,
				providerConfig: taskProviderConfig,
				modelId: connections.taskModelId,
				signal,
				cwd: vaultCwd,
			});
			if (broadQuery) {
				cragTriggered = true;
				const fallbackResults = await searchVault(
					broadQuery,
					parentChunks,
					indexer.oramaDb,
					(texts: string[]) => indexer.embed(texts),
					initialTopK,
					0.0,
					hybridAlpha,
					allowedPaths,
					{
						app,
						enableLinkExpansion,
					},
				);
				results = mergeSearchResults(results, fallbackResults, initialTopK);
			}
		}

		debugLogger.logSystem('rag', `parentChunks: ${parentChunks.length}, Initial Results: ${results.length}`, {
			optimizationStatus,
			...(optimizationReason ? { optimizationReason } : {}),
			extraQueryCount: extraQueries.length,
			cragTriggered,
			linkExpandedCount: results.filter(r => r.expandedViaLink).length,
		});

		if (results.length === 0) {
			emitStep(null);
			return { ragContext: existingContext, ragChunksForLog: undefined };
		}

		// [2] Reranking
		if (rerankerProviderConfig) {
			emitStep('reranking');
			results = await rerankChunks(
				userText,
				results,
				rerankerProviderConfig,
				connections.rerankerModelId,
				rag.topK,
				signal,
				{ minNativeScore: 0.15 },
			);
		}

		// [3] Generating (End of Pipeline)
		emitStep('generating');

		const ragText = formatRagContext(results);
		const ragContext = existingContext
			? `${existingContext}\n\n---\n\n${ragText}`
			: ragText;

		const ragChunksForLog: RagChunkMeta[] = results.map((r) => {
			let bestText = r.bestChildText;
			if (!bestText) {
				const fullText = r.chunk?.text || '';
				const lowerText = fullText.toLowerCase();
				const queryTerms = userText.toLowerCase().split(/\s+/).filter(t => t.length > 0);
				let bestIndex = 0;
				for (const term of queryTerms) {
					const idx = lowerText.indexOf(term);
					if (idx !== -1) {
						bestIndex = Math.max(0, idx - 50);
						break;
					}
				}
				bestText = fullText.slice(bestIndex, bestIndex + 1000);
			}

			return {
				filePath: r.chunk?.path ?? '',
				score: r.score ?? 0,
				preview: bestText.slice(0, 200),
				fullContent: bestText,
			};
		});

		debugLogger.logRagSearch({
			query: userText,
			topK: rag.topK,
			chunks: ragChunksForLog,
			durationMs: Date.now() - ragStart,
		});

		const uniqueSourcesMap = new Map<string, string>();
		for (const chunk of ragChunksForLog) {
			if (chunk.filePath && !uniqueSourcesMap.has(chunk.filePath)) {
				// 가장 점수가 높은 (순서상 앞선) 청크의 원문 텍스트를 저장
				uniqueSourcesMap.set(chunk.filePath, chunk.fullContent);
			}
		}

		if (uniqueSourcesMap.size > 0) {
			const sourcesToSet = Array.from(uniqueSourcesMap.entries()).map(([p, text]) => ({
				filePath: p,
				chunkText: text
			}));
			emitSources(sourcesToSet);
		}

		return { ragContext, ragChunksForLog };
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			emitStep(null);
			throw err;
		}
		emitStep(null);
		debugLogger.logError('rag', err instanceof Error ? err : new Error(`RAG 검색 실패: ${err}`));
		return { ragContext: existingContext, ragChunksForLog: undefined };
	}
}