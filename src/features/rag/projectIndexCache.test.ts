import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { projectIndexCache } from './projectIndexCache';
import type { VaultIndexer } from './indexer';

function createMockIndexer(): VaultIndexer {
	return {
		destroy: vi.fn(),
	} as unknown as VaultIndexer;
}

describe('ProjectIndexCache', () => {
	const origIsMobile = Platform.isMobile;

	beforeEach(() => {
		projectIndexCache.destroyAll();
	});

	afterEach(() => {
		vi.useRealTimers();
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
	});

	it('should store and retrieve indexers', () => {
		const indexer = createMockIndexer();
		projectIndexCache.set('p1', indexer);

		expect(projectIndexCache.has('p1')).toBe(true);
		expect(projectIndexCache.get('p1')).toBe(indexer);
	});

	it('should return undefined for non-existent project', () => {
		expect(projectIndexCache.get('non-existent')).toBeUndefined();
		expect(projectIndexCache.has('non-existent')).toBe(false);
	});

	it('should destroy and remove entry on delete', () => {
		const indexer = createMockIndexer();
		projectIndexCache.set('p1', indexer);
		projectIndexCache.delete('p1');

		expect(indexer.destroy).toHaveBeenCalled();
		expect(projectIndexCache.has('p1')).toBe(false);
	});

	it('should destroy all cached indexers on destroyAll', () => {
		const idx1 = createMockIndexer();
		const idx2 = createMockIndexer();
		projectIndexCache.set('p1', idx1);
		projectIndexCache.set('p2', idx2);

		projectIndexCache.destroyAll();

		expect(idx1.destroy).toHaveBeenCalled();
		expect(idx2.destroy).toHaveBeenCalled();
		expect(projectIndexCache.has('p1')).toBe(false);
		expect(projectIndexCache.has('p2')).toBe(false);
	});

	it('should evict oldest entry when capacity (5) is exceeded', () => {
		const indexers: Record<string, VaultIndexer> = {};
		for (let i = 1; i <= 6; i++) {
			indexers[`p${i}`] = createMockIndexer();
		}

		// Insert p1..p5 with ascending timestamps
		for (let i = 1; i <= 5; i++) {
			vi.setSystemTime(1000 + i * 100);
			projectIndexCache.set(`p${i}`, indexers[`p${i}`]);
		}

		// Insert p6 -> should evict p1 (oldest)
		vi.setSystemTime(2000);
		projectIndexCache.set('p6', indexers['p6']);

		expect(indexers['p1'].destroy).toHaveBeenCalled();
		expect(projectIndexCache.has('p1')).toBe(false);
		expect(projectIndexCache.has('p6')).toBe(true);
	});

	it('should protect activeProjectId from eviction', () => {
		const indexers: Record<string, VaultIndexer> = {};
		for (let i = 1; i <= 6; i++) {
			indexers[`p${i}`] = createMockIndexer();
		}

		// Insert p1..p5. p1 is oldest.
		for (let i = 1; i <= 5; i++) {
			vi.setSystemTime(1000 + i * 100);
			projectIndexCache.set(`p${i}`, indexers[`p${i}`]);
		}

		// Insert p6 while p1 is the active project.
		// Even though p1 is the oldest, p2 should be evicted instead of p1!
		vi.setSystemTime(2000);
		projectIndexCache.set('p6', indexers['p6'], 'p1');

		expect(indexers['p1'].destroy).not.toHaveBeenCalled();
		expect(indexers['p2'].destroy).toHaveBeenCalled();
		expect(projectIndexCache.has('p1')).toBe(true);
		expect(projectIndexCache.has('p2')).toBe(false);
		expect(projectIndexCache.has('p6')).toBe(true);
	});

	it('모바일 환경에서는 캐시 한도를 1개로 제한하여 두 번째 프로젝트 추가 시 기존 캐시를 해제한다', () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		vi.useFakeTimers();

		const idx1 = createMockIndexer();
		const idx2 = createMockIndexer();
		vi.setSystemTime(1000);
		projectIndexCache.set('p1', idx1);
		vi.setSystemTime(2000);
		projectIndexCache.set('p2', idx2, 'p2');

		expect(idx1.destroy).toHaveBeenCalledTimes(1);
		expect(idx2.destroy).not.toHaveBeenCalled();
		expect(projectIndexCache.has('p1')).toBe(false);
		expect(projectIndexCache.has('p2')).toBe(true);
	});
});

