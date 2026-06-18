import type { TFile } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { SearchResult, DocumentChunk } from '../../../shared/types/rag.types';
import { updateDiscoveryState } from '../../../core/store/discoveryStore';
import { searchVault } from '../search';
import { collectRecommendedTags } from '../tagExtractor';
import { preprocessMarkdown } from '../../../shared/utils/markdownPreprocessor';

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

	const allChunks = plugin.indexer.indexedChunks;
	const otherChunks = filterChunks(allChunks.filter(c => c.path !== file.path), filterQuery, plugin);

	let results: SearchResult[] = [];

	if (otherChunks.length > 0) {
		const myFirstChunk = allChunks.find(c => c.path === file.path && c.chunkIndex === 0);

		if (myFirstChunk?.embedding) {
			const cachedEmbedding = myFirstChunk.embedding;
			results = await searchVault('', otherChunks, async () => [Array.from(cachedEmbedding)], 20, 0.55);
		} else {
			const content = await plugin.app.vault.read(file);
			const cleanContent = preprocessMarkdown(content);
			const queryContext = cleanContent.substring(0, plugin.settings.rag.chunkSize || 512);

			if (queryContext.trim()) {
				results = await searchVault(queryContext, otherChunks, texts => plugin.indexer!.embed(texts), 20, 0.55);
			}
		}

		results = deduplicateByPath(results).slice(0, 8);
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
	chunks: DocumentChunk[],
	filterQuery: string,
	plugin: LuminaPlugin,
): DocumentChunk[] {
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