/**
 * projectIndexCache.ts
 *
 * 프로젝트별 VaultIndexer 인스턴스를 캐싱하여 hot-swap을 지원합니다.
 * 프로젝트 전환 시 재인덱싱 없이 저장된 인덱서를 즉시 교체합니다.
 *
 * 메모리 관리: 캐시 상한(MAX_CACHED)을 초과하면 가장 오래된 항목 순서로 destroy.
 */

import type { VaultIndexer } from './indexer';

const MAX_CACHED = 5;

class ProjectIndexCache {
	private cache = new Map<string, { indexer: VaultIndexer; lastAccessed: number }>();

	/** 캐시에서 인덱서를 가져오고 lastAccessed를 갱신합니다 */
	get(projectId: string): VaultIndexer | undefined {
		const entry = this.cache.get(projectId);
		if (entry) {
			entry.lastAccessed = Date.now();
			return entry.indexer;
		}
		return undefined;
	}

	/** 인덱서를 캐시에 저장합니다. 상한 초과 시 가장 오래된 항목을 destroy합니다 */
	set(projectId: string, indexer: VaultIndexer): void {
		this.cache.set(projectId, { indexer, lastAccessed: Date.now() });
		this.evictIfNeeded();
	}

	/** 특정 프로젝트의 캐시를 제거하고 인덱서를 destroy합니다 */
	delete(projectId: string): void {
		const entry = this.cache.get(projectId);
		if (entry) {
			entry.indexer.destroy();
			this.cache.delete(projectId);
		}
	}

	/** 모든 캐시를 비우고 인덱서를 destroy합니다 (plugin.onunload용) */
	destroyAll(): void {
		for (const { indexer } of this.cache.values()) {
			indexer.destroy();
		}
		this.cache.clear();
	}

	/** 캐시 보유 여부 확인 */
	has(projectId: string): boolean {
		return this.cache.has(projectId);
	}

	private evictIfNeeded(): void {
		if (this.cache.size <= MAX_CACHED) return;

		// lastAccessed 기준 오름차순 정렬 → 가장 오래된 것 제거
		const sorted = [...this.cache.entries()].sort(
			(a, b) => a[1].lastAccessed - b[1].lastAccessed,
		);
		const [oldestId, oldestEntry] = sorted[0];
		oldestEntry.indexer.destroy();
		this.cache.delete(oldestId);
	}
}

/** 싱글턴 인덱스 캐시 */
export const projectIndexCache = new ProjectIndexCache();
