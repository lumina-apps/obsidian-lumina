import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import type LuminaPlugin from '../../../../main';
import { createProvider } from '../../../../core/llm-providers';
import { DEFAULT_SETTINGS } from '../../../../core/settings/defaultSettings';
import type { FolderMoveConfig } from '../../../../shared/types/batchWatch.types';
import {
	executeSafeFileMove,
	resolveConflictTargetPath,
	resolveMoveTargetPath,
	validateMoveDestination,
} from '../folderMover';

vi.mock('../../../../core/llm-providers', () => ({
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
		stat: { ctime: 0, mtime: Date.now(), size },
	});
}

function baseMoveConfig(overrides: Partial<FolderMoveConfig> = {}): FolderMoveConfig {
	return {
		mode: 'fixed',
		fixedTargetFolder: 'Archive',
		tagMappings: [],
		aiCandidateFolders: [],
		fallbackFolder: '',
		conflictPolicy: 'rename-suffix',
		createFolderIfMissing: true,
		...overrides,
	};
}

describe('folderMover', () => {
	let fileObjs: Record<string, TFile>;
	let existingFolders: Set<string>;
	let diskFiles: Record<string, string>;
	let fmStore: Record<string, Record<string, unknown>>;
	let inlineTagsStore: Record<string, string[]>;
	let mockApp: App;
	let mockPlugin: LuminaPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		const inboxNote = makeFile('00_Inbox/note.md');
		fileObjs = { '00_Inbox/note.md': inboxNote };
		existingFolders = new Set(['00_Inbox']);
		diskFiles = {
			'00_Inbox/note.md':
				'프로젝트 회의록과 다음 주 배포 일정에 대한 상세한 정리 노트입니다. 충분한 길이를 가집니다.',
		};
		fmStore = { '00_Inbox/note.md': {} };
		inlineTagsStore = {};

		mockApp = {
			vault: {
				configDir: '.obsidian',
				getAbstractFileByPath: (path: string) => fileObjs[path] ?? null,
				read: vi.fn(async (file: TFile) => diskFiles[file.path] ?? ''),
				createFolder: vi.fn(async (folderPath: string) => {
					existingFolders.add(folderPath);
				}),
			},
			metadataCache: {
				getFileCache: (file: TFile) => ({
					frontmatter: fmStore[file.path] ?? {},
					tags: (inlineTagsStore[file.path] ?? []).map((tag) => ({ tag })),
				}),
			},
			fileManager: {
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
		mockPlugin = {
			app: mockApp,
			settings,
		} as unknown as LuminaPlugin;
	});

	it('경로 순회(..), 숨김/시스템 폴더(.obsidian), 제외 폴더, 소스 폴더 순환 이동을 차단한다', () => {
		expect(validateMoveDestination('../secret').valid).toBe(false);
		expect(
			validateMoveDestination('.obsidian/plugins', { configDir: '.obsidian' }).valid,
		).toBe(false);
		expect(
			validateMoveDestination('backups/2026', { excludedPaths: ['backups'] }).valid,
		).toBe(false);
		expect(
			validateMoveDestination('00_Inbox', {
				disallowedSourceFolder: '00_Inbox',
				includeSubfolders: false,
			}).valid,
		).toBe(false);
		expect(
			validateMoveDestination('00_Inbox/sub', {
				disallowedSourceFolder: '00_Inbox',
				includeSubfolders: true,
			}).valid,
		).toBe(false);

		const ok = validateMoveDestination('Projects/Active', {
			excludedPaths: ['backups'],
			configDir: '.obsidian',
			disallowedSourceFolder: '00_Inbox',
		});
		expect(ok.valid).toBe(true);
		expect(ok.normalizedFolder).toBe('Projects/Active');
	});

	it('고정 폴더 이동(fixed)과 이름 충돌 정책(rename-suffix / skip)을 처리한다', async () => {
		fileObjs['Archive/note.md'] = makeFile('Archive/note.md');
		const cfgRename = baseMoveConfig({ fixedTargetFolder: 'Archive', conflictPolicy: 'rename-suffix' });
		const resRename = await resolveMoveTargetPath(
			mockApp,
			mockPlugin,
			fileObjs['00_Inbox/note.md'],
			cfgRename,
		);
		expect(resRename.targetPath).toBe('Archive/note (1).md');

		const cfgSkip = baseMoveConfig({ fixedTargetFolder: 'Archive', conflictPolicy: 'skip' });
		const resSkip = await resolveMoveTargetPath(
			mockApp,
			mockPlugin,
			fileObjs['00_Inbox/note.md'],
			cfgSkip,
		);
		expect(resSkip.targetPath).toBeNull();
		expect(resSkip.skipReason).toBe('target-exists');

		expect(
			resolveConflictTargetPath(mockApp, 'Archive/note.md', 'rename-suffix'),
		).toBe('Archive/note (1).md');
	});

	it('태그 매핑 이동(by-tag) 시 선행 레시피의 effectiveTags와 하위 태그 접두사를 우선 매칭한다', async () => {
		const cfg = baseMoveConfig({
			mode: 'by-tag',
			tagMappings: [
				{ tag: 'meeting', targetFolder: 'Meetings' },
				{ tag: 'idea', targetFolder: 'Ideas' },
			],
			fallbackFolder: 'Misc',
		});

		// 메타데이터 캐시 반영 전이라도 effectiveTags가 전달되면 즉시 매칭
		const res = await resolveMoveTargetPath(
			mockApp,
			mockPlugin,
			fileObjs['00_Inbox/note.md'],
			cfg,
			{ effectiveTags: ['meeting/weekly'] },
		);
		expect(res.targetPath).toBe('Meetings/note.md');
		expect(res.reason).toBe('#meeting');

		// 미일치 시 fallbackFolder 사용
		const resFallback = await resolveMoveTargetPath(
			mockApp,
			mockPlugin,
			fileObjs['00_Inbox/note.md'],
			cfg,
			{ effectiveTags: ['other'] },
		);
		expect(resFallback.targetPath).toBe('Misc/note.md');
		expect(resFallback.reason).toBe('fallback');
	});

	it('AI 자동 분류(ai-route)는 허용된 후보 폴더 화이트리스트 밖의 경로(환각)를 거부하고 폴백 또는 스킵한다', async () => {
		const cfg = baseMoveConfig({
			mode: 'ai-route',
			aiCandidateFolders: ['Projects/Work', 'Areas/Health'],
			fallbackFolder: 'Archive/Unsorted',
		});

		// 1. 허용 목록 외 폴더 반환 시 환각 차단 -> 폴백 사용
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"folder": "Secret/NewFolder", "reason": "임의 생성 폴더"}',
				usage: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
			}),
		} as unknown as ReturnType<typeof createProvider>);

		const resHallucinated = await resolveMoveTargetPath(
			mockApp,
			mockPlugin,
			fileObjs['00_Inbox/note.md'],
			cfg,
		);
		expect(resHallucinated.targetPath).toBe('Archive/Unsorted/note.md');

		// 2. 허용 목록 내 폴더 선택 시 정상 라우팅 + enum 스키마 전달 검증
		const matchedChatSpy = vi.fn().mockResolvedValue({
			content: '{"folder": "projects/work", "reason": "업무 일정 노트입니다."}',
			usage: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: matchedChatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		const resMatched = await resolveMoveTargetPath(
			mockApp,
			mockPlugin,
			fileObjs['00_Inbox/note.md'],
			cfg,
		);
		expect(resMatched.targetPath).toBe('Projects/Work/note.md');
		expect(resMatched.reason).toBe('업무 일정 노트입니다.');
		expect(matchedChatSpy).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				reasoning: { effort: 'off' },
				responseFormat: expect.objectContaining({
					type: 'json_schema',
					jsonSchema: expect.objectContaining({
						name: 'folder_route_classification',
						schema: expect.objectContaining({
							properties: expect.objectContaining({
								folder: { type: 'string', enum: ['Projects/Work', 'Areas/Health', 'NONE'] },
							}),
						}),
					}),
				}),
			}),
		);

		// 3. 후보 폴더가 50개를 초과하면 enum을 생략하고 일반 string으로 스키마를 생성한다
		const manyFolders = Array.from({ length: 55 }, (_, i) => `Folder_${i + 1}`);
		const manyChatSpy = vi.fn().mockResolvedValue({
			content: '{"folder": "Folder_1", "reason": "분류 완료"}',
			usage: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: manyChatSpy,
		} as unknown as ReturnType<typeof createProvider>);

		await resolveMoveTargetPath(
			mockApp,
			mockPlugin,
			fileObjs['00_Inbox/note.md'],
			baseMoveConfig({ mode: 'ai-route', aiCandidateFolders: manyFolders }),
		);
		const manyOpts = manyChatSpy.mock.calls[0]?.[1] as {
			responseFormat?: { jsonSchema?: { schema?: { properties?: { folder?: Record<string, unknown> } } } };
		};
		expect(manyOpts.responseFormat?.jsonSchema?.schema?.properties?.folder).toEqual({ type: 'string' });
	});

	it('executeSafeFileMove는 부모 폴더를 생성한 뒤 fileManager.renameFile을 호출한다', async () => {
		const file = fileObjs['00_Inbox/note.md'];
		const moved = await executeSafeFileMove(mockApp, file, 'Projects/Work/note.md', {
			conflictPolicy: 'rename-suffix',
			createFolderIfMissing: true,
		});

		expect(moved).toEqual({
			movedFromPath: '00_Inbox/note.md',
			movedToPath: 'Projects/Work/note.md',
		});
		expect(mockApp.vault.createFolder).toHaveBeenCalledWith('Projects/Work');
		expect(mockApp.fileManager.renameFile).toHaveBeenCalledWith(file, 'Projects/Work/note.md');
	});
});
