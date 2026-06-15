import type { SearchResult } from '../../shared/types/rag.types';

export interface TagScore {
	tag: string;
	score: number;
}

/**
 * 검색 결과의 본문에서 #태그를 추출합니다.
 */
export function extractBodyTags(results: SearchResult[]): TagScore[] {
	const tagMap = new Map<string, number>();
	for (const result of results) {
		const matches = result.chunk.text.match(/#[a-zA-Z0-9\uAC00-\uD7AF_-]+/g);
		if (matches) {
			for (const tag of matches) {
				const cleaned = tag.trim();
				if (cleaned.length <= 1) continue;
				tagMap.set(cleaned, (tagMap.get(cleaned) || 0) + result.score);
			}
		}
	}
	return Array.from(tagMap.entries())
		.map(([tag, score]) => ({ tag, score }))
		.sort((a, b) => b.score - a.score)
		.slice(0, 10);
}

/**
 * 추천 태그 수집 인터페이스 - 메타데이터 캐시 접근이 필요하므로
 * 외부에서 주입받아 사용합니다.
 */
export interface TagCollectorInput {
	results: SearchResult[];
	metadataCache: {
		getCache(path: string): {
			frontmatter?: Record<string, unknown>;
			tags?: { tag: string }[];
		} | null;
	};
	activeFilePath: string | null;
}

/**
 * 유사 문서와 현재 활성 파일의 메타데이터를 종합하여 추천 태그 생성
 */
export function collectRecommendedTags(input: TagCollectorInput): TagScore[] {
	const { results, metadataCache, activeFilePath } = input;
	
	// 1. 본문 태그 우선 수집
	const tagScoreMap = new Map<string, number>();
	const bodyTagScores = extractBodyTags(results);
	for (const t of bodyTagScores) {
		tagScoreMap.set(t.tag, t.score);
	}

	// 2. 유사 문서의 프론트매터/캐시 태그 수집
	for (const result of results) {
		const cache = metadataCache.getCache(result.chunk.path);
		if (!cache) continue;

		collectFrontmatterTags(cache.frontmatter, result.score, tagScoreMap);
		collectCachedBodyTags(cache.tags, result.score, tagScoreMap);
		collectExtraFrontmatterTags(cache.frontmatter, result.score, tagScoreMap);
		collectPathTags(result.chunk.path, result.score, tagScoreMap);
	}

	// 3. 현재 활성 파일의 태그도 높은 우선순위로 포함
	if (activeFilePath) {
		const ownCache = metadataCache.getCache(activeFilePath);
		if (ownCache) {
			collectFrontmatterTags(ownCache.frontmatter, 0.95, tagScoreMap, true);
			if (ownCache.tags) {
				for (const t of ownCache.tags) {
					const tag = t.tag.startsWith('#') ? t.tag : '#' + t.tag;
					if (!tagScoreMap.has(tag)) {
						tagScoreMap.set(tag, 0.9);
					}
				}
			}
		}
	}

	return Array.from(tagScoreMap.entries())
		.map(([tag, score]) => ({ tag, score }))
		.sort((a, b) => b.score - a.score)
		.slice(0, 5);
}

function collectFrontmatterTags(
	frontmatter: Record<string, unknown> | undefined,
	baseScore: number,
	map: Map<string, number>,
	force: boolean = false
): void {
	if (!frontmatter?.tags) return;
	const fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
	for (const rawTag of fmTags) {
		const tagStr = typeof rawTag === 'string' ? rawTag : String(rawTag);
		if (!tagStr.trim()) continue;
		const tag = tagStr.startsWith('#') ? tagStr : '#' + tagStr;
		const existing = map.get(tag);
		map.set(tag, Math.max(existing || 0, force ? baseScore : baseScore * 0.7));
	}
}

function collectCachedBodyTags(
	tags: { tag: string }[] | undefined,
	baseScore: number,
	map: Map<string, number>
): void {
	if (!tags) return;
	for (const t of tags) {
		const tag = t.tag.startsWith('#') ? t.tag : '#' + t.tag;
		if (!map.has(tag)) {
			map.set(tag, baseScore * 0.8);
		}
	}
}

function collectExtraFrontmatterTags(
	frontmatter: Record<string, unknown> | undefined,
	baseScore: number,
	map: Map<string, number>
): void {
	if (!frontmatter || frontmatter.tags) return; // tags가 있으면 중복 방지
	
	const altKeys = ['tag', 'category', 'categories', 'type', 'types', 'topic', 'topics', 'keyword', 'keywords'];
	for (const key of altKeys) {
		const val = frontmatter[key];
		if (typeof val === 'string' && val.trim()) {
			const tag = '#' + val.trim().replace(/\s+/g, '-');
			const existing = map.get(tag);
			map.set(tag, Math.max(existing || 0, baseScore * 0.5));
		} else if (Array.isArray(val)) {
			for (const item of val) {
				if (typeof item === 'string' && item.trim()) {
					const tag = '#' + item.trim().replace(/\s+/g, '-');
					const existing = map.get(tag);
					map.set(tag, Math.max(existing || 0, baseScore * 0.5));
				}
			}
		}
	}
}

function collectPathTags(
	path: string,
	baseScore: number,
	map: Map<string, number>
): void {
	const pathParts = path.replace(/\.md$/, '').split('/');
	for (const part of pathParts) {
		const cleanPart = part.trim().replace(/\s+/g, '-');
		if (cleanPart.length >= 2 && cleanPart.length <= 30) {
			const tag = '#' + cleanPart;
			if (!map.has(tag)) {
				map.set(tag, baseScore * 0.35);
			}
		}
	}
}