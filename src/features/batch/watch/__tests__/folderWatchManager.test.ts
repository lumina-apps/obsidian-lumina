import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, type App, type EventRef } from 'obsidian';
import type LuminaPlugin from '../../../../main';
import { createProvider } from '../../../../core/llm-providers';
import { DEFAULT_SETTINGS } from '../../../../core/settings/defaultSettings';
import { getBatchState, resetBatchStore } from '../../../../core/store/batchStore';
import {
	getBatchWatchState,
	resetBatchWatchStore,
} from '../../../../core/store/batchWatchStore';
import {
	resetEntitlementState,
	setEntitlementState,
} from '../../../../core/store/entitlementStore';
import type { FolderWatchRule } from '../../../../shared/types/batchWatch.types';
import { FolderWatchManager } from '../folderWatchManager';

vi.mock('../../../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

function makeFile(path: string, mtime = Date.now(), size = 300): TFile {
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

function makeRule(overrides: Partial<FolderWatchRule> = {}): FolderWatchRule {
	return {
		id: 'rule-1',
		name: 'Inbox Auto',
		enabled: true,
		sourceFolder: '00_Inbox',
		includeSubfolders: false,
		tagFilter: '',
		minContentLength: 20,
		skipIfAlreadyHasTarget: true,
		triggerMode: 'on-create-or-modify',
		debounceSec: 0,
		intervalMin: 15,
		recipes: ['frontmatter'],
		recipeOptions: {
			fmMergeMode: 'empty-only',
			generateTags: true,
			generateDescription: true,
			calloutTitle: 'Summary',
			customPrompt: '',
			customOutputMode: 'frontmatter-key',
			customFrontmatterKey: 'ai_summary',
			providerId: '',
			modelId: '',
		},
		moveAction: {
			mode: 'fixed',
			fixedTargetFolder: '10_Processed',
			tagMappings: [],
			aiCandidateFolders: [],
			fallbackFolder: '',
			conflictPolicy: 'rename-suffix',
			createFolderIfMissing: true,
		},
		executionMode: 'auto-stage',
		...overrides,
	};
}

describe('FolderWatchManager', () => {
	let fileObjs: Record<string, TFile>;
	let diskFiles: Record<string, string>;
	let fmStore: Record<string, Record<string, unknown>>;
	let vaultListeners: Map<string, Set<(...args: unknown[]) => void>>;
	let workspaceListeners: Map<string, Set<(...args: unknown[]) => void>>;
	let activeFile: TFile | null;
	let mockStatusBarEl: {
		addClass: ReturnType<typeof vi.fn>;
		addEventListener: ReturnType<typeof vi.fn>;
		setText: ReturnType<typeof vi.fn>;
		setCssStyles: ReturnType<typeof vi.fn>;
		detach: ReturnType<typeof vi.fn>;
		style: { display: string };
	};
	let mockApp: App;
	let mockPlugin: LuminaPlugin;
	let manager: FolderWatchManager | null;

	const emitVault = (event: string, ...args: unknown[]) => {
		for (const cb of vaultListeners.get(event) ?? []) {
			cb(...args);
		}
	};

	const emitWorkspace = (event: string, ...args: unknown[]) => {
		for (const cb of workspaceListeners.get(event) ?? []) {
			cb(...args);
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		resetBatchStore();
		resetBatchWatchStore();
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['batch-studio']),
		});

		fileObjs = {};
		diskFiles = {};
		fmStore = {};
		vaultListeners = new Map();
		workspaceListeners = new Map();
		activeFile = null;
		manager = null;

		mockStatusBarEl = {
			addClass: vi.fn(),
			addEventListener: vi.fn(),
			setText: vi.fn(),
			setCssStyles: vi.fn((styles: Partial<CSSStyleDeclaration>) => {
				Object.assign(mockStatusBarEl.style, styles);
			}),
			detach: vi.fn(),
			style: { display: '' },
		};

		const localStore = new Map<string, unknown>();
		mockApp = {
			loadLocalStorage: vi.fn((key: string) => localStore.get(key) ?? null),
			saveLocalStorage: vi.fn((key: string, val: unknown | null) => {
				if (val === null) {
					localStore.delete(key);
				} else {
					localStore.set(key, val);
				}
			}),
			vault: {
				configDir: '.obsidian',
				on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
					let set = vaultListeners.get(event);
					if (!set) {
						set = new Set();
						vaultListeners.set(event, set);
					}
					set.add(cb);
					return { event, cb } as unknown as EventRef;
				}),
				offref: vi.fn((ref: unknown) => {
					const r = ref as { event?: string; cb?: (...args: unknown[]) => void };
					if (r.event && r.cb) {
						vaultListeners.get(r.event)?.delete(r.cb);
					}
				}),
				getMarkdownFiles: () => Object.values(fileObjs),
				getAbstractFileByPath: (path: string) => fileObjs[path] ?? null,
				read: vi.fn(async (file: TFile) => diskFiles[file.path] ?? ''),
				modify: vi.fn(async (file: TFile, content: string) => {
					diskFiles[file.path] = content;
				}),
				createFolder: vi.fn(async () => undefined),
			},
			workspace: {
				getActiveFile: () => activeFile,
				on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
					let set = workspaceListeners.get(event);
					if (!set) {
						set = new Set();
						workspaceListeners.set(event, set);
					}
					set.add(cb);
					return { event, cb } as unknown as EventRef;
				}),
				offref: vi.fn((ref: unknown) => {
					const r = ref as { event?: string; cb?: (...args: unknown[]) => void };
					if (r.event && r.cb) {
						workspaceListeners.get(r.event)?.delete(r.cb);
					}
				}),
			},
			metadataCache: {
				getFileCache: (file: TFile) => ({ frontmatter: fmStore[file.path] ?? {} }),
			},
			fileManager: {
				processFrontMatter: vi.fn(
					async (file: TFile, cb: (fm: Record<string, unknown>) => void) => {
						const fm = { ...(fmStore[file.path] ?? {}) };
						cb(fm);
						fmStore[file.path] = fm;
						const body = (diskFiles[file.path] ?? '').replace(/^---\n[\s\S]*?\n---\n/, '');
						diskFiles[file.path] = `---\ntags: ${JSON.stringify(fm.tags ?? [])}\ndescription: "${fm.description ?? ''}"\n---\n${body}`;
					},
				),
				renameFile: vi.fn(async (file: TFile, newPath: string) => {
					const oldPath = file.path;
					const content = diskFiles[oldPath];
					delete diskFiles[oldPath];
					delete fileObjs[oldPath];
					file.path = newPath;
					file.name = newPath.split('/').pop() ?? newPath;
					file.basename = file.name.replace(/\.md$/i, '');
					fileObjs[newPath] = file;
					diskFiles[newPath] = content;
				}),
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
		settings.batchWatch = {
			rules: [makeRule()],
			dailyMaxItems: 30,
			burstLimit: 8,
			showStatusBar: true,
		};

		mockPlugin = {
			app: mockApp,
			settings,
			addStatusBarItem: vi.fn(() => mockStatusBarEl),
		} as unknown as LuminaPlugin;
	});

	afterEach(() => {
		vi.useRealTimers();
		manager?.destroy();
		resetBatchStore();
		resetBatchWatchStore();
		resetEntitlementState();
	});

	async function flushAsync(ms = 30): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, ms));
	}

	it('Auto-Stage 모드에서 새 노트를 감지해 검토 대기열에 쌓고, 수락 시 내용 반영 + 폴더 이동 + 롤백 스냅샷을 기록한다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"tags": ["인박스", "정리"], "description": "자동감시 테스트 요약"}',
				usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 0,
			mtimeMaxAgeMs: 10000,
			selfCooldownMs: 3000,
			rateLimitRetryWaitMs: 0,
		});
		manager.init();

		const note = makeFile('00_Inbox/hello.md');
		fileObjs[note.path] = note;
		diskFiles[note.path] = '인박스에 방금 생성된 노트 본문입니다. 자동감시 동작을 검증합니다.';
		fmStore[note.path] = {};

		emitVault('create', note);
		await flushAsync();

		// auto-stage 단계에서는 디스크 수정·이동 없이 stagedItems에만 적재
		expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		expect(mockApp.fileManager.renameFile).not.toHaveBeenCalled();

		const staged = getBatchWatchState().stagedItems;
		expect(staged).toHaveLength(1);
		expect(staged[0].path).toBe('00_Inbox/hello.md');
		expect(staged[0].steps).toHaveLength(1);
		expect(staged[0].moveProposal?.toPath).toBe('10_Processed/hello.md');

		// 수락 시 프론트매터 반영 + 이동 + 롤백 히스토리 기록
		const approved = await manager.approveStagedItem(staged[0].id);
		expect(approved).toBe(true);
		expect(getBatchWatchState().stagedItems).toHaveLength(0);
		expect(fileObjs['10_Processed/hello.md']).toBeDefined();
		expect(fmStore['00_Inbox/hello.md'].tags).toEqual(['인박스', '정리']);

		const history = getBatchState().history;
		expect(history).toHaveLength(1);
		expect(history[0].source).toBe('watch');
		expect(history[0].snapshots[0].movedFromPath).toBe('00_Inbox/hello.md');
		expect(history[0].snapshots[0].movedToPath).toBe('10_Processed/hello.md');
	});

	it('Auto-Apply 모드에서 즉시 수정·이동하며, 자가 수정 직후 modify 이벤트로 무한 루프가 발생하지 않는다', async () => {
		mockPlugin.settings.batchWatch!.rules = [
			makeRule({ executionMode: 'auto-apply', recipes: ['frontmatter'] }),
		];
		const chatSpy = vi.fn().mockResolvedValue({
			content: '{"tags": ["자동"], "description": "즉시 반영 요약"}',
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 0,
			selfCooldownMs: 5000,
			rateLimitRetryWaitMs: 0,
		});
		manager.init();

		const note = makeFile('00_Inbox/auto.md');
		fileObjs[note.path] = note;
		diskFiles[note.path] = '즉시 적용 모드 테스트를 위한 충분히 긴 노트 내용입니다.';
		fmStore[note.path] = {};

		emitVault('create', note);
		await flushAsync();

		expect(chatSpy).toHaveBeenCalledTimes(1);
		expect(fileObjs['10_Processed/auto.md']).toBeDefined();

		// 자가 수정·이동 직후 발생하는 modify 이벤트는 쿨다운으로 무시되어야 함
		emitVault('modify', note);
		await flushAsync();
		expect(chatSpy).toHaveBeenCalledTimes(1);
	});

	it('시작 유예 기간과 과거 mtime(Obsidian Sync 유입) 파일은 create 트리거를 무시한다', async () => {
		const chatSpy = vi.fn().mockResolvedValue({
			content: '{"tags": ["테스트"], "description": "요약"}',
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 5000,
			mtimeMaxAgeMs: 3000,
		});
		manager.init();

		// 1. 시작 유예 기간 중 create 무시
		const duringGrace = makeFile('00_Inbox/grace.md', Date.now());
		fileObjs[duringGrace.path] = duringGrace;
		diskFiles[duringGrace.path] = '유예 기간 테스트용 충분히 긴 마크다운 문서입니다.';
		emitVault('create', duringGrace);
		await flushAsync();
		expect(chatSpy).not.toHaveBeenCalled();

		// 2. 유예 종료 후에도 과거 mtime(Sync 다운로드) 파일 무시
		manager.destroy();
		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 0,
			mtimeMaxAgeMs: 3000,
		});
		manager.init();

		const syncedOld = makeFile('00_Inbox/synced.md', Date.now() - 60_000);
		fileObjs[syncedOld.path] = syncedOld;
		diskFiles[syncedOld.path] = '다른 기기에서 동기화되어 내려온 오래된 노트입니다.';
		emitVault('create', syncedOld);
		await flushAsync();
		expect(chatSpy).not.toHaveBeenCalled();
	});

	it('현재 활성 편집 중인 노트는 보류되었다가 다른 노트로 이동(file-open)하면 실행된다', async () => {
		const note = makeFile('00_Inbox/editing.md');
		const other = makeFile('Notes/other.md');
		fileObjs[note.path] = note;
		fileObjs[other.path] = other;
		diskFiles[note.path] = '사용자가 현재 편집 중인 충분히 긴 노트 본문입니다.';
		fmStore[note.path] = {};
		activeFile = note;

		const chatSpy = vi.fn().mockResolvedValue({
			content: '{"tags": ["편집후"], "description": "지연 실행 요약"}',
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 0,
			rateLimitRetryWaitMs: 0,
		});
		manager.init();

		emitVault('modify', note);
		await flushAsync();
		expect(chatSpy).not.toHaveBeenCalled();

		// 다른 노트로 포커스 이동
		emitWorkspace('file-open', other);
		await flushAsync();
		expect(chatSpy).toHaveBeenCalledTimes(1);
		expect(getBatchWatchState().stagedItems).toHaveLength(1);
	});

	it('단시간 대량 유입 시 버스트 차단(Circuit Breaker)이 동작하고, 일일 상한 및 destroy() 정리를 준수한다', async () => {
		mockPlugin.settings.batchWatch!.burstLimit = 3;
		mockPlugin.settings.batchWatch!.rules = [
			makeRule({ debounceSec: 1 }), // 버스트 취소 검증을 위해 1초 디바운스
		];
		const chatSpy = vi.fn().mockResolvedValue({
			content: '{"tags": ["t"], "description": "d"}',
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 0,
			burstWindowMs: 10000,
		});
		manager.init();

		expect(manager.isPathManagedForFrontmatter('00_Inbox/a.md')).toBe(true);
		expect(manager.isPathManagedForFrontmatter('Other/a.md')).toBe(false);

		for (const name of ['1.md', '2.md', '3.md']) {
			const f = makeFile(`00_Inbox/${name}`);
			fileObjs[f.path] = f;
			diskFiles[f.path] = '대량 유입 테스트 노트 본문입니다. 충분히 긴 내용입니다.';
			emitVault('create', f);
		}

		expect(
			getBatchWatchState().activityLog.some((l) => l.status === 'burst-paused'),
		).toBe(true);
		expect(chatSpy).not.toHaveBeenCalled();

		manager.destroy();
		expect(mockStatusBarEl.detach).toHaveBeenCalledTimes(1);
		for (const set of vaultListeners.values()) {
			expect(set.size).toBe(0);
		}
		for (const set of workspaceListeners.values()) {
			expect(set.size).toBe(0);
		}
	});

	it('일일 상한(dailyMaxItems) 도달 시 추가 자동감시 작업을 차단하고 daily-cap 로그를 기록한다', async () => {
		const { incrementDailyProcessed } = await import('../../../../core/store/batchWatchStore');
		mockPlugin.settings.batchWatch!.dailyMaxItems = 2;
		incrementDailyProcessed();
		incrementDailyProcessed();

		const chatSpy = vi.fn().mockResolvedValue({
			content: '{"tags": ["x"], "description": "y"}',
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 0,
			mtimeMaxAgeMs: 0,
		});
		manager.init();

		const f3 = makeFile('00_Inbox/third.md');
		fileObjs[f3.path] = f3;
		diskFiles[f3.path] = '일일 상한 초과 테스트 노트 본문입니다. 충분히 긴 내용입니다.';
		emitVault('create', f3);
		await flushAsync();

		expect(chatSpy).not.toHaveBeenCalled();
		expect(getBatchWatchState().stagedItems).toHaveLength(0);
		expect(
			getBatchWatchState().activityLog.some(
				(l) => l.status === 'daily-cap' && l.path === '00_Inbox/third.md',
			),
		).toBe(true);
	});

	it('runRuleNow 수동 실행, rejectStagedItem, approveAllStaged, setDeviceEnabled(false/true)가 정상 동작한다', async () => {
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"tags": ["수동"], "description": "요약"}',
			}),
		} as unknown as ReturnType<typeof createProvider>);

		const f1 = makeFile('00_Inbox/p1.md');
		const f2 = makeFile('00_Inbox/p2.md');
		fileObjs[f1.path] = f1;
		fileObjs[f2.path] = f2;
		diskFiles[f1.path] = '첫 번째 수동 스캔 테스트 본문입니다. 충분한 길이를 확보합니다.';
		diskFiles[f2.path] = '두 번째 수동 스캔 테스트 본문입니다. 충분한 길이를 확보합니다.';
		fmStore[f1.path] = {};
		fmStore[f2.path] = {};

		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 0,
			rateLimitRetryWaitMs: 0,
		});
		manager.init();

		// 1) runRuleNow 수동 스캔 -> 2건 staged
		const queuedCount = await manager.runRuleNow('rule-1');
		expect(queuedCount).toBe(2);
		await flushAsync(50);
		expect(getBatchWatchState().stagedItems).toHaveLength(2);

		// 2) rejectStagedItem 1건 거절 -> approveAllStaged 나머지 1건 일괄 수락
		const staged = getBatchWatchState().stagedItems;
		manager.rejectStagedItem(staged[0].id);
		expect(getBatchWatchState().stagedItems).toHaveLength(1);

		const approved = await manager.approveAllStaged();
		expect(approved).toBe(1);
		expect(getBatchWatchState().stagedItems).toHaveLength(0);

		// 3) setDeviceEnabled(false) 시 감시 리스너 중단, 다시 true로 켜면 재활성화
		manager.setDeviceEnabled(false);
		expect(getBatchWatchState().deviceWatchEnabled).toBe(false);
		expect(manager.isPathManagedForFrontmatter('00_Inbox/new.md')).toBe(false);
		const f3 = makeFile('00_Inbox/ignored-while-off.md');
		fileObjs[f3.path] = f3;
		diskFiles[f3.path] = '기기 감시 꺼짐 상태 테스트 본문입니다. 충분히 긴 내용입니다.';
		emitVault('create', f3);
		await flushAsync();
		expect(getBatchWatchState().stagedItems).toHaveLength(0);

		manager.setDeviceEnabled(true);
		expect(getBatchWatchState().deviceWatchEnabled).toBe(true);
		emitVault('create', f3);
		await flushAsync(50);
		expect(getBatchWatchState().stagedItems).toHaveLength(1);
	});

	it('interval 주기 스캔 타이머, 429 재시도, rename 시 기존 디바운스 취소가 동작한다', async () => {
		vi.useFakeTimers();

		const chatSpy = vi
			.fn()
			.mockRejectedValueOnce(new Error('HTTP 429 rate limit'))
			.mockResolvedValue({
				content: '{"tags": ["주기"], "description": "주기 스캔 요약"}',
			});
		vi.mocked(createProvider).mockReturnValue({
			chat: chatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		mockPlugin.settings.batchWatch!.rules = [
			makeRule({ triggerMode: 'interval', intervalMin: 1, debounceSec: 2 }),
		];

		const periodicFile = makeFile('00_Inbox/periodic.md');
		fileObjs[periodicFile.path] = periodicFile;
		diskFiles[periodicFile.path] = '주기 스캔 타이머 테스트용 충분히 긴 본문 내용입니다.';
		fmStore[periodicFile.path] = {};

		manager = new FolderWatchManager(mockPlugin, {
			startupGraceMs: 0,
			rateLimitRetryWaitMs: 0,
		});
		manager.init();

		// 1분 주기 타이머 도달 시 스캔 + 429 1회 재시도 후 staged 생성
		await vi.advanceTimersByTimeAsync(60_000);
		await vi.advanceTimersByTimeAsync(0);
		expect(chatSpy).toHaveBeenCalledTimes(2);
		expect(getBatchWatchState().stagedItems).toHaveLength(1);

		// rename 시 기존 debounce 타이머 취소 검증
		mockPlugin.settings.batchWatch!.rules = [
			makeRule({ triggerMode: 'on-create', debounceSec: 5 }),
		];
		manager.syncWatchers();
		const moving = makeFile('00_Inbox/before-move.md', Date.now());
		fileObjs[moving.path] = moving;
		diskFiles[moving.path] = '이름 변경 디바운스 취소 테스트용 본문입니다.';
		emitVault('create', moving);

		moving.path = 'Notes/after-move.md';
		emitVault('rename', moving, '00_Inbox/before-move.md');
		await vi.advanceTimersByTimeAsync(6000);
		// on-create 규칙의 5초 타이머가 취소되어 추가 chat 호출이 없어야 함
		expect(chatSpy).toHaveBeenCalledTimes(2);
	});
});
