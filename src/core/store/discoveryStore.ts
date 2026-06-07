import { writable } from 'svelte/store';
import type { TFile } from 'obsidian';
import type { SearchResult } from '../../shared/types/rag.types';

export interface DiscoveryState {
	activeFile: TFile | null;
	similarNotes: SearchResult[];
	duplicateNote: SearchResult | null;
	recommendedTags: { tag: string; score: number }[];
	isSearching: boolean;
	lastSearchedFilePath: string | null;
	stagedItems: SearchResult[];
}

const INITIAL_STATE: DiscoveryState = {
	activeFile: null,
	similarNotes: [],
	duplicateNote: null,
	recommendedTags: [],
	isSearching: false,
	lastSearchedFilePath: null,
	stagedItems: [],
};

export const discoveryState = writable<DiscoveryState>({ ...INITIAL_STATE });

export function updateDiscoveryState(partial: Partial<DiscoveryState>): void {
	discoveryState.update(s => ({ ...s, ...partial }));
}

export function addToStaging(item: SearchResult): void {
	discoveryState.update(s => {
		// 중복 체크
		if (s.stagedItems.some(staged => staged.chunk.id === item.chunk.id)) {
			return s;
		}
		return { ...s, stagedItems: [...s.stagedItems, item] };
	});
}

export function removeFromStaging(chunkId: string): void {
	discoveryState.update(s => ({
		...s,
		stagedItems: s.stagedItems.filter(item => item.chunk.id !== chunkId)
	}));
}

export function clearStaging(): void {
	discoveryState.update(s => ({ ...s, stagedItems: [] }));
}
