import type { TFile } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { SearchResult, ParentChunk } from '../../../shared/types/rag.types';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import { updateDiscoveryState } from '../../../core/store/discoveryStore';
import { searchVault } from '../search';
import { collectRecommendedTags } from '../tagExtractor';
import { preprocessMarkdown } from '../../../shared/utils/markdownPreprocessor';
import { rerankChunks } from '../reranker';

export interface ContextUpdateResult {
	similarNotes: SearchResult[];
	duplicateNote: SearchResult | null;
	recommendedTags: { tag: string; score: number }[];
}

/**
 * 활성 파일 기준으로 RAG 컨텍스트(유사 노트, 중복, 추천 태그)를 계산합니다.
 * UI 로직과 분리된 순수 검색/태그 추출 함수입니다.
 */
export async function buildContextFromActiveFile(
	plugin: LuminaPlugin,
	file: TFile,
	filterQuery: string,
): Promise<ContextUpdateResult> {
	const emptyResult: ContextUpdateResult = {
		similarNotes: [],
		duplicateNote: null,
		recommendedTags: [],
	};

	if (!plugin.indexer) return emptyResult;

	const allParentChunks = plugin.indexer.indexedParentChunks;
	const otherParentChunks = filterChunks(allParentChunks.filter(c => c.path !== file.path), filterQuery, plugin);

	let results: SearchResult[] = [];
	let queryText = '';

	if (otherParentChunks.length > 0) {
		const myFirstChildChunk = plugin.indexer.indexedChildChunks.find(c => c.path === file.path && c.chunkIndex === 0);

		if (myFirstChildChunk?.embedding) {
			const cachedEmbedding = myFirstChildChunk.embedding;
			results = await searchVault('', otherParentChunks, plugin.indexer.oramaDb, async () => [Array.from(cachedEmbedding)], 20, 0.55);
			queryText = myFirstChildChunk.text;
		} else {
			const content = await plugin.app.vault.read(file);
			const cleanContent = preprocessMarkdown(content);
			const queryContext = cleanContent.substring(0, plugin.settings.rag.parentChunkSize || 2000);

			if (queryContext.trim()) {
				results = await searchVault(queryContext, otherParentChunks, plugin.indexer.oramaDb, texts => plugin.indexer!.embed(texts), 20, 0.55);
				queryText = queryContext;
			}
		}

		results = deduplicateByPath(results);

		const rerankerProviderId = plugin.settings.connections.rerankerProviderId;
		const rerankerModelId = plugin.settings.connections.rerankerModelId;

		if (rerankerProviderId && rerankerModelId && results.length > 0 && queryText) {
			const providerConfig = plugin.settings.connections.providers.find((p: LLMProviderConfig) => p.id === rerankerProviderId);
			if (providerConfig) {
				try {
					results = await rerankChunks(
						`다음 문서의 주요 내용과 연관성이 높은 문서를 찾아주세요:\n\n${queryText.slice(0, 500)}`,
						results.slice(0, 20),
						providerConfig,
						rerankerModelId,
						8
					);
				} catch (e) {
					console.error('[Lumina] Related notes reranking failed:', e);
					results = results.slice(0, 8);
				}
			} else {
				results = results.slice(0, 8);
			}
		} else {
			results = results.slice(0, 8);
		}
	}

	const duplicate = results.find(r => r.score >= 0.90) ?? null;

	const recommendedTags = collectRecommendedTags({
		results,
		metadataCache: plugin.app.metadataCache,
		activeFilePath: file.path,
	});

	return { similarNotes: results, duplicateNote: duplicate, recommendedTags };
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

function filterChunks(
	chunks: ParentChunk[],
	filterQuery: string,
	plugin: LuminaPlugin,
): ParentChunk[] {
	const q = filterQuery.trim();
	if (!q) return chunks;

	return chunks.filter(c => {
		if (q.startsWith('#')) {
			const cache = plugin.app.metadataCache.getCache(c.path);
			const tags = cache?.tags?.map(t => t.tag) ?? [];
			const rawTags: unknown = cache?.frontmatter?.tags;
			const fmTags: string[] | undefined = Array.isArray(rawTags) && rawTags.every((v): v is string => typeof v === 'string')
				? rawTags
				: undefined;
			const cleanQ = q.replace('#', '');
			return tags.includes(q) || (fmTags !== undefined && fmTags.includes(cleanQ));
		}
		return c.path.toLowerCase().includes(q.toLowerCase());
	});
}