import { getAllTags, type App } from 'obsidian';
import type { ParentChunk } from '../../../shared/types/rag.types';

/**
 * 쿼리(해시태그 또는 텍스트/경로)를 기반으로 ParentChunk 배열을 필터링합니다.
 */
export function filterParentChunks(
	app: App,
	chunks: ParentChunk[],
	filterQuery: string,
): ParentChunk[] {
	const q = filterQuery.trim();
	if (!q) return chunks;

	const tags: string[] = [];
	let pathQuery = '';

	const parts = q.split(/\s+/);
	for (const p of parts) {
		if (p.startsWith('#')) {
			tags.push(p.toLowerCase());
		} else {
			pathQuery += (pathQuery ? ' ' : '') + p.toLowerCase();
		}
	}

	const pathTagMatchCache = new Map<string, boolean>();

	return chunks.filter((c) => {
		if (!c.path) return false;

		// 1. Path Match
		if (pathQuery && !c.path.toLowerCase().includes(pathQuery)) {
			return false;
		}

		// 2. Tag Match
		if (tags.length > 0) {
			if (pathTagMatchCache.has(c.path)) {
				return pathTagMatchCache.get(c.path)!;
			}

			const cache = app.metadataCache.getCache(c.path);
			const fileTags = cache ? (getAllTags(cache) ?? []) : [];
			const tagLowers = fileTags.map(t => t.toLowerCase());

			const matchedTags = tags.every((targetTag) => {
				const targetPrefix = targetTag + '/';
				return tagLowers.some(lower => lower === targetTag || lower.startsWith(targetPrefix));
			});

			pathTagMatchCache.set(c.path, matchedTags);
			if (!matchedTags) return false;
		}

		return true;
	});
}
