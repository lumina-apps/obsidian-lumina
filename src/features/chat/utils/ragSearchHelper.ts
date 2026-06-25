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
	dataScope: string;
	useRagContext?: boolean;
}): boolean {
	const { ragEnabled, dataScope, useRagContext } = opts;
	if (!ragEnabled) return false;
	if (useRagContext === false) return false;
	if (useRagContext === true) return true;
	if (dataScope === 'manual') return false;
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
		} else if (rag.dataScope === 'active-note') {
			parentChunks = activeFilePath
				? parentChunks.filter(c => c.path === activeFilePath)
				: [];
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
			rag.dataScope === 'active-note' ? activeFilePath : null
		);

		debugLogger.logSystem('rag', `Scope: ${rag.dataScope}, parentChunks: ${parentChunks.length}, Initial Results: ${results.length}`);

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

		const ragChunksForLog: RagChunkMeta[] = results.map((r) => ({
			filePath: r.chunk?.path ?? '',
			score: r.score ?? 0,
			preview: (r.chunk?.text ?? '').slice(0, 200),
			fullContent: r.chunk?.text ?? '',
		}));

		debugLogger.logRagSearch({
			query: userText,
			topK: rag.topK,
			chunks: ragChunksForLog,
			durationMs: Date.now() - ragStart,
		});

		const uniquePaths = Array.from(new Set(ragChunksForLog.map(c => c.filePath).filter(Boolean)));
		if (uniquePaths.length > 0) {
			setMessageSources(assistantId, uniquePaths.map(p => ({ filePath: p })));
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