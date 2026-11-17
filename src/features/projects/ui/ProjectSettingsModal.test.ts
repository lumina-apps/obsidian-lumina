import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { TFolder, moment } from 'obsidian';
import realMoment from 'moment';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import { createDefaultProject, type ProjectConfig } from '../../../shared/types/project.types';
import { initProjectStore } from '../../../core/store/projectStore';
import type LuminaPlugin from '../../../main';

describe('ProjectSettingsModal', () => {
	const momentMock = moment as unknown as Mock;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 17, 21, 0, 0));
		momentMock.mockImplementation((inp?: unknown) => realMoment(inp as Date));
	});

	afterEach(() => {
		vi.useRealTimers();
		momentMock.mockReset();
	});

	function createMockPlugin(overrides?: {
		historyPath?: string;
		historyFolderFormat?: string;
		existingPaths?: Record<string, unknown>;
	}) {
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		if (overrides?.historyPath !== undefined) settings.chat.historyPath = overrides.historyPath;
		if (overrides?.historyFolderFormat !== undefined) settings.chat.historyFolderFormat = overrides.historyFolderFormat;

		const defaultProj = createDefaultProject();
		settings.projects = { list: [defaultProj], activeProjectId: defaultProj.id };
		initProjectStore(settings.projects.list, settings.projects.activeProjectId);

		const existingPaths = overrides?.existingPaths ?? {};
		const createFolder = vi.fn().mockImplementation(async (path: string) => {
			const folder = new TFolder();
			folder.path = path;
			existingPaths[path] = folder;
			return folder;
		});
		const renameFile = vi.fn().mockImplementation(async (folder: TFolder, targetPath: string) => {
			if (folder.parent && Array.isArray(folder.parent.children)) {
				folder.parent.children = folder.parent.children.filter(c => c !== folder);
			}
			delete existingPaths[folder.path];
			folder.path = targetPath;
			existingPaths[targetPath] = folder;
		});
		const trashFile = vi.fn().mockImplementation(async (folder: TFolder) => {
			delete existingPaths[folder.path];
		});
		const rootFolder = new TFolder();
		rootFolder.path = '/';
		rootFolder.children = [];

		const app = {
			vault: {
				getRoot: vi.fn(() => rootFolder),
				getAbstractFileByPath: vi.fn((path: string) => existingPaths[path] ?? null),
				createFolder,
			},
			fileManager: {
				renameFile,
				trashFile,
			},
		};

		return {
			plugin: {
				app,
				settings,
				saveSettings: vi.fn().mockResolvedValue(undefined),
				refreshSettingTab: vi.fn(),
			} as unknown as LuminaPlugin,
			createFolder,
			renameFile,
			trashFile,
			existingPaths,
		};
	}

	it('미리보기에 정규화된 historyPath와 historyFolderFormat이 함께 반영된다', () => {
		const { plugin } = createMockPlugin({
			historyPath: '/MyChats/',
			historyFolderFormat: '{{YYYY}}/{{MM}}',
		});
		const workProj: ProjectConfig = {
			...createDefaultProject(),
			id: 'work',
			name: 'Work',
			historySubfolder: 'Work',
		};
		plugin.settings.projects.list.push(workProj);

		const modal = new ProjectSettingsModal(plugin, workProj);
		(modal as unknown as { app: unknown }).app = plugin.app;
		modal.onOpen();

		const guideEl = modal.contentEl.querySelector('.lumina-settings__desc-guide');
		expect(guideEl?.textContent).toContain('MyChats/Work/2026/11/');
	});

	it('새 프로젝트 저장 시 /// 입력은 빈 값 취급해 프로젝트명 기반 historySubfolder로 폴백하고 excludedPaths도 정규화한다', async () => {
		const { plugin } = createMockPlugin({ historyPath: '  /MyChats/  ' });
		const modal = new ProjectSettingsModal(plugin);
		(modal as unknown as { app: unknown }).app = plugin.app;
		modal.onOpen();

		const internals = modal as unknown as {
			projectName: string;
			historySubfolder: string;
			excludedPaths: Set<string>;
		};
		expect(internals.excludedPaths.has('MyChats')).toBe(true);

		internals.projectName = 'Work/Team';
		internals.historySubfolder = '///';
		await modal.saveProject();

		const created = plugin.settings.projects.list.find(p => p.name === 'Work/Team');
		expect(created?.historySubfolder).toBe('Work_Team');
	});

	it('moveHistoryFolder는 중첩 대상 경로로 이동 시 누락된 상위 폴더를 먼저 생성한다', async () => {
		const oldFolder = new TFolder();
		oldFolder.path = 'MyChats/Work';
		const { plugin, createFolder, renameFile } = createMockPlugin({
			historyPath: '/MyChats/',
			existingPaths: {
				'MyChats/Work': oldFolder,
			},
		});
		const workProj: ProjectConfig = {
			...createDefaultProject(),
			id: 'work',
			name: 'Work',
			historySubfolder: 'Work',
		};
		plugin.settings.projects.list.push(workProj);

		const modal = new ProjectSettingsModal(plugin, workProj);
		(modal as unknown as { app: unknown }).app = plugin.app;
		modal.onOpen();

		const internals = modal as unknown as { historySubfolder: string };
		internals.historySubfolder = 'Team/Work';
		await modal.saveProject();

		expect(createFolder).toHaveBeenCalledWith('MyChats');
		expect(createFolder).toHaveBeenCalledWith('MyChats/Team');
		expect(renameFile).toHaveBeenCalledWith(oldFolder, 'MyChats/Team/Work');
	});

	it('work -> work/team처럼 자기 자신의 하위 경로로 이동 시 임시 폴더를 경유해 안전하게 이동한다', async () => {
		const oldFolder = new TFolder();
		oldFolder.path = 'chatHistory/work';
		const { plugin, createFolder, renameFile, existingPaths } = createMockPlugin({
			historyPath: 'chatHistory',
			existingPaths: {
				'chatHistory/work': oldFolder,
			},
		});
		const workProj: ProjectConfig = {
			...createDefaultProject(),
			id: 'work',
			name: 'Work',
			historySubfolder: 'work',
		};
		plugin.settings.projects.list.push(workProj);

		const modal = new ProjectSettingsModal(plugin, workProj);
		(modal as unknown as { app: unknown }).app = plugin.app;
		modal.onOpen();

		const internals = modal as unknown as { historySubfolder: string };
		internals.historySubfolder = 'work/team';
		await modal.saveProject();

		expect(renameFile).toHaveBeenCalledTimes(2);
		expect(renameFile.mock.calls[0][1]).toMatch(/^chatHistory\/__lumina_move_/);
		expect(createFolder).toHaveBeenCalledWith('chatHistory/work');
		expect(renameFile.mock.calls[1][1]).toBe('chatHistory/work/team');
		expect(existingPaths['chatHistory/work/team']).toBe(oldFolder);
		expect(workProj.historySubfolder).toBe('work/team');
	});

	it('work/team -> work처럼 단일 빈 상위 폴더로 되돌릴 때 기존 빈 래퍼를 정리하고 이동한다', async () => {
		const leafFolder = new TFolder();
		leafFolder.path = 'chatHistory/work/team';
		const parentFolder = new TFolder();
		parentFolder.path = 'chatHistory/work';
		parentFolder.children = [leafFolder];
		const { plugin, trashFile, renameFile, existingPaths } = createMockPlugin({
			historyPath: 'chatHistory',
			existingPaths: {
				'chatHistory/work': parentFolder,
				'chatHistory/work/team': leafFolder,
			},
		});
		const workProj: ProjectConfig = {
			...createDefaultProject(),
			id: 'work',
			name: 'Work',
			historySubfolder: 'work/team',
		};
		plugin.settings.projects.list.push(workProj);

		const modal = new ProjectSettingsModal(plugin, workProj);
		(modal as unknown as { app: unknown }).app = plugin.app;
		modal.onOpen();

		const internals = modal as unknown as { historySubfolder: string };
		internals.historySubfolder = 'work';
		await modal.saveProject();

		expect(trashFile).toHaveBeenCalledWith(parentFolder);
		expect(renameFile.mock.calls[1][1]).toBe('chatHistory/work');
		expect(existingPaths['chatHistory/work']).toBe(leafFolder);
		expect(workProj.historySubfolder).toBe('work');
	});

	it('폴더 이동이 실패하거나 대상 폴더가 이미 존재하면 project.historySubfolder를 기존 값으로 유지한다', async () => {
		const oldFolder = new TFolder();
		oldFolder.path = 'chatHistory/work';
		const conflictFolder = new TFolder();
		conflictFolder.path = 'chatHistory/other';
		const { plugin, renameFile } = createMockPlugin({
			historyPath: 'chatHistory',
			existingPaths: {
				'chatHistory/work': oldFolder,
				'chatHistory/other': conflictFolder,
			},
		});
		const workProj: ProjectConfig = {
			...createDefaultProject(),
			id: 'work',
			name: 'Work',
			historySubfolder: 'work',
		};
		plugin.settings.projects.list.push(workProj);

		const modal = new ProjectSettingsModal(plugin, workProj);
		(modal as unknown as { app: unknown }).app = plugin.app;
		modal.onOpen();

		const internals = modal as unknown as { historySubfolder: string };
		internals.historySubfolder = 'other';
		await modal.saveProject();

		expect(renameFile).not.toHaveBeenCalled();
		expect(workProj.historySubfolder).toBe('work');
	});

	it('Team/Work -> Other처럼 중첩 경로에서 다른 경로로 이동 시 빈 상위 폴더(Team)를 자동 정리한다', async () => {
		const rootHistory = new TFolder();
		rootHistory.path = 'chatHistory';
		const teamFolder = new TFolder();
		teamFolder.path = 'chatHistory/Team';
		teamFolder.parent = rootHistory;
		const workFolder = new TFolder();
		workFolder.path = 'chatHistory/Team/Work';
		workFolder.parent = teamFolder;
		teamFolder.children = [workFolder];
		rootHistory.children = [teamFolder];

		const { plugin, trashFile, renameFile, existingPaths } = createMockPlugin({
			historyPath: 'chatHistory',
			existingPaths: {
				chatHistory: rootHistory,
				'chatHistory/Team': teamFolder,
				'chatHistory/Team/Work': workFolder,
			},
		});
		const workProj: ProjectConfig = {
			...createDefaultProject(),
			id: 'work',
			name: 'Work',
			historySubfolder: 'Team/Work',
		};
		plugin.settings.projects.list.push(workProj);

		const modal = new ProjectSettingsModal(plugin, workProj);
		(modal as unknown as { app: unknown }).app = plugin.app;
		modal.onOpen();

		const internals = modal as unknown as { historySubfolder: string };
		internals.historySubfolder = 'Other';
		await modal.saveProject();

		expect(renameFile).toHaveBeenCalledWith(workFolder, 'chatHistory/Other');
		expect(trashFile).toHaveBeenCalledWith(teamFolder);
		expect(trashFile).not.toHaveBeenCalledWith(rootHistory);
		expect(existingPaths['chatHistory/Team']).toBeUndefined();
		expect(existingPaths['chatHistory/Other']).toBe(workFolder);
	});
});
