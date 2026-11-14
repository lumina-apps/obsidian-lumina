import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	discoveryState,
	addToStaging,
	removeFromStaging,
	clearStaging,
	resetDiscoveryState,
	updateDiscoveryState
} from './discoveryStore';
import type { TFile } from 'obsidian';

describe('discoveryStore', () => {
	beforeEach(() => {
		clearStaging();
		updateDiscoveryState({
			activeFile: null,
			similarNotes: [],
			duplicateNote: null,
			recommendedTags: [],
			isSearching: false,
			lastSearchedFilePath: null,
		});
	});

	it('파일 경로 기준으로 중복 없이 스테이징에 추가된다', () => {
		addToStaging({ path: 'notes/a.md', name: 'a', tokens: 100 });
		addToStaging({ path: 'notes/a.md', name: 'a-duplicate', tokens: 120 });
		addToStaging({ path: 'notes/b.md', name: 'b', tokens: 200 });

		const state = get(discoveryState);
		expect(state.stagedItems).toHaveLength(2);
		expect(state.stagedItems[0]).toEqual({ path: 'notes/a.md', name: 'a', tokens: 100 });
		expect(state.stagedItems[1]).toEqual({ path: 'notes/b.md', name: 'b', tokens: 200 });
	});

	it('파일 경로 기준으로 특정 항목을 스테이징에서 제거한다', () => {
		addToStaging({ path: 'notes/a.md', name: 'a', tokens: 100 });
		addToStaging({ path: 'notes/b.md', name: 'b', tokens: 200 });

		removeFromStaging('notes/a.md');

		const state = get(discoveryState);
		expect(state.stagedItems).toHaveLength(1);
		expect(state.stagedItems[0].path).toBe('notes/b.md');
	});

	it('clearStaging 호출 시 모든 항목이 초기화된다', () => {
		addToStaging({ path: 'notes/a.md', name: 'a', tokens: 100 });
		clearStaging();

		const state = get(discoveryState);
		expect(state.stagedItems).toEqual([]);
	});

	it('resetDiscoveryState 호출 시 activeFile은 유지하고 검색 결과 및 스테이징 항목을 초기화한다', () => {
		const mockFile = { path: 'notes/active.md', name: 'active.md' } as unknown as TFile;
		updateDiscoveryState({
			activeFile: mockFile,
			similarNotes: [{ chunk: { id: 'c1', path: 'notes/sim.md', text: 'hi', chunkIndex: 0 }, score: 0.9 }],
			recommendedTags: [{ tag: 'ai', score: 0.8 }],
			isSearching: true,
			lastSearchedFilePath: 'notes/active.md',
		});
		addToStaging({ path: 'notes/a.md', name: 'a', tokens: 100 });

		resetDiscoveryState();

		const state = get(discoveryState);
		expect(state.activeFile).toBe(mockFile);
		expect(state.similarNotes).toEqual([]);
		expect(state.duplicateNote).toBeNull();
		expect(state.recommendedTags).toEqual([]);
		expect(state.isSearching).toBe(false);
		expect(state.lastSearchedFilePath).toBeNull();
		expect(state.stagedItems).toEqual([]);
	});
});
