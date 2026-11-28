import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { getOneHopLinkedNeighbors } from './linkGraph';

function makeMockApp(resolvedLinks: Record<string, Record<string, number>>): App {
	return {
		metadataCache: {
			resolvedLinks,
		},
	} as unknown as App;
}

describe('linkGraph - getOneHopLinkedNeighbors', () => {
	it('resolvedLinks가 없거나 seedPaths가 비어 있으면 빈 배열을 반환한다', () => {
		expect(getOneHopLinkedNeighbors(undefined, ['a.md'])).toEqual([]);
		expect(getOneHopLinkedNeighbors(makeMockApp({}), [])).toEqual([]);
	});

	it('정방향 링크(outlink)와 역방향 링크(backlink)를 모두 1-hop 이웃으로 수집한다', () => {
		const app = makeMockApp({
			'notes/seed.md': { 'notes/out.md': 1, 'notes/seed.md': 2 },
			'notes/back.md': { 'notes/seed.md': 1 },
			'notes/twohop.md': { 'notes/out.md': 1 },
		});

		const neighbors = getOneHopLinkedNeighbors(app, ['notes/seed.md']);
		const paths = neighbors.map(n => n.path);

		expect(paths).toContain('notes/out.md');
		expect(paths).toContain('notes/back.md');
		expect(paths).not.toContain('notes/seed.md'); // 자기참조 제외
		expect(paths).not.toContain('notes/twohop.md'); // 2-hop 제외
	});

	it('양방향 링크 이웃이 단방향 링크보다 높은 가중치를 가진다', () => {
		const app = makeMockApp({
			'seed.md': { 'bi.md': 1, 'uni.md': 1 },
			'bi.md': { 'seed.md': 1 },
		});

		const neighbors = getOneHopLinkedNeighbors(app, ['seed.md']);
		const bi = neighbors.find(n => n.path === 'bi.md');
		const uni = neighbors.find(n => n.path === 'uni.md');
		expect(bi).toBeDefined();
		expect(uni).toBeDefined();
		expect(bi!.weight).toBeGreaterThan(uni!.weight);
	});

	it('허브 노드(연결 수 많음)는 감쇠되고 allowedPathSet 및 maxTotalNeighbors를 준수한다', () => {
		const hubTargets: Record<string, number> = {};
		for (let i = 0; i < 16; i++) {
			hubTargets[`other_${i}.md`] = 1;
		}
		const app = makeMockApp({
			'seed.md': { 'focused.md': 1, 'hub.md': 1, 'blocked.md': 1 },
			'hub.md': hubTargets,
		});

		const allowedPathSet = new Set(['seed.md', 'focused.md', 'hub.md']);
		const neighbors = getOneHopLinkedNeighbors(app, ['seed.md'], {
			allowedPathSet,
			maxTotalNeighbors: 2,
		});

		expect(neighbors.some(n => n.path === 'blocked.md')).toBe(false);
		expect(neighbors[0].path).toBe('focused.md');
		expect(neighbors.length).toBeLessThanOrEqual(2);
	});
});
