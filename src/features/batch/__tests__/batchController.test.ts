import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { createProvider } from '../../../core/llm-providers';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import {
	batchQueueCounts,
	getBatchState,
	patchBatchState,
	resetBatchStore,
	setBatchTargetFolder,
} from '../../../core/store/batchStore';
import {
	resetEntitlementState,
	setEntitlementState,
	setReleasedFeatures,
} from '../../../core/store/entitlementStore';
import { get } from 'svelte/store';
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
				configDir: '.obsidian',
				getMarkdownFiles: () => Object.values(fileObjs),
				getAbstractFileByPath: (path: string) => fileObjs[path] ?? null,
				read: vi.fn(async (file: TFile) => diskFiles[file.path] ?? ''),
				modify: vi.fn(async (file: TFile, content: string) => {
					diskFiles[file.path] = content;
				}),
				createFolder: vi.fn(async () => undefined),
			},
			metadataCache: {
				getFileCache: (file: TFile) => ({ frontmatter: fmStore[file.path] }),
			},
			fileManager: {
				renameFile: vi.fn(async (file: TFile, newPath: string) => {
					const oldPath = file.path;
					const content = diskFiles[oldPath];
					const fm = fmStore[oldPath];
					delete diskFiles[oldPath];
					delete fileObjs[oldPath];
					delete fmStore[oldPath];
					file.path = newPath;
					file.name = newPath.split('/').pop() ?? newPath;
					file.basename = file.name.replace(/\.md$/i, '');
					fileObjs[newPath] = file;
					diskFiles[newPath] = content;
					fmStore[newPath] = fm;
				}),
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

	it('배치 실행 중(running/paused)에는 setBatchTargetFolder가 기존 대상 폴더와 접힘 상태를 덮어쓰지 않는다', () => {
		patchBatchState({
			runState: 'running',
			isConfigCollapsed: true,
			scopeConfig: {
				scopeMode: 'folder',
				folderPath: 'ActiveFolder',
				tagFilter: '',
				skipIfAlreadyHasTarget: true,
				minContentLength: 50,
			},
		});

		const appliedWhileRunning = setBatchTargetFolder('OtherFolder');
		expect(appliedWhileRunning).toBe(false);
		expect(getBatchState().scopeConfig.folderPath).toBe('ActiveFolder');
		expect(getBatchState().isConfigCollapsed).toBe(true);

		patchBatchState({ runState: 'completed' });
		const appliedAfterDone = setBatchTargetFolder('OtherFolder');
		expect(appliedAfterDone).toBe(true);
		expect(getBatchState().scopeConfig.folderPath).toBe('OtherFolder');
		expect(getBatchState().isConfigCollapsed).toBe(false);
	});

	it('Freemium(무료 노출) 상태에서는 상위 5개만 처리되고 나머지는 locked, 일괄 수락·커스텀 프롬프트는 차단된다', async () => {
		resetEntitlementState();
		setReleasedFeatures(['batch-studio']);

		for (let i = 1; i <= 7; i++) {
			const p = `note-${i}.md`;
			fileObjs[p] = makeFile(p);
			diskFiles[p] = `${i}번째 노트의 충분한 본문 텍스트입니다. 무료 제한 테스트를 위한 마크다운 문서이며 최소 글자 수 기준을 여유 있게 넘깁니다.`;
			fmStore[p] = {};
		}
		delete fileObjs['a.md'];
		delete fileObjs['b.md'];

		const chatMock = vi.fn().mockResolvedValue({
			content: '{"tags": ["무료"], "description": "요약"}',
			usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatMock,
		} as unknown as ReturnType<typeof createProvider>);

		// custom-prompt 레시피는 무료에서 차단되어야 함
		patchBatchState({ activeRecipeId: 'custom-prompt', recipeOptions: { ...getBatchState().recipeOptions, customPrompt: '요약해줘' } });
		await controller.startBatch();
		expect(chatMock).not.toHaveBeenCalled();

		// frontmatter 레시피로 시작하면 7개 중 상위 5개만 staged, 나머지 2개는 locked
		patchBatchState({ activeRecipeId: 'frontmatter' });
		await controller.startBatch();

		const state = getBatchState();
		expect(chatMock).toHaveBeenCalledTimes(5);
		expect(state.queue).toHaveLength(7);
		expect(state.queue.slice(0, 5).every((q) => q.status === 'staged')).toBe(true);
		expect(state.queue.slice(5).every((q) => q.status === 'locked' && !q.selected)).toBe(true);

		const counts = get(batchQueueCounts);
		expect(counts.total).toBe(5);
		expect(counts.done).toBe(5);
		expect(counts.locked).toBe(2);

		// 원클릭 일괄 수락은 차단, 개별 수락은 허용
		expect(await controller.applyAllSelectedStaged()).toBe(0);
		expect(await controller.applySingleItem('note-1.md')).toBe(true);
		expect(fmStore['note-1.md'].tags).toEqual(['무료']);
	});

	it('수동 folder-move 레시피 실행, 이동 수락, 및 원래 경로로의 스냅샷 롤백이 정상 동작한다', async () => {
		patchBatchState({
			activeRecipeId: 'folder-move',
			recipeOptions: {
				...getBatchState().recipeOptions,
				moveConfig: {
					mode: 'fixed',
					fixedTargetFolder: 'Archive',
					tagMappings: [],
					aiCandidateFolders: [],
					fallbackFolder: '',
					conflictPolicy: 'rename-suffix',
					createFolderIfMissing: true,
				},
			},
		});

		await controller.startBatch();

		let state = getBatchState();
		expect(state.runState).toBe('completed');
		expect(state.queue).toHaveLength(2);
		expect(state.queue[0].proposed?.kind).toBe('move');
		expect(state.queue[0].proposed?.moveToPath).toBe('Archive/a.md');

		// a.md 단건 수락 -> Archive/a.md로 이동 및 이동 스냅샷 기록
		const applied = await controller.applySingleItem('a.md');
		expect(applied).toBe(true);
		expect(fileObjs['Archive/a.md']).toBeDefined();
		expect(fileObjs['a.md']).toBeUndefined();

		state = getBatchState();
		expect(state.history).toHaveLength(1);
		expect(state.history[0].snapshots[0].movedFromPath).toBe('a.md');
		expect(state.history[0].snapshots[0].movedToPath).toBe('Archive/a.md');

		// 롤백 시 Archive/a.md를 다시 원래 경로(a.md)로 복원
		const restored = await controller.rollbackHistoryEntry(state.history[0].id);
		expect(restored).toBe(1);
		expect(fileObjs['a.md']).toBeDefined();
		expect(fileObjs['Archive/a.md']).toBeUndefined();
	});

	it('휴지통(trashed) 스냅샷이 기록된 고아노트 히스토리를 롤백하면 원본 파일을 재생성한다', async () => {
		const { addBatchHistoryEntry } = await import('../../../core/store/batchStore');
		(mockApp.vault as unknown as { create: ReturnType<typeof vi.fn> }).create = vi.fn(
			async (p: string, content: string) => {
				const f = makeFile(p);
				fileObjs[p] = f;
				diskFiles[p] = content;
				return f;
			},
		);

		const originalText = diskFiles['a.md'];
		delete fileObjs['a.md'];
		delete diskFiles['a.md'];

		addBatchHistoryEntry({
			id: 'trash-1',
			timestamp: Date.now(),
			recipeId: 'autolink',
			appliedCount: 1,
			rolledBack: false,
			source: 'orphan',
			actionLabel: 'Trash 1 orphan',
			snapshots: [
				{
					path: 'a.md',
					originalRawContent: originalText,
					trashed: true,
				},
			],
		});

		const restored = await controller.rollbackHistoryEntry('trash-1');
		expect(restored).toBe(1);
		expect(fileObjs['a.md']).toBeDefined();
		expect(diskFiles['a.md']).toBe(originalText);
	});

	it('일시정지(pauseBatch)·재개(resumeBatch)·중단(cancelBatch) 시 대기 항목을 skipped로 처리하고 상태를 전이한다', async () => {
		let releaseFirstItem!: () => void;
		const firstItemGate = new Promise<void>((resolve) => {
			releaseFirstItem = resolve;
		});

		let callIdx = 0;
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockImplementation(async () => {
				callIdx++;
				if (callIdx === 1) {
					await firstItemGate;
				}
				return {
					content: '{"tags": ["진행"], "description": "요약"}',
					usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
				};
			}),
		} as unknown as ReturnType<typeof createProvider>);

		const batchPromise = controller.startBatch();
		await new Promise((r) => setTimeout(r, 15));
		expect(getBatchState().runState).toBe('running');

		// 일시정지 -> 재개
		controller.pauseBatch();
		expect(getBatchState().runState).toBe('paused');
		controller.resumeBatch();
		expect(getBatchState().runState).toBe('running');

		// 첫 항목 완료 전에 전체 중단 -> b.md는 queued/running에서 skipped로 전이
		controller.cancelBatch();
		releaseFirstItem();
		await batchPromise;

		const state = getBatchState();
		expect(state.runState).toBe('completed');
		const cancelledItem = state.queue.find((q) => q.path === 'b.md');
		expect(cancelledItem?.status).toBe('skipped');
		expect(cancelledItem?.cancelledByUser).toBe(true);
		// 중단된 미실행 항목은 done(처리됨) 수에 포함되지 않아야 함
		expect(get(batchQueueCounts).done).toBe(0);
	});

	it('retryFailedItems는 실패한 항목만 다시 대기열로 올려 재실행한다', async () => {
		const chatMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('HTTP 500 Internal Error'))
			.mockResolvedValueOnce({
				content: '{"tags": ["ok"], "description": "성공"}',
			})
			.mockResolvedValueOnce({
				content: '{"tags": ["retry-ok"], "description": "재시도 성공"}',
			});

		vi.mocked(createProvider).mockReturnValue({
			chat: chatMock,
		} as unknown as ReturnType<typeof createProvider>);

		await controller.startBatch();
		expect(chatMock).toHaveBeenCalledTimes(2);
		expect(getBatchState().queue.find((q) => q.path === 'a.md')?.status).toBe('failed');
		expect(getBatchState().queue.find((q) => q.path === 'b.md')?.status).toBe('staged');

		await controller.retryFailedItems();
		expect(chatMock).toHaveBeenCalledTimes(3); // 실패했던 a.md 1건만 재호출
		expect(getBatchState().queue.find((q) => q.path === 'a.md')?.status).toBe('staged');
	});

	it('summary-callout, custom-prompt, autolink 레시피 적용·스냅샷 롤백 및 이중 롤백 방지를 검증한다', async () => {
		// 1) summary-callout 실행 및 적용
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '핵심 내용 한 줄 요약입니다.',
				usage: { inputTokens: 20, outputTokens: 15, totalTokens: 35 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		patchBatchState({ activeRecipeId: 'summary-callout' });
		await controller.startBatch();
		expect(getBatchState().queue[0].status).toBe('staged');
		expect(await controller.applySingleItem('a.md')).toBe(true);
		expect(diskFiles['a.md']).toContain('> [!summary] Summary');

		const summaryHistoryId = getBatchState().history[0].id;
		expect(await controller.rollbackHistoryEntry(summaryHistoryId)).toBe(1);
		// 이미 롤백된 히스토리 재호출 시 0 반환 (이중 롤백 방지)
		expect(await controller.rollbackHistoryEntry(summaryHistoryId)).toBe(0);

		// 2) custom-prompt (prepend 모드) 실행 및 적용
		resetBatchStore();
		diskFiles['a.md'] = '첫 번째 노트의 충분한 본문 텍스트입니다. 마크다운 테스트용 문서이며 최소 글자 수 기준을 여유 있게 넘깁니다.';
		patchBatchState({
			activeRecipeId: 'custom-prompt',
			recipeOptions: {
				...getBatchState().recipeOptions,
				customPrompt: '핵심만 적으세요',
				customOutputMode: 'prepend',
			},
		});
		await controller.startBatch();
		expect(await controller.applySingleItem('a.md')).toBe(true);
		expect(diskFiles['a.md']).toContain('핵심 내용 한 줄 요약입니다.');

		// 대상 파일 삭제 후 롤백 시 에러 없이 0건 복원
		delete fileObjs['a.md'];
		const customHistoryId = getBatchState().history[0].id;
		expect(await controller.rollbackHistoryEntry(customHistoryId)).toBe(0);

		// 3) autolink 실행 (LLM 없이 로컬 볼트 노트명 링크)
		resetBatchStore();
		const targetNote = makeFile('Lumina Guide.md');
		fileObjs[targetNote.path] = targetNote;
		diskFiles[targetNote.path] = 'Lumina Guide 문서 본문입니다.';
		const srcNote = makeFile('source.md');
		fileObjs[srcNote.path] = srcNote;
		diskFiles[srcNote.path] = '오늘은 Lumina Guide 문서와 관련된 충분한 분량의 내용을 정리하는 테스트 노트입니다.';
		delete fileObjs['b.md'];
		fmStore[targetNote.path] = {};
		fmStore[srcNote.path] = {};

		patchBatchState({ activeRecipeId: 'autolink' });
		await controller.startBatch();
		const srcItem = getBatchState().queue.find((q) => q.path === 'source.md');
		expect(srcItem?.status).toBe('staged');
		expect(srcItem?.proposed?.afterContent).toContain('[[Lumina Guide]]');
	});

	it('매칭 대상 파일이 0건이면 LLM을 호출하지 않고 runState를 idle로 유지한다', async () => {
		fileObjs = {};
		const chatMock = vi.fn();
		vi.mocked(createProvider).mockReturnValue({
			chat: chatMock,
		} as unknown as ReturnType<typeof createProvider>);

		await controller.startBatch();
		expect(chatMock).not.toHaveBeenCalled();
		expect(getBatchState().runState).toBe('idle');
		expect(getBatchState().queue).toHaveLength(0);
	});

	it('롤백 후 동일 세션에서 다시 적용해도 새 고유 히스토리 ID를 발급해 중복 키 오류가 발생하지 않는다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"tags": ["롤백테스트"], "description": "설명"}',
				usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		await controller.startBatch();
		expect(await controller.applySingleItem('a.md')).toBe(true);
		const firstId = getBatchState().history[0].id;

		expect(await controller.rollbackHistoryEntry(firstId)).toBe(1);
		expect(getBatchState().activeRunHistoryId).toBeNull();

		// 롤백 후 다시 반영 시 이전 ID와 다른 새 히스토리 ID가 생성되어야 함
		expect(await controller.applySingleItem('a.md')).toBe(true);
		const history = getBatchState().history;
		expect(history).toHaveLength(2);
		expect(history[0].id).not.toBe(history[1].id);
		expect(new Set(history.map((h) => h.id)).size).toBe(2);
	});

	it('거절한 항목을 restoreRejectedItem으로 다시 검수 대기(staged) 상태로 되돌릴 수 있다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"tags": ["복구"], "description": "설명"}',
				usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		await controller.startBatch();
		controller.rejectSingleItem('a.md');
		expect(getBatchState().queue.find((q) => q.path === 'a.md')?.status).toBe('rejected');

		controller.restoreRejectedItem('a.md');
		const restored = getBatchState().queue.find((q) => q.path === 'a.md');
		expect(restored?.status).toBe('staged');
		expect(restored?.selected).toBe(true);
	});

	it('resumeCancelledItems는 기존 staged 결과를 유지하고 중단된 미실행 항목만 이어서 실행한다', async () => {
		let releaseSecondItem!: () => void;
		const secondItemGate = new Promise<void>((resolve) => {
			releaseSecondItem = resolve;
		});

		const chatMock = vi.fn().mockImplementation(async () => {
			if (chatMock.mock.calls.length === 2) {
				await secondItemGate;
			}
			return {
				content: '{"tags": ["이어하기"], "description": "설명"}',
				usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
			};
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatMock,
		} as unknown as ReturnType<typeof createProvider>);

		const firstRun = controller.startBatch();
		await vi.waitFor(() =>
			expect(getBatchState().queue.find((q) => q.path === 'a.md')?.status).toBe('staged'),
		);

		// 1건 완료 후 2번째 항목 처리 중 중단
		controller.cancelBatch();
		releaseSecondItem();
		await firstRun;

		expect(get(batchQueueCounts).done).toBe(1);
		expect(get(batchQueueCounts).cancelled).toBe(1);

		const callsBeforeResume = chatMock.mock.calls.length;
		await controller.resumeCancelledItems();

		// 기존 a.md는 재호출하지 않고 중단됐던 b.md 1건만 추가 호출되어야 함
		expect(chatMock.mock.calls.length).toBe(callsBeforeResume + 1);
		expect(get(batchQueueCounts).done).toBe(2);
		expect(get(batchQueueCounts).cancelled).toBe(0);
		expect(getBatchState().queue.find((q) => q.path === 'a.md')?.status).toBe('staged');
		expect(getBatchState().queue.find((q) => q.path === 'b.md')?.status).toBe('staged');
	});

	it('Freemium 요약 콜아웃에서 앞 5개 반영 후 재실행하면 이미 요약된 5개를 건너뛰고 6~7번째 노트를 처리한다', async () => {
		resetEntitlementState();
		setReleasedFeatures(['batch-studio']);
		fileObjs = {};
		diskFiles = {};
		fmStore = {};
		for (let i = 1; i <= 7; i++) {
			const p = `note-${i}.md`;
			fileObjs[p] = makeFile(p, 300);
			diskFiles[p] = `${i}번째 노트의 본문입니다. 요약 콜아웃 배치를 위한 충분한 길이의 텍스트를 담고 있습니다.`;
			fmStore[p] = {};
		}

		const chatMock = vi.fn().mockResolvedValue({
			content: '핵심 요약 문장입니다.',
			usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatMock,
		} as unknown as ReturnType<typeof createProvider>);

		patchBatchState({ activeRecipeId: 'summary-callout' });

		// 1차 실행: 상위 5개 처리, 2개 locked
		await controller.startBatch();
		expect(get(batchQueueCounts).staged).toBe(5);
		expect(get(batchQueueCounts).locked).toBe(2);

		// 1~5번 노트 개별 수락 -> 디스크 본문에 > [!summary] 반영됨
		for (let i = 1; i <= 5; i++) {
			expect(await controller.applySingleItem(`note-${i}.md`)).toBe(true);
			expect(diskFiles[`note-${i}.md`]).toContain('> [!summary]');
		}

		// 2차 실행: 이미 요약된 1~5번은 사전 제외되고 6~7번 2개만 정상 실행되어야 함
		await controller.startBatch();
		const queue2 = getBatchState().queue;
		expect(queue2.map((q) => q.path)).toEqual(['note-6.md', 'note-7.md']);
		expect(get(batchQueueCounts).staged).toBe(2);
		expect(get(batchQueueCounts).locked).toBe(0);
	});
});
