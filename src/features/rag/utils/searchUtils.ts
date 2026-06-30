import type { App } from 'obsidian';
import type { ParentChunk } from '../../../shared/types/rag.types';

/**
 * 쿼리(해시태그 또는 텍스트)를 기반으로 ParentChunk 배열을 필터링합니다.
 */
export function filterParentChunks(
	app: App,
	chunks: ParentChunk[],
	filterQuery: string,
): ParentChunk[] {
	const q = filterQuery.trim();
	if (!q) return chunks;

	return chunks.filter((c) => {
		if (q.startsWith('#')) {
			const cache = app.metadataCache.getCache(c.path);
			const tags = cache?.tags?.map((t) => t.tag) ?? [];
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
