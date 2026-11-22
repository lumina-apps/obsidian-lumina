import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { writable } from 'svelte/store';
import type { SearchResult } from '../../../shared/types/rag.types';

const mockSearchVault = vi.fn();

vi.mock('../search', () => ({
	searchVault: (...args: unknown[]) => mockSearchVault(...args),
}));

vi.mock('../../../core/store/discoveryStore', () => {
	const state = writable({
		activeFile: null,
		isSearching: false,
		similarNotes: [],
		duplicateNote: null,
		recommendedTags: [],
		lastSearchedFilePath: null,
		stagedItems: [],
	});
	return {
		discoveryState: state,
		updateDiscoveryState: (partial: Record<string, unknown>) =>
			state.update((prev) => ({ ...prev, ...partial })),
		addToStaging: vi.fn(),
		removeFromStaging: vi.fn(),
		clearStaging: vi.fn(),
	};
});

vi.mock('../../../core/store/settingsStore', () => ({
	isRagEnabled: writable(true),
	settingsStore: writable({ chat: {} }),
}));

vi.mock('../../../core/store/ragStore', () => ({
	indexingState: writable({ status: 'ready', progress: 100, errorMessage: null }),
	showIndexingIndicator: writable(false),
}));

vi.mock('../../../core/store/chatStore', () => ({
	addPendingAttachment: vi.fn(),
	activeSidebarTab: writable('discovery'),
	sessionModelId: writable(null),
	sessionProviderId: writable(null),
}));

vi.mock('../../../shared/locales/index', () => ({
	tStore: writable((key: string) => key),
}));

vi.mock('../../../shared/debugLogger', () => ({
	debugLogger: { logError: vi.fn(), logDebug: vi.fn() },
}));

vi.mock('../utils/discoveryContext', () => ({
	buildContextFromActiveFile: vi.fn().mockResolvedValue({
		similarNotes: [],
		duplicateNote: null,
		recommendedTags: [],
	}),
	applyContextResult: vi.fn(),
}));

import DiscoveryPanel from './DiscoveryPanel.svelte';
import type LuminaPlugin from '../../../main';
import { discoveryState } from '../../../core/store/discoveryStore';
import { settingsStore } from '../../../core/store/settingsStore';
import { buildContextFromActiveFile } from '../utils/discoveryContext';
import type { TFile } from 'obsidian';
import type { LuminaSettings } from '../../../core/settings/settings.types';

function createMockPlugin(): LuminaPlugin {
	return {
		app: {
			workspace: {
				getActiveFile: vi.fn(() => null),
				openLinkText: vi.fn(),
			},
			metadataCache: {
				getCache: vi.fn(() => null),
			},
		},
		settings: {
			connections: {
				providers: [],
				embedding: { mode: 'auto', providerId: '', modelId: '' },
			},
			projects: { list: [], activeProjectId: 'default' },
			rag: { minSimilarity: 0.0 },
			chat: {},
		},
		indexer: {
			indexedParentChunks: [
				{
					id: 'chunk-1',
					path: 'notes/world.md',
					text: '세계관 설명 노트',
					chunkIndex: 0,
				},
			],
			oramaDb: {},
			embed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
		},
	} as unknown as LuminaPlugin;
}

describe('DiscoveryPanel 검색 빈 상태 및 오류 처리', () => {
	let target: HTMLDivElement;
	let comp: Record<string, unknown> | null = null;

	beforeEach(() => {
		vi.useFakeTimers();
		mockSearchVault.mockReset();
		vi.mocked(buildContextFromActiveFile).mockClear();
		discoveryState.set({
			activeFile: null,
			isSearching: false,
			similarNotes: [],
			duplicateNote: null,
			recommendedTags: [],
			lastSearchedFilePath: null,
			stagedItems: [],
		});
		settingsStore.set({ chat: {} } as unknown as LuminaSettings);
		target = document.createElement('div');
		document.body.appendChild(target);
	});

	afterEach(() => {
		if (comp) {
			unmount(comp);
			comp = null;
		}
		target.remove();
		vi.useRealTimers();
	});

	it('검색 결과가 0건이면 빈 결과 안내 UI를 렌더링한다', async () => {
		mockSearchVault.mockResolvedValue([]);
		comp = mount(DiscoveryPanel, {
			target,
			props: { plugin: createMockPlugin(), isActive: true },
		});

		const inputs = target.querySelectorAll<HTMLInputElement>('.lumina-discovery__search-input');
		expect(inputs.length).toBeGreaterThanOrEqual(1);

		inputs[0].value = '@@@@NOT_FOUND_QUERY@@@@';
		inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		await vi.advanceTimersByTimeAsync(500);
		flushSync();

		expect(target.querySelectorAll('.lumina-discovery__card')).toHaveLength(0);
		expect(target.querySelector('.lumina-discovery__empty')).not.toBeNull();
	});

	it('후속 검색이 실패하면 이전 검색 결과 카드를 남기지 않고 초기화한다', async () => {
		const sampleResults: SearchResult[] = [
			{
				chunk: {
					id: 'chunk-1',
					path: 'notes/world.md',
					text: '세계관 설명 노트',
					chunkIndex: 0,
				},
				score: 0.9,
				rawVectorScore: 0.85,
			},
		];
		mockSearchVault
			.mockResolvedValueOnce(sampleResults)
			.mockRejectedValueOnce(new Error('Request failed, status 429'));

		comp = mount(DiscoveryPanel, {
			target,
			props: { plugin: createMockPlugin(), isActive: true },
		});

		const inputs = target.querySelectorAll<HTMLInputElement>('.lumina-discovery__search-input');

		// 1차 검색 성공: 카드 1개 표시
		inputs[0].value = '세계관';
		inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await vi.advanceTimersByTimeAsync(500);
		flushSync();
		expect(target.querySelectorAll('.lumina-discovery__card')).toHaveLength(1);

		// 2차 검색 실패(429): 이전 카드가 초기화되고 빈 상태 UI가 표시되어야 함
		inputs[0].value = '새검색어';
		inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await vi.advanceTimersByTimeAsync(500);
		flushSync();

		expect(target.querySelectorAll('.lumina-discovery__card')).toHaveLength(0);
		expect(target.querySelector('.lumina-discovery__empty')).not.toBeNull();
	});

	it('임계값 설정이 변경되면 동일 노트에 대해서도 연관 노트 컨텍스트를 즉시 재조회한다', async () => {
		const activeFile = { path: 'notes/active.md', extension: 'md', stat: { mtime: 100 } } as unknown as TFile;
		discoveryState.set({
			activeFile,
			isSearching: false,
			similarNotes: [],
			duplicateNote: null,
			recommendedTags: [],
			lastSearchedFilePath: null,
			stagedItems: [],
		});
		settingsStore.set({
			chat: {},
			rag: { minSimilarity: 0, relatedNotesMinSimilarity: 0, duplicateThreshold: 0 },
		} as unknown as LuminaSettings);

		comp = mount(DiscoveryPanel, {
			target,
			props: { plugin: createMockPlugin(), isActive: true },
		});
		flushSync();

		await vi.advanceTimersByTimeAsync(700);
		flushSync();
		expect(buildContextFromActiveFile).toHaveBeenCalledTimes(1);

		// 동일 파일/동일 mtime 상태에서 설정 스토어의 임계값 변경
		settingsStore.set({
			chat: {},
			rag: { minSimilarity: 0, relatedNotesMinSimilarity: 0.45, duplicateThreshold: 0.8 },
		} as unknown as LuminaSettings);
		flushSync();

		await vi.advanceTimersByTimeAsync(700);
		flushSync();
		expect(buildContextFromActiveFile).toHaveBeenCalledTimes(2);
	});
});
