/**
 * RAG 벡터 검색 헬퍼. 검색 여부 결정 및 검색 수행을 담당한다.
 */

import { searchVault, formatRagContext } from '../../rag/search';
import { setMessageSources } from '../../../core/store/chatStore';
import { debugLogger } from '../../../shared/debugLogger';
import type { RagChunkMeta } from '../../../shared/types/debug.types';
import type { RagSettings } from '../../../core/settings/settings.types';
import type { DocumentChunk } from '../../../shared/types/rag.types';

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
	existingContext: string | undefined;
	assistantId: string;
	indexer: {
		indexedChunks: DocumentChunk[];
		embed(texts: string[]): Promise<number[][]>;
	};
	activeFilePath: string | null;
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
	const { userText, rag, existingContext, assistantId, indexer, activeFilePath } = params;

	try {
		let chunksToSearch = indexer.indexedChunks;

		if (rag.dataScope === 'active-note') {
			chunksToSearch = activeFilePath
				? chunksToSearch.filter(c => c.path === activeFilePath)
				: [];
		}

		const ragStart = Date.now();
		const results = await searchVault(
			userText,
			chunksToSearch,
			(texts: string[]) => indexer.embed(texts),
			rag.topK,
		);

		if (results.length === 0) {
			return { ragContext: existingContext, ragChunksForLog: undefined };
		}

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
		debugLogger.logError('rag', err instanceof Error ? err : new Error(`RAG 검색 실패: ${err}`));
		return { ragContext: existingContext, ragChunksForLog: undefined };
	}
}