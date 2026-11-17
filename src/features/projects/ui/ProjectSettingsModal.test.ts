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
		const renameFile = vi.fn().mockResolvedValue(undefined);
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
});
