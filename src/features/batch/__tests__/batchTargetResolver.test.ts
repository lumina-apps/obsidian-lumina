import { describe, it, expect } from 'vitest';
import { TFile, type App } from 'obsidian';
import {
	computeLineDiff,
	estimateBatchResources,
	resolveTargetFiles,
} from '../batchTargetResolver';
import type { BatchRecipeOptions, BatchScopeConfig } from '../../../shared/types/batch.types';

function makeFile(path: string, size = 200): TFile {
	const name = path.split('/').pop() ?? path;
	const basename = name.replace(/\.md$/i, '');
	return Object.assign(new TFile(), {
		path,
		name,
		basename,
		extension: 'md',
		stat: { ctime: 0, mtime: 0, size },
	});
}

function makeMockApp(
	files: TFile[],
	cacheMap: Record<string, { frontmatter?: Record<string, unknown>; tags?: { tag: string }[] }>,
): App {
	return {
		vault: {
			getMarkdownFiles: () => files,
			getAllLoadedFiles: () => files,
		},
		metadataCache: {
			getFileCache: (file: TFile) => cacheMap[file.path] ?? null,
		},
	} as unknown as App;
}

const DEFAULT_SCOPE: BatchScopeConfig = {
	scopeMode: 'vault',
	folderPath: '',
	tagFilter: '',
	skipIfAlreadyHasTarget: true,
	minContentLength: 50,
};

const DEFAULT_OPTIONS: BatchRecipeOptions = {
	fmMergeMode: 'empty-only',
	generateTags: true,
	generateDescription: true,
	calloutTitle: 'Summary',
	customPrompt: '',
	customOutputMode: 'frontmatter-key',
	customFrontmatterKey: 'ai_summary',
	providerId: '',
	modelId: '',
};

describe('batchTargetResolver', () => {
	it('폴더, 태그, 최소 글자 수, 시스템 제외 경로 및 스마트 스킵을 모두 정확히 필터링한다', () => {
		const files = [
			makeFile('Projects/a.md', 300),
			makeFile('Projects/b.md', 300),
			makeFile('Projects/short.md', 20),
			makeFile('Other/c.md', 300),
			makeFile('backups/old.md', 300),
		];
		const app = makeMockApp(files, {
			'Projects/a.md': { frontmatter: { tags: ['work'] } }, // description 없음 -> 대상 포함
			'Projects/b.md': {
				frontmatter: { tags: ['work'], description: '이미 요약 있음' },
			}, // empty-only 스마트 스킵으로 제외
			'Projects/short.md': { frontmatter: {} },
			'Other/c.md': { frontmatter: {} },
		});

		const res = resolveTargetFiles(
			app,
			{
				...DEFAULT_SCOPE,
				scopeMode: 'folder',
				folderPath: 'Projects',
				tagFilter: '#work',
			},
			'frontmatter',
			DEFAULT_OPTIONS,
		);

		expect(res.totalScanned).toBe(5);
		expect(res.matched.map((f) => f.path)).toEqual(['Projects/a.md']);
		expect(res.skippedCount).toBe(4);
	});

	it('overwrite 모드에서는 이미 속성이 채워진 노트도 건너뛰지 않는다', () => {
		const files = [makeFile('note.md', 250)];
		const app = makeMockApp(files, {
			'note.md': {
				frontmatter: { tags: ['existing'], description: 'existing desc' },
			},
		});

		const res = resolveTargetFiles(app, DEFAULT_SCOPE, 'frontmatter', {
			...DEFAULT_OPTIONS,
			fmMergeMode: 'overwrite',
		});

		expect(res.matched).toHaveLength(1);
		expect(res.skippedCount).toBe(0);
	});

	it('autolink 레시피는 예상 토큰을 0으로, LLM 레시피는 파일 크기 기반으로 추산한다', () => {
		const files = [makeFile('a.md', 600), makeFile('b.md', 1200)];

		const localEst = estimateBatchResources(files, 'autolink');
		expect(localEst.estimatedTokens).toBe(0);
		expect(localEst.estimatedSeconds).toBeGreaterThanOrEqual(1);

		const llmEst = estimateBatchResources(files, 'frontmatter', 'openai');
		expect(llmEst.estimatedTokens).toBeGreaterThan(500);
		expect(llmEst.estimatedSeconds).toBeGreaterThanOrEqual(2);
	});

	it('computeLineDiff는 추가·삭제·동일 라인을 정확히 분류한다', () => {
		const diff = computeLineDiff('line1\nline2\nline3\n', 'line1\nline2-edited\nline3\nline4\n');
		expect(diff).toEqual([
			{ type: 'same', text: 'line1' },
			{ type: 'removed', text: 'line2' },
			{ type: 'added', text: 'line2-edited' },
			{ type: 'same', text: 'line3' },
			{ type: 'added', text: 'line4' },
		]);
	});

	it('orphanFilter가 지정되면 해당 조건을 만족하는 고아노트만 필터링한다', () => {
		const files = [
			makeFile('orphan.md', 200),
			makeFile('outOnly.md', 200),
			makeFile('linked.md', 200),
		];
		const app = {
			vault: {
				getMarkdownFiles: () => files,
				getAllLoadedFiles: () => files,
			},
			metadataCache: {
				resolvedLinks: {
					'outOnly.md': { 'linked.md': 1 },
				},
				getFileCache: () => null,
			},
		} as unknown as App;

		const isolated = resolveTargetFiles(
			app,
			{ ...DEFAULT_SCOPE, orphanFilter: 'isolated' },
			'autolink',
			DEFAULT_OPTIONS,
		);
		expect(isolated.matched.map((f) => f.path)).toEqual(['orphan.md']);

		const noBacklinks = resolveTargetFiles(
			app,
			{ ...DEFAULT_SCOPE, orphanFilter: 'no-backlinks' },
			'autolink',
			DEFAULT_OPTIONS,
		);
		expect(noBacklinks.matched.map((f) => f.path)).toEqual(['orphan.md', 'outOnly.md']);
	});
});
