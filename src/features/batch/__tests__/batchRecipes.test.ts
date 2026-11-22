import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { createProvider } from '../../../core/llm-providers';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import type { BatchRecipeOptions } from '../../../shared/types/batch.types';
import { executeRecipeForFile } from '../recipes/batchRecipes';

vi.mock('../../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

function makeFile(path: string, size = 400): TFile {
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

const BASE_OPTIONS: BatchRecipeOptions = {
	fmMergeMode: 'empty-only',
	generateTags: true,
	generateDescription: true,
	calloutTitle: '핵심 요약',
	customPrompt: '',
	customOutputMode: 'frontmatter-key',
	customFrontmatterKey: 'ai_summary',
	providerId: 'openai-1',
	modelId: 'gpt-4o-mini',
};

describe('batchRecipes', () => {
	let filesContent: Record<string, string>;
	let fmCache: Record<string, Record<string, unknown>>;
	let allFiles: TFile[];
	let mockApp: App;
	let mockPlugin: LuminaPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		const noteA = makeFile('Notes/사과.md');
		const noteB = makeFile('Notes/옵시디언.md');
		allFiles = [noteA, noteB];
		filesContent = {
			'Notes/사과.md':
				'---\ntags:\n  - 기존태그\n---\n오늘 마당에서 옵시디언으로 정리하던 사과 노트를 다시 읽어보았다. 내용이 아주 유익했고 가을 수확 시기와 품종 비교 정보까지 잘 담겨 있었다.',
			'Notes/옵시디언.md': '옵시디언은 마크다운 기반의 지식 관리 도구이며 양방향 링크와 그래프 뷰 기능을 제공합니다.',
		};
		fmCache = {
			'Notes/사과.md': { tags: ['기존태그'] },
			'Notes/옵시디언.md': {},
		};

		mockApp = {
			vault: {
				getMarkdownFiles: () => allFiles,
				read: vi.fn(async (file: TFile) => filesContent[file.path] ?? ''),
			},
			metadataCache: {
				getFileCache: (file: TFile) => ({ frontmatter: fmCache[file.path] }),
			},
		} as unknown as App;

		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
		settings.connections.providers = [
			{
				id: 'openai-1',
				type: 'openai',
				credential: 'sk-test',
				availableModels: ['gpt-4o-mini'],
				isVerified: true,
			},
		];

		mockPlugin = {
			app: mockApp,
			settings,
		} as unknown as LuminaPlugin;
	});

	it('frontmatter 레시피: merge 모드에서 기존 태그를 유지하면서 플레이스홀더를 걸러내고 병합한다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content:
					'{"tags": ["#과일", "tag1", "기존태그", "농장"], "description": "사과에 대해 정리한 노트입니다."}',
				usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		const res = await executeRecipeForFile(
			mockApp,
			mockPlugin,
			allFiles[0],
			'frontmatter',
			{ ...BASE_OPTIONS, fmMergeMode: 'merge' },
		);

		expect(res.tokensUsed).toBe(140);
		expect(res.proposed).toEqual({
			kind: 'frontmatter',
			beforeTags: ['기존태그'],
			afterTags: ['기존태그', '과일', '농장'],
			beforeDescription: '',
			afterDescription: '사과에 대해 정리한 노트입니다.',
			summaryText: '+2 tags · description',
		});
	});

	it('autolink 레시피: 볼트 내 다른 노트 제목을 찾아 위키링크 제안을 생성한다', async () => {
		const res = await executeRecipeForFile(
			mockApp,
			mockPlugin,
			allFiles[0],
			'autolink',
			BASE_OPTIONS,
		);

		expect(res.tokensUsed).toBe(0);
		expect(res.proposed?.kind).toBe('content');
		expect(res.proposed?.afterContent).toContain('[[옵시디언]]');
	});

	it('summary-callout 레시피: 프론트매터 바로 아래 본문 최상단에 요약 콜아웃을 삽입한다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '이 노트는 사과에 대한 관찰 기록입니다.',
				usage: { inputTokens: 80, outputTokens: 25, totalTokens: 105 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		const res = await executeRecipeForFile(
			mockApp,
			mockPlugin,
			allFiles[0],
			'summary-callout',
			BASE_OPTIONS,
		);

		expect(res.proposed?.kind).toBe('content');
		expect(res.proposed?.afterContent).toContain(
			'---\ntags:\n  - 기존태그\n---\n> [!summary] 핵심 요약\n> 이 노트는 사과에 대한 관찰 기록입니다.',
		);
	});

	it('custom-prompt 레시피: {{title}}, {{folder}} 변수를 치환하고 frontmatter-key 모드로 결과를 반환한다', async () => {
		const chatMock = vi.fn().mockResolvedValue({
			content: '액션 아이템: 사과 수확하기',
			usage: { inputTokens: 90, outputTokens: 20, totalTokens: 110 },
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatMock,
		} as unknown as ReturnType<typeof createProvider>);

		const res = await executeRecipeForFile(
			mockApp,
			mockPlugin,
			allFiles[0],
			'custom-prompt',
			{
				...BASE_OPTIONS,
				customPrompt: '제목={{title}}, 폴더={{folder}}의 핵심 액션을 요약해줘.',
				customOutputMode: 'frontmatter-key',
				customFrontmatterKey: 'action_item',
			},
		);

		const sentPrompt = String(chatMock.mock.calls[0]?.[0]?.[0]?.content ?? '');
		expect(sentPrompt).toContain('제목=사과, 폴더=Notes');
		expect(res.proposed).toEqual({
			kind: 'frontmatter',
			customFmKey: 'action_item',
			beforeCustomFmVal: '',
			afterCustomFmVal: '액션 아이템: 사과 수확하기',
			summaryText: 'action_item',
		});
	});
});
