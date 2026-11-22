import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TFile } from 'obsidian';
import type { SearchResult } from '../../../shared/types/rag.types';

const searchVaultMock = vi.fn<(...args: unknown[]) => Promise<SearchResult[]>>();
vi.mock('../search', () => ({
	searchVault: (...args: unknown[]) => searchVaultMock(...args),
}));

import { buildContextFromActiveFile } from './discoveryContext';

// searchVault(query, parents, db, embedFn, topK, minSimilarity, ...)
const MIN_SIM_ARG = 5;

let fileCounter = 0;

function makePlugin(
	rag: { minSimilarity?: number; relatedNotesMinSimilarity?: number; duplicateThreshold?: number },
	modelId = 'text-embedding-f2llm-v2-0.6b',
) {
	return {
		app: { metadataCache: { getCache: () => null } },
		settings: {
			rag: { parentChunkSize: 2000, ...rag },
			connections: {
				embedding: { mode: 'custom', modelId },
				providers: [],
			},
		},
		indexer: {
			projectId: 'p',
			indexedFileCount: 2,
			oramaDb: {},
			indexedParentChunks: [
				{ id: 'pa', path: 'active.md', text: 'x'.repeat(200) },
				{ id: 'pb', path: 'other.md', text: 'y'.repeat(200) },
			],
			indexedChildChunks: [
				{ id: 'ca', parentId: 'pa', path: 'active.md', text: 'x', chunkIndex: 0, embedding: [1, 0] },
			],
		},
	} as never;
}

function makeFile(): TFile {
	// 파일마다 mtime을 달리하여 모듈 수준 결과 캐시를 우회
	return { path: 'active.md', stat: { mtime: ++fileCounter } } as unknown as TFile;
}

describe('buildContextFromActiveFile - threshold settings', () => {
	beforeEach(() => {
		searchVaultMock.mockReset();
		searchVaultMock.mockResolvedValue([]);
	});

	it('uses the model-adaptive default when nothing is set', async () => {
		await buildContextFromActiveFile(makePlugin({ minSimilarity: 0, relatedNotesMinSimilarity: 0 }), makeFile(), '');
		expect(searchVaultMock.mock.calls[0][MIN_SIM_ARG]).toBe(0.3);
	});

	it('falls back to Min Similarity when the related-notes override is 0', async () => {
		await buildContextFromActiveFile(makePlugin({ minSimilarity: 0.5, relatedNotesMinSimilarity: 0 }), makeFile(), '');
		expect(searchVaultMock.mock.calls[0][MIN_SIM_ARG]).toBe(0.5);
	});

	it('prefers the related-notes override over Min Similarity', async () => {
		await buildContextFromActiveFile(makePlugin({ minSimilarity: 0.5, relatedNotesMinSimilarity: 0.4 }), makeFile(), '');
		expect(searchVaultMock.mock.calls[0][MIN_SIM_ARG]).toBe(0.4);
	});

	it('applies the duplicate threshold override', async () => {
		const hit = (score: number) => ({
			chunk: { id: 'pb', path: 'other.md', text: 'y'.repeat(200) },
			score,
			vectorScore: score,
			rawVectorScore: score,
		}) as unknown as SearchResult;

		searchVaultMock.mockResolvedValue([hit(0.82)]);
		const auto = await buildContextFromActiveFile(makePlugin({ duplicateThreshold: 0 }), makeFile(), '');
		expect(auto.duplicateNote).toBeNull(); // 자동: 0.85

		searchVaultMock.mockResolvedValue([hit(0.82)]);
		const custom = await buildContextFromActiveFile(makePlugin({ duplicateThreshold: 0.8 }), makeFile(), '');
		expect(custom.duplicateNote?.chunk.path).toBe('other.md');
	});

	it('invalidates the context cache for the same file when thresholds change', async () => {
		const hit = (score: number) => ({
			chunk: { id: 'pb', path: 'other.md', text: 'y'.repeat(200) },
			score,
			vectorScore: score,
			rawVectorScore: score,
		}) as unknown as SearchResult;

		const sameFile = makeFile();
		searchVaultMock.mockResolvedValue([hit(0.82)]);

		const first = await buildContextFromActiveFile(
			makePlugin({ relatedNotesMinSimilarity: 0.3, duplicateThreshold: 0 }),
			sameFile,
			'',
		);
		expect(first.duplicateNote).toBeNull();
		expect(searchVaultMock).toHaveBeenCalledTimes(1);

		// 동일 파일(동일 mtime)에서 캐시 히트
		await buildContextFromActiveFile(
			makePlugin({ relatedNotesMinSimilarity: 0.3, duplicateThreshold: 0 }),
			sameFile,
			'',
		);
		expect(searchVaultMock).toHaveBeenCalledTimes(1);

		// 임계값 변경 시 캐시 미스되어 재검색 및 중복 판정 반영
		const second = await buildContextFromActiveFile(
			makePlugin({ relatedNotesMinSimilarity: 0.3, duplicateThreshold: 0.8 }),
			sameFile,
			'',
		);
		expect(searchVaultMock).toHaveBeenCalledTimes(2);
		expect(second.duplicateNote?.chunk.path).toBe('other.md');
	});
});
