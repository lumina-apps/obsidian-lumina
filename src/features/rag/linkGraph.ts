/**
 * Obsidian 위키링크(정방향 링크 + 백링크) 기반 1-Hop 그래프 이웃 탐색 유틸리티.
 * 별도 LLM 호출 없이 metadataCache.resolvedLinks만을 사용해 멀티홉 문맥 후보를 추출합니다.
 */

import { type App, normalizePath } from 'obsidian';

export interface LinkedNeighbor {
	/** 이웃 노트 경로 */
	path: string;
	/** 연결 출발지(Seed) 노트 경로 */
	linkedFrom: string;
	/** 연결 강도 가중치 (양방향 보너스 및 허브 노드 감쇠 반영, 0~1.2) */
	weight: number;
}

export interface LinkExpansionOptions {
	/** Seed 노트당 최대 탐색 이웃 수 (기본: 5) */
	maxNeighborsPerSeed?: number;
	/** 전체 반환 이웃 최대 수 (기본: 12) */
	maxTotalNeighbors?: number;
	/** 허용 경로 집합 (필터링 적용 시 사용) */
	allowedPathSet?: ReadonlySet<string> | null;
	/** 제외 경로 집합 (이미 결과에 포함된 경로 등) */
	excludePathSet?: ReadonlySet<string>;
}

/**
 * Seed 노트 집합과 직접 연결된(1-hop outlink + backlink) 이웃 노트 목록을 반환합니다.
 * 허브 노트(MOC 등 과도한 연결 수)의 노이즈를 줄이기 위해 degree 기반 감쇠를 적용합니다.
 */
export function getOneHopLinkedNeighbors(
	app: App | undefined,
	seedPaths: readonly string[],
	options?: LinkExpansionOptions,
): LinkedNeighbor[] {
	const resolvedLinks = app?.metadataCache?.resolvedLinks;
	if (!resolvedLinks || typeof resolvedLinks !== 'object' || seedPaths.length === 0) {
		return [];
	}

	const maxNeighborsPerSeed = options?.maxNeighborsPerSeed ?? 5;
	const maxTotalNeighbors = options?.maxTotalNeighbors ?? 12;
	const allowedPathSet = options?.allowedPathSet ?? null;
	const excludePathSet = options?.excludePathSet;

	const normalizedSeeds = Array.from(new Set(seedPaths.map(p => normalizePath(p))));
	const seedSet = new Set(normalizedSeeds);

	// 정방향/역방향 인접 맵 집계
	const outlinksMap = new Map<string, Set<string>>();
	const inlinksMap = new Map<string, Set<string>>();

	for (const [srcRaw, targets] of Object.entries(resolvedLinks)) {
		if (!targets || typeof targets !== 'object') continue;
		const src = normalizePath(srcRaw);

		for (const [tgtRaw, count] of Object.entries(targets)) {
			if (typeof count !== 'number' || count <= 0) continue;
			const tgt = normalizePath(tgtRaw);
			if (src === tgt) continue;

			let outs = outlinksMap.get(src);
			if (!outs) {
				outs = new Set<string>();
				outlinksMap.set(src, outs);
			}
			outs.add(tgt);

			let ins = inlinksMap.get(tgt);
			if (!ins) {
				ins = new Set<string>();
				inlinksMap.set(tgt, ins);
			}
			ins.add(src);
		}
	}

	const bestByNeighbor = new Map<string, LinkedNeighbor>();

	for (const seed of normalizedSeeds) {
		const outs = outlinksMap.get(seed) ?? new Set<string>();
		const ins = inlinksMap.get(seed) ?? new Set<string>();

		const candidateSet = new Set<string>([...outs, ...ins]);
		const seedCandidates: LinkedNeighbor[] = [];

		for (const neighbor of candidateSet) {
			if (seedSet.has(neighbor)) continue;
			if (excludePathSet?.has(neighbor)) continue;
			if (allowedPathSet && !allowedPathSet.has(neighbor)) continue;

			const isBidirectional = outs.has(neighbor) && ins.has(neighbor);
			const baseWeight = isBidirectional ? 1.2 : 1.0;
			// 양방향 링크가 차수를 중복 증가시키지 않도록 고유 이웃 수 기준으로 감쇠 계산
			const uniqueNeighbors = new Set<string>([
				...(outlinksMap.get(neighbor) ?? []),
				...(inlinksMap.get(neighbor) ?? []),
			]);
			const degree = Math.max(1, uniqueNeighbors.size);
			// 차수가 높은 허브 노트에 의한 노이즈 확산 완화
			const decayedWeight = baseWeight / Math.sqrt(degree);

			seedCandidates.push({
				path: neighbor,
				linkedFrom: seed,
				weight: Number(decayedWeight.toFixed(4)),
			});
		}

		seedCandidates.sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path));
		for (const item of seedCandidates.slice(0, maxNeighborsPerSeed)) {
			const existing = bestByNeighbor.get(item.path);
			if (!existing || item.weight > existing.weight) {
				bestByNeighbor.set(item.path, item);
			}
		}
	}

	return Array.from(bestByNeighbor.values())
		.sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path))
		.slice(0, maxTotalNeighbors);
}
