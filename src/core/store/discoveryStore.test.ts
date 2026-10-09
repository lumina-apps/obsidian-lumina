import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	discoveryState,
	addToStaging,
	removeFromStaging,
	clearStaging,
	updateDiscoveryState
} from './discoveryStore';

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
});
