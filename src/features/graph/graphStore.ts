import { writable } from 'svelte/store';

export interface GraphViewState {
	mode: 'local' | 'global';
	minSimilarity: number;
	maxK: number;
	searchQuery: string;
	localDepth: number;
	highlightedPaths: Set<string>;
	focusedPath: string | null;
	isCalculating: boolean;
	errorMessage: string | null;
}

export const graphState = writable<GraphViewState>({
	mode: 'local',
	minSimilarity: 0.65,
	maxK: 5,
	searchQuery: '',
	localDepth: 2,
	highlightedPaths: new Set(),
	focusedPath: null,
	isCalculating: false,
	errorMessage: null,
});

export function updateGraphState(partial: Partial<GraphViewState>) {
	graphState.update(s => ({ ...s, ...partial }));
}
