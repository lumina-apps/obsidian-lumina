import { writable } from 'svelte/store';
import type { TFile } from 'obsidian';
import type { SearchResult } from '../../shared/types/rag.types';

export interface StagedNote {
	path: string;
	name: string;
	tokens: number;
}

export interface DiscoveryState {
	activeFile: TFile | null;
	similarNotes: SearchResult[];
	duplicateNote: SearchResult | null;
	recommendedTags: { tag: string; score: number }[];
	isSearching: boolean;
	lastSearchedFilePath: string | null;
	stagedItems: StagedNote[];
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

export function addToStaging(item: StagedNote): void {
	discoveryState.update(s => {
		// 파일 경로(path) 기준 중복 체크
		if (s.stagedItems.some(staged => staged.path === item.path)) {
			return s;
		}
		return { ...s, stagedItems: [...s.stagedItems, item] };
	});
}

export function removeFromStaging(path: string): void {
	discoveryState.update(s => ({
		...s,
		stagedItems: s.stagedItems.filter(item => item.path !== path)
	}));
}

export function clearStaging(): void {
	discoveryState.update(s => ({ ...s, stagedItems: [] }));
}
