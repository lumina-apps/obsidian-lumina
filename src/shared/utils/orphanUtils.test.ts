import { describe, it, expect } from 'vitest';
import { TFile, type App } from 'obsidian';
import {
	MS_PER_DAY,
	buildVaultLinkCounts,
	countOrphanNotesFast,
	hasAnyIgnoredTag,
	isOrphanByCounts,
	matchesAnyFolderPrefix,
} from './orphanUtils';

function makeFile(path: string, mtime = 0, size = 100): TFile {
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

function makeMockApp(
	files: TFile[],
	resolvedLinks: Record<string, Record<string, number>>,
	cacheMap: Record<string, { frontmatter?: Record<string, unknown>; tags?: { tag: string }[] }> = {},
): App {
	return {
		vault: {
			getMarkdownFiles: () => files,
		},
		metadataCache: {
			resolvedLinks,
			getFileCache: (file: TFile) => cacheMap[file.path] ?? null,
		},
	} as unknown as App;
}

describe('orphanUtils', () => {
	it('buildVaultLinkCounts는 자기 참조를 제외하고 인링크·아웃링크 수를 정확히 집계한다', () => {
		const app = makeMockApp([], {
			'a.md': { 'b.md': 2, 'a.md': 1 },
			'c.md': { 'b.md': 1 },
		});

		const { inlinks, outlinks } = buildVaultLinkCounts(app);
		expect(inlinks.get('a.md')).toBeUndefined();
		expect(outlinks.get('a.md')).toBe(2);
		expect(inlinks.get('b.md')).toBe(3);
		expect(outlinks.get('c.md')).toBe(1);
	});

	it('isOrphanByCounts는 isolated와 no-backlinks 모드를 구분해 판별한다', () => {
		expect(isOrphanByCounts(0, 0, 'isolated')).toBe(true);
		expect(isOrphanByCounts(0, 2, 'isolated')).toBe(false);
		expect(isOrphanByCounts(0, 2, 'no-backlinks')).toBe(true);
		expect(isOrphanByCounts(1, 0, 'no-backlinks')).toBe(false);
	});

	it('matchesAnyFolderPrefix와 hasAnyIgnoredTag는 하위 경로와 하위 태그를 포함해 일치시킨다', () => {
		expect(matchesAnyFolderPrefix('Archive/2026/note.md', ['Archive'])).toBe(true);
		expect(matchesAnyFolderPrefix('Archive2/note.md', ['Archive'])).toBe(false);

		const file = makeFile('note.md');
		const app = makeMockApp([file], {}, {
			'note.md': {
				frontmatter: { tags: ['moc/project'] },
				tags: [{ tag: '#Draft' }],
			},
		});

		expect(hasAnyIgnoredTag(app, file, ['#moc'])).toBe(true);
		expect(hasAnyIgnoredTag(app, file, ['draft'])).toBe(true);
		expect(hasAnyIgnoredTag(app, file, ['other'])).toBe(false);
	});

	it('countOrphanNotesFast는 보호 기간·제외 경로·무시 목록·링크를 반영해 고아노트 개수를 계산한다', () => {
		const now = 30 * MS_PER_DAY;
		const oldTime = 5 * MS_PER_DAY;
		const recentTime = 28 * MS_PER_DAY;

		const files = [
			makeFile('orphan.md', oldTime),
			makeFile('outOnly.md', oldTime),
			makeFile('linked.md', oldTime),
			makeFile('recent.md', recentTime),
			makeFile('ignored.md', oldTime),
			makeFile('templates/tpl.md', oldTime),
			makeFile('Archive/old.md', oldTime),
			makeFile('mocNote.md', oldTime),
		];

		const app = makeMockApp(
			files,
			{
				'outOnly.md': { 'linked.md': 1 },
			},
			{
				'mocNote.md': { frontmatter: { tags: ['moc'] } },
			},
		);

		const isolatedCount = countOrphanNotesFast(app, {
			mode: 'isolated',
			gracePeriodDays: 7,
			ignoredPaths: ['ignored.md'],
			ignoredFolders: ['Archive'],
			ignoredTags: ['moc'],
			nowMs: now,
		});
		expect(isolatedCount).toBe(1);

		const noBacklinkCount = countOrphanNotesFast(app, {
			mode: 'no-backlinks',
			gracePeriodDays: 7,
			ignoredPaths: ['ignored.md'],
			ignoredFolders: ['Archive'],
			ignoredTags: ['moc'],
			nowMs: now,
		});
		expect(noBacklinkCount).toBe(2);
	});

	it('vault 또는 metadataCache가 모킹되지 않은 환경에서도 0을 안전하게 반환한다', () => {
		const emptyApp = {} as App;
		expect(countOrphanNotesFast(emptyApp)).toBe(0);
	});
});
