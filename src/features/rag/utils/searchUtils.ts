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

/**
 * 임베딩 모델 특성과 사용자 설정을 반영하여 적응형 최소 코사인 유사도 임계값을 반환합니다.
 * 내장 Granite 모델은 기본 코사인 유사도 분포가 높은 편(0.55~0.85)이나,
 * OpenAI(text-embedding-3-*), Gemini, Nomic, BGE 등 외부 모델은 연관 문서도 0.30~0.55 구간에 분포합니다.
 */
export function getAdaptiveMinSimilarity(
	baseThreshold: number,
	modelName?: string,
	userMinSimilarity?: number,
): number {
	if (typeof userMinSimilarity === 'number' && userMinSimilarity > 0) {
		return userMinSimilarity;
	}
	if (!modelName) return baseThreshold;

	const lower = modelName.toLowerCase();
	const isDefaultGranite = lower.includes('granite-embedding');
	if (isDefaultGranite) {
		return baseThreshold;
	}

	// 커스텀/클라우드 임베딩 모델은 코사인 분포 스케일에 맞춰 임계값 보정
	return Math.max(0.25, Number((baseThreshold * 0.55).toFixed(2)));
}

/**
 * 문서의 여러 하위 청크 임베딩으로부터 L2 정규화된 대표 중심 벡터(Centroid)를 계산합니다.
 * 단일 첫 청크(200자)만 사용할 때 발생하는 제목/템플릿 편향을 방지합니다.
 */
export function computeCentroidEmbedding(
	chunks: ReadonlyArray<{ embedding?: number[] | Float32Array }>,
	maxSamples = 16,
): number[] | null {
	const valid = chunks.filter((c) => c.embedding && c.embedding.length > 0);
	if (valid.length === 0) return null;
	if (valid.length === 1) return Array.from(valid[0].embedding!);

	const dim = valid[0].embedding!.length;
	const sampled: typeof valid = [];
	if (valid.length <= maxSamples) {
		sampled.push(...valid);
	} else {
		const step = (valid.length - 1) / (maxSamples - 1);
		for (let i = 0; i < maxSamples; i++) {
			sampled.push(valid[Math.round(i * step)]);
		}
	}

	const sum = new Float64Array(dim);
	let count = 0;
	for (const c of sampled) {
		const emb = c.embedding!;
		if (emb.length !== dim) continue;
		for (let d = 0; d < dim; d++) {
			sum[d] += emb[d];
		}
		count++;
	}
	if (count === 0) return null;

	let normSq = 0;
	for (let d = 0; d < dim; d++) {
		sum[d] /= count;
		normSq += sum[d] * sum[d];
	}
	const norm = Math.sqrt(normSq);
	const result = new Array<number>(dim);
	if (norm > 0) {
		for (let d = 0; d < dim; d++) {
			result[d] = sum[d] / norm;
		}
	} else {
		for (let d = 0; d < dim; d++) {
			result[d] = sum[d];
		}
	}
	return result;
}
