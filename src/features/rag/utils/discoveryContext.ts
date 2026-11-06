import type { TFile } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { SearchResult } from '../../../shared/types/rag.types';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import { updateDiscoveryState } from '../../../core/store/discoveryStore';
import { searchVault } from '../search';
import { collectRecommendedTags } from '../tagExtractor';
import { preprocessMarkdown } from '../../../shared/utils/markdownPreprocessor';
import { rerankChunks } from '../reranker';
import { filterParentChunks, getAdaptiveMinSimilarity, computeCentroidEmbedding } from './searchUtils';
import { debugLogger } from '../../../shared/debugLogger';
import { normalizeError } from '../../../shared/utils/errorUtils';

export interface ContextUpdateResult {
	similarNotes: SearchResult[];
	duplicateNote: SearchResult | null;
	recommendedTags: { tag: string; score: number }[];
}

const MAX_CONTEXT_CACHE_SIZE = 30;
const contextResultCache = new Map<string, ContextUpdateResult>();

export function clearDiscoveryContextCache(): void {
	contextResultCache.clear();
}

/**
 * 활성 파일 기준으로 RAG 컨텍스트(유사 노트, 중복, 추천 태그)를 계산합니다.
 * UI 로직과 분리된 순수 검색/태그 추출 함수입니다.
 */
export async function buildContextFromActiveFile(
	plugin: LuminaPlugin,
	file: TFile,
	filterQuery: string,
	signal?: AbortSignal,
): Promise<ContextUpdateResult> {
	const emptyResult: ContextUpdateResult = {
		similarNotes: [],
		duplicateNote: null,
		recommendedTags: [],
	};

	if (!plugin.indexer || signal?.aborted) return emptyResult;

	const embConfig = plugin.settings.connections?.embedding;
	const activeModelName =
		embConfig?.mode === 'custom' && embConfig.modelId
			? embConfig.modelId
			: 'ibm-granite/granite-embedding-97m-multilingual-r2';

	const cacheKey = `${plugin.indexer.projectId}|${file.path}|${file.stat?.mtime ?? 0}|${filterQuery.trim()}|${plugin.indexer.indexedFileCount}|${activeModelName}|${plugin.settings.connections?.rerankerModelId ?? ''}`;
	const cached = contextResultCache.get(cacheKey);
	if (cached) {
		// LRU 갱신
		contextResultCache.delete(cacheKey);
		contextResultCache.set(cacheKey, cached);
		return cached;
	}

	const allParentChunks = plugin.indexer.indexedParentChunks;
	const myParentChunks = allParentChunks.filter(c => c.path === file.path);
	const otherParentChunks = filterParentChunks(plugin.app, allParentChunks.filter(c => c.path !== file.path), filterQuery);

	let results: SearchResult[] = [];
	let queryText = '';

	const adaptiveMinSim = getAdaptiveMinSimilarity(
		0.55,
		activeModelName,
		plugin.settings.rag?.minSimilarity,
	);

	if (otherParentChunks.length > 0) {
		const allowedPaths = Array.from(new Set(otherParentChunks.map(c => c.path)));
		const myChildChunks = plugin.indexer.indexedChildChunks.filter(c => c.path === file.path);
		const centroidEmbedding = computeCentroidEmbedding(myChildChunks);

		if (centroidEmbedding) {
			queryText = myParentChunks.length > 0
				? myParentChunks.map(p => p.text).join('\n\n').slice(0, 1500)
				: (myChildChunks[0]?.text ?? '');
			results = await searchVault(
				'',
				otherParentChunks,
				plugin.indexer.oramaDb,
				async () => [centroidEmbedding],
				40,
				adaptiveMinSim,
				0.5,
				allowedPaths,
			);
		} else {
			const content = await plugin.app.vault.read(file);
			if (signal?.aborted) return emptyResult;
			const cleanContent = preprocessMarkdown(content);
			const queryContext = cleanContent.substring(0, plugin.settings.rag.parentChunkSize || 2000);

			if (queryContext.trim()) {
				results = await searchVault(
					queryContext,
					otherParentChunks,
					plugin.indexer.oramaDb,
					texts => plugin.indexer!.embed(texts),
					40,
					adaptiveMinSim,
					0.5,
					allowedPaths,
				);
				queryText = queryContext;
			}
		}

		if (signal?.aborted) return emptyResult;

		results = deduplicateByPath(results);

		const rerankerProviderId = plugin.settings.connections.rerankerProviderId;
		const rerankerModelId = plugin.settings.connections.rerankerModelId;

		if (rerankerProviderId && rerankerModelId && results.length > 1 && queryText) {
			const providerConfig = plugin.settings.connections.providers.find((p: LLMProviderConfig) => p.id === rerankerProviderId);
			if (providerConfig) {
				try {
					results = await rerankChunks(
						`Find documents highly relevant to the main content of the following document:\n\n${queryText.slice(0, 500)}`,
						results.slice(0, 20),
						providerConfig,
						rerankerModelId,
						8,
						signal,
					);
				} catch (e) {
					if (e instanceof Error && e.name === 'AbortError') {
						return emptyResult;
					}
					debugLogger.logError('rag', normalizeError(e, `Related notes reranking failed: ${e}`));
					results = results.slice(0, 8);
				}
			} else {
				results = results.slice(0, 8);
			}
		} else {
			results = results.slice(0, 8);
		}
	}

	if (signal?.aborted) return emptyResult;

	const isSubstantialNote = queryText.trim().length >= 80;
	const duplicateThreshold = activeModelName.toLowerCase().includes('granite-embedding') ? 0.90 : 0.85;
	const duplicate = isSubstantialNote
		? (results.find(r => (r.rawVectorScore ?? r.vectorScore ?? r.score) >= duplicateThreshold && r.chunk.text.trim().length >= 80) ?? null)
		: null;

	const recommendedTags = collectRecommendedTags({
		results,
		metadataCache: plugin.app.metadataCache,
		activeFilePath: file.path,
	});

	const finalResult: ContextUpdateResult = { similarNotes: results, duplicateNote: duplicate, recommendedTags };
	if (contextResultCache.size >= MAX_CONTEXT_CACHE_SIZE) {
		const oldestKey = contextResultCache.keys().next().value;
		if (oldestKey !== undefined) {
			contextResultCache.delete(oldestKey);
		}
	}
	contextResultCache.set(cacheKey, finalResult);

	return finalResult;
}

/**
 * discoveryStore에 컨텍스트 검색 결과를 기록합니다.
 */
export function applyContextResult(result: ContextUpdateResult, filePath: string): void {
	updateDiscoveryState({
		similarNotes: result.similarNotes,
		duplicateNote: result.duplicateNote,
		recommendedTags: result.recommendedTags,
		lastSearchedFilePath: filePath,
		isSearching: false,
	});
}

// ── 내부 유틸 ──

function deduplicateByPath(results: SearchResult[]): SearchResult[] {
	const seenPaths = new Set<string>();
	const unique: SearchResult[] = [];
	for (const r of results) {
		if (!seenPaths.has(r.chunk.path)) {
			seenPaths.add(r.chunk.path);
			unique.push(r);
		}
	}
	return unique;
}