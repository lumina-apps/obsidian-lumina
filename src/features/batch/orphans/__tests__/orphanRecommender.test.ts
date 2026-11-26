import { describe, it, expect, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import type LuminaPlugin from '../../../../main';
import { recommendLinksForOrphan } from '../orphanRecommender';

function makeFile(path: string): TFile {
	const name = path.split('/').pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.md$/i, ''),
		extension: 'md',
		stat: { ctime: 0, mtime: 0, size: 100 },
	});
}

describe('orphanRecommender', () => {
	it('RAG 임베딩이 있을 때 코사인 유사도 순으로 추천하고 제외 경로를 걸러낸다', async () => {
		const orphan = makeFile('Inbox/idea.md');
		const closeHub = makeFile('Projects/roadmap.md');
		const farNote = makeFile('Cooking/pasta.md');
		const excludedNote = makeFile('backups/old.md');

		const app = {
			vault: {
				getMarkdownFiles: () => [orphan, closeHub, farNote, excludedNote],
			},
			metadataCache: {
				resolvedLinks: {
					'Notes/a.md': { 'Projects/roadmap.md': 1 },
					'Notes/b.md': { 'Projects/roadmap.md': 1 },
				},
				getFileCache: () => null,
			},
		} as unknown as App;

		const plugin = {
			indexer: {
				indexedChildChunks: [
					{ id: '1', parentId: 'p1', path: 'Inbox/idea.md', text: '', chunkIndex: 0, embedding: [1, 0] },
					{ id: '2', parentId: 'p2', path: 'Projects/roadmap.md', text: '', chunkIndex: 0, embedding: [0.95, 0.31] },
					{ id: '3', parentId: 'p3', path: 'Cooking/pasta.md', text: '', chunkIndex: 0, embedding: [0, 1] },
					{ id: '4', parentId: 'p4', path: 'backups/old.md', text: '', chunkIndex: 0, embedding: [1, 0] },
				],
				indexedParentChunks: [
					{ id: 'p2', path: 'Projects/roadmap.md', text: '로드맵 핵심 정리 문서', chunkIndex: 0 },
				],
			},
		} as unknown as LuminaPlugin;

		const suggestions = await recommendLinksForOrphan(app, plugin, orphan, { topK: 5 });
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].path).toBe('Projects/roadmap.md');
		expect(suggestions[0].reason).toBe('rag');
		expect(suggestions[0].backlinkCount).toBe(2);
		expect(suggestions[0].snippet).toContain('로드맵 핵심 정리 문서');
	});

	it('RAG 미사용 시 제목 토큰·태그·폴더 기반 메타데이터 폴백으로 추천한다', async () => {
		const orphan = makeFile('Projects/sprint-retrospective.md');
		const related = makeFile('Projects/sprint-planning.md');
		const unrelated = makeFile('Misc/diary.md');

		const app = {
			vault: {
				getMarkdownFiles: () => [orphan, related, unrelated],
				read: vi.fn(async () => '스프린트 회고 및 다음 스프린트 계획'),
			},
			metadataCache: {
				resolvedLinks: {},
				getFileCache: (f: TFile) => {
					if (f.path === orphan.path || f.path === related.path) {
						return { frontmatter: { tags: ['agile'] } };
					}
					return { frontmatter: {} };
				},
			},
		} as unknown as App;

		const plugin = { indexer: null } as unknown as LuminaPlugin;
		const suggestions = await recommendLinksForOrphan(app, plugin, orphan);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].path).toBe('Projects/sprint-planning.md');
		expect(suggestions[0].reason).toBe('metadata');
	});
});
