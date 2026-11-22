import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { createProvider } from '../../../core/llm-providers';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import {
	getBatchState,
	patchBatchState,
	resetBatchStore,
} from '../../../core/store/batchStore';
import {
	resetEntitlementState,
	setEntitlementState,
} from '../../../core/store/entitlementStore';
import { BatchStudioController } from '../batchController';

vi.mock('../../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

function makeFile(path: string, size = 300): TFile {
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

describe('BatchStudioController', () => {
	let diskFiles: Record<string, string>;
	let fmStore: Record<string, Record<string, unknown>>;
	let fileObjs: Record<string, TFile>;
	let mockApp: App;
	let mockPlugin: LuminaPlugin;
	let controller: BatchStudioController;

	beforeEach(() => {
		vi.clearAllMocks();
		resetBatchStore();
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['batch-studio']),
		});

		const f1 = makeFile('a.md');
		const f2 = makeFile('b.md');
		fileObjs = { 'a.md': f1, 'b.md': f2 };
		diskFiles = {
			'a.md': '첫 번째 노트의 충분한 본문 텍스트입니다. 마크다운 테스트용 문서이며 최소 글자 수 기준을 여유 있게 넘깁니다.',
			'b.md': '두 번째 노트의 충분한 본문 텍스트입니다. 배치 테스트용 문서이며 프론트매터 일괄 생성 동작을 검증합니다.',
		};
		fmStore = {
			'a.md': {},
			'b.md': {},
		};

		mockApp = {
			vault: {
				getMarkdownFiles: () => Object.values(fileObjs),
				getAbstractFileByPath: (path: string) => fileObjs[path] ?? null,
				read: vi.fn(async (file: TFile) => diskFiles[file.path] ?? ''),
				modify: vi.fn(async (file: TFile, content: string) => {
					diskFiles[file.path] = content;
				}),
			},
			metadataCache: {
				getFileCache: (file: TFile) => ({ frontmatter: fmStore[file.path] }),
			},
			fileManager: {
				processFrontMatter: vi.fn(
					async (file: TFile, cb: (fm: Record<string, unknown>) => void) => {
						const fm = { ...(fmStore[file.path] ?? {}) };
						cb(fm);
						fmStore[file.path] = fm;
						// 스냅샷 복원 테스트를 위해 파일 텍스트에도 YAML 반영 시뮬레이션
						const body = diskFiles[file.path].replace(/^---\n[\s\S]*?\n---\n/, '');
						diskFiles[file.path] = `---\ntags: ${JSON.stringify(fm.tags ?? [])}\ndescription: "${fm.description ?? ''}"\n---\n${body}`;
					},
				),
			},
		} as unknown as App;

		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
		settings.connections.providers = [
			{
				id: 'google-1',
				type: 'google',
				credential: 'key',
				availableModels: ['gemini-2.5-flash'],
				isVerified: true,
			},
		];

		mockPlugin = {
			app: mockApp,
			settings,
		} as unknown as LuminaPlugin;

		controller = new BatchStudioController(mockPlugin, { rateLimitRetryWaitMs: 0 });
	});

	afterEach(() => {
		resetBatchStore();
		resetEntitlementState();
	});

	it('배치 실행 후 단건 수락(Auto-advance), 인라인 수정, 일괄 수락, 스냅샷 롤백이 순서대로 동작한다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"tags": ["노트", "자동화"], "description": "테스트 요약"}',
				usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		await controller.startBatch();

		let state = getBatchState();
		expect(state.runState).toBe('completed');
		expect(state.isConfigCollapsed).toBe(true);
		expect(state.queue).toHaveLength(2);
		expect(state.queue.every((q) => q.status === 'staged')).toBe(true);
		expect(state.selectedPath).toBe('a.md');

		// 1. 인라인 편집: a.md의 태그 수정 및 요약 수정
		controller.updateProposedFrontmatter('a.md', {
			afterTags: ['커스텀태그'],
			afterDescription: '수정된 요약',
		});

		// 2. 단건 수락 -> 파일 반영 후 다음 staged 항목(b.md)으로 자동 이동(Auto-advance)
		const appliedSingle = await controller.applySingleItem('a.md');
		expect(appliedSingle).toBe(true);
		expect(fmStore['a.md'].tags).toEqual(['커스텀태그']);
		expect(fmStore['a.md'].description).toBe('수정된 요약');

		state = getBatchState();
		expect(state.queue[0].status).toBe('applied');
		expect(state.selectedPath).toBe('b.md');

		// 3. 나머지 체크된 항목(b.md) 일괄 수락
		const appliedBatchCount = await controller.applyAllSelectedStaged();
		expect(appliedBatchCount).toBe(1);
		expect(fmStore['b.md'].tags).toEqual(['노트', '자동화']);

		state = getBatchState();
		expect(state.history).toHaveLength(1);
		expect(state.history[0].appliedCount).toBe(2);
		expect(state.history[0].snapshots).toHaveLength(2);

		// 4. 원클릭 배치 롤백으로 두 파일의 본문을 원래 상태로 복원
		const restoredCount = await controller.rollbackHistoryEntry(state.history[0].id);
		expect(restoredCount).toBe(2);
		expect(diskFiles['a.md']).toBe('첫 번째 노트의 충분한 본문 텍스트입니다. 마크다운 테스트용 문서이며 최소 글자 수 기준을 여유 있게 넘깁니다.');
		expect(diskFiles['b.md']).toBe('두 번째 노트의 충분한 본문 텍스트입니다. 배치 테스트용 문서이며 프론트매터 일괄 생성 동작을 검증합니다.');
		expect(getBatchState().history[0].rolledBack).toBe(true);
	});

	it('단건 거절(rejectSingleItem) 시 다음 staged 항목으로 포커스가 이동한다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"tags": ["테스트"], "description": "요약"}',
			}),
		} as unknown as ReturnType<typeof createProvider>);

		await controller.startBatch();
		expect(getBatchState().selectedPath).toBe('a.md');

		controller.rejectSingleItem('a.md');
		expect(getBatchState().queue[0].status).toBe('rejected');
		expect(getBatchState().selectedPath).toBe('b.md');
	});

	it('HTTP 429 Rate Limit 발생 시 자동 재시도하여 성공시킨다', async () => {
		const chatMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
			.mockResolvedValue({
				content: '{"tags": ["복구"], "description": "재시도 성공"}',
			});

		vi.mocked(createProvider).mockReturnValue({
			chat: chatMock,
		} as unknown as ReturnType<typeof createProvider>);

		await controller.startBatch();
		expect(chatMock).toHaveBeenCalledTimes(3); // a.md(429->성공) + b.md(성공)
		expect(getBatchState().queue.every((q) => q.status === 'staged')).toBe(true);
	});

	it('샘플 1개 테스트(runSampleTest)는 파일을 수정하지 않고 제안만 미리보기에 저장한다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"tags": ["샘플"], "description": "미리보기 요약"}',
			}),
		} as unknown as ReturnType<typeof createProvider>);

		patchBatchState({ sampleFilePath: 'a.md' });
		await controller.runSampleTest();

		const state = getBatchState();
		expect(state.sampleRunning).toBe(false);
		expect(state.sampleResult?.afterTags).toEqual(['샘플']);
		expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
	});
});
