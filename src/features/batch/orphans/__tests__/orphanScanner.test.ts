import { describe, it, expect, beforeEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import type { OrphanFilterConfig } from '../../../../shared/types/orphan.types';
import { MS_PER_DAY } from '../../../../shared/utils/orphanUtils';
import { clearCanvasRefCache, scanOrphanNotes } from '../orphanScanner';

function makeMdFile(path: string, mtime = 0, size = 120): TFile {
	const name = path.split('/').pop() ?? path;
	const basename = name.replace(/\.md$/i, '');
	return Object.assign(new TFile(), {
		path,
		name,
		basename,
		extension: 'md',
		stat: { ctime: mtime, mtime, size },
	});
}

function makeCanvasFile(path: string, mtime = 100): TFile {
	const name = path.split('/').pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.canvas$/i, ''),
		extension: 'canvas',
		stat: { ctime: mtime, mtime, size: 200 },
	});
}

const BASE_CONFIG: OrphanFilterConfig = {
	mode: 'isolated',
	gracePeriodDays: 7,
	includeCanvasRefs: true,
	emptyOnly: false,
	folderFilter: '',
	searchQuery: '',
	showIgnored: false,
	sortBy: 'mtime-desc',
	ignoredPaths: [],
	ignoredFolders: [],
	ignoredTags: [],
	excludedPaths: [],
};

describe('orphanScanner', () => {
	beforeEach(() => {
		clearCanvasRefCache();
	});

	it('Canvas 참조 제외, 빈 노트 판별, 무시 목록 토글, 정렬이 정확히 동작한다', async () => {
		const now = 40 * MS_PER_DAY;
		const old1 = 10 * MS_PER_DAY;
		const old2 = 20 * MS_PER_DAY;

		const mdFiles = [
			makeMdFile('Inbox/empty.md', old1, 0),
			makeMdFile('Inbox/yamlOnly.md', old2, 40),
			makeMdFile('Notes/canvasLinked.md', old1, 300),
			makeMdFile('Notes/realOrphan.md', old2, 500),
			makeMdFile('Notes/ignored.md', old1, 300),
		];
		const canvasFile = makeCanvasFile('Board.canvas', 100);
		const canvasText = JSON.stringify({
			nodes: [{ id: '1', type: 'file', file: 'Notes/canvasLinked.md' }],
		});

		const app = {
			vault: {
				getMarkdownFiles: () => mdFiles,
				getFiles: () => [...mdFiles, canvasFile],
				cachedRead: async () => canvasText,
				read: async () => canvasText,
			},
			metadataCache: {
				resolvedLinks: {},
				getFileCache: (file: TFile) => {
					if (file.path === 'Inbox/yamlOnly.md') {
						return { sections: [{ type: 'yaml' }] };
					}
					return { sections: [{ type: 'paragraph' }] };
				},
			},
		} as unknown as App;

		// 1. Canvas 참조 포함 시 canvasLinked는 제외되고, 무시 항목 제외한 3개 반환
		const res = await scanOrphanNotes(
			app,
			{ ...BASE_CONFIG, ignoredPaths: ['Notes/ignored.md'] },
			now,
		);
		expect(res.totalMarkdown).toBe(5);
		expect(res.ignoredCount).toBe(1);
		expect(res.items.map((i) => i.path)).toEqual([
			'Inbox/yamlOnly.md',
			'Notes/realOrphan.md',
			'Inbox/empty.md',
		]);

		// 2. emptyOnly=true면 empty와 yamlOnly만 반환
		const emptyRes = await scanOrphanNotes(
			app,
			{ ...BASE_CONFIG, emptyOnly: true, sortBy: 'name-asc' },
			now,
		);
		expect(emptyRes.items.map((i) => i.path)).toEqual([
			'Inbox/empty.md',
			'Inbox/yamlOnly.md',
		]);

		// 3. includeCanvasRefs=false면 canvasLinked도 고아로 포함됨
		const noCanvasRes = await scanOrphanNotes(
			app,
			{ ...BASE_CONFIG, includeCanvasRefs: false, ignoredPaths: ['Notes/ignored.md'] },
			now,
		);
		expect(noCanvasRes.items.some((i) => i.path === 'Notes/canvasLinked.md')).toBe(true);
	});
});
