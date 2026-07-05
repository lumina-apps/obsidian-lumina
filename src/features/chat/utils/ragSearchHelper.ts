/**
 * RAG 벡터 검색 헬퍼. 검색 여부 결정 및 검색 수행을 담당한다.
 */

import { searchVault, formatRagContext } from '../../rag/search';
import { setMessageSources, setMessageRagStep } from '../../../core/store/chatStore';
import { debugLogger } from '../../../shared/debugLogger';
import type { RagChunkMeta } from '../../../shared/types/debug.types';
import type { RagSettings, ConnectionsSettings } from '../../../core/settings/settings.types';
import { rerankChunks } from '../../rag/reranker';
import { compressChunks } from '../../rag/compressor';

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
	assistantId: string;
	indexer: import('../../rag/indexer').VaultIndexer;
	activeFilePath: string | null;
	filterPaths?: string[];
	signal?: AbortSignal;
}

export interface RagSearchResult {
	ragContext: string | undefined;
	ragChunksForLog: RagChunkMeta[] | undefined;
}

/**
 * RAG 벡터 검색을 수행하고 결과를 ragContext에 병합한다.
 * 검색 결과가 있으면 assistantId 메시지에 RAG 소스도 설정한다.
 */
export async function performRagSearch(params: PerformRagSearchParams): Promise<RagSearchResult> {
	const { userText, rag, connections, existingContext, assistantId, indexer, activeFilePath, filterPaths, signal } = params;

	try {
		let parentChunks = indexer.indexedParentChunks;

		if (filterPaths && filterPaths.length > 0) {
			parentChunks = parentChunks.filter(c =>
				filterPaths.some(fp => c.path === fp || c.path.startsWith(fp + '/'))
			);
		}

		const ragStart = Date.now();
		
		// [1] Searching
		setMessageRagStep(assistantId, 'searching');
		
		const useReranker = !!(connections.rerankerProviderId && connections.rerankerModelId);
		const useCompressor = !!(connections.taskProviderId && connections.taskModelId);
		
		// 리랭커 사용 시에는 K * 2 개 추출
		const initialTopK = useReranker ? rag.topK * 2 : rag.topK;

		let results = await searchVault(
			userText,
			parentChunks,
			indexer.oramaDb,
			(texts: string[]) => indexer.embed(texts),
			initialTopK,
			rag.minSimilarity,
			0.5,
			null // no more active-note scope
		);

		debugLogger.logSystem('rag', `parentChunks: ${parentChunks.length}, Initial Results: ${results.length}`);

		if (results.length === 0) {
			setMessageRagStep(assistantId, null);
			return { ragContext: existingContext, ragChunksForLog: undefined };
		}

		// [2] Reranking
		if (useReranker) {
			setMessageRagStep(assistantId, 'reranking');
			const providerConfig = connections.providers.find(p => p.id === connections.rerankerProviderId);
			if (providerConfig) {
				results = await rerankChunks(userText, results, providerConfig, connections.rerankerModelId, rag.topK, signal);
			} else {
				// config not found, fallback to topK
				results = results.slice(0, rag.topK);
			}
		}

		// [3] Compressing
		if (useCompressor) {
			setMessageRagStep(assistantId, 'compressing');
			const providerConfig = connections.providers.find(p => p.id === connections.taskProviderId);
			if (providerConfig) {
				results = await compressChunks(userText, results, providerConfig, connections.taskModelId, signal);
			}
		}

		// [4] Generating (End of Pipeline)
		setMessageRagStep(assistantId, 'generating');

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
			setMessageSources(assistantId, sourcesToSet);
		}

		return { ragContext, ragChunksForLog };
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			setMessageRagStep(assistantId, null);
			throw err;
		}
		setMessageRagStep(assistantId, null);
		debugLogger.logError('rag', err instanceof Error ? err : new Error(`RAG 검색 실패: ${err}`));
		return { ragContext: existingContext, ragChunksForLog: undefined };
	}
}