import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { moment } from 'obsidian';
import realMoment from 'moment';
import { renderChatHistorySection } from './ChatHistorySection';
import { DEFAULT_SETTINGS } from '../../defaultSettings';
import { initProjectStore } from '../../../store/projectStore';
import { createDefaultProject } from '../../../../shared/types/project.types';
import type { LuminaSettingTab } from '../../settingTab';

describe('ChatHistorySection', () => {
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

	function createMockTab(overrides?: { historyPath?: string; historyFolderFormat?: string }) {
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		if (overrides?.historyPath !== undefined) settings.chat.historyPath = overrides.historyPath;
		if (overrides?.historyFolderFormat !== undefined) settings.chat.historyFolderFormat = overrides.historyFolderFormat;

		return {
			plugin: { settings },
			sectionHeading: vi.fn(),
			saveAndSync: vi.fn().mockResolvedValue(undefined),
			refreshDisplay: vi.fn(),
		} as unknown as LuminaSettingTab;
	}

	it('Default 프로젝트에서는 전역 미리보기만 표시하고 활성 프로젝트 보조 미리보기는 숨긴다', () => {
		const defaultProj = createDefaultProject();
		initProjectStore([defaultProj], defaultProj.id);

		const el = document.createElement('div');
		const tab = createMockTab({ historyPath: '/MyChats/', historyFolderFormat: '{{YYYY}}/{{MM}}' });
		renderChatHistorySection(tab, el);

		const guides = Array.from(el.querySelectorAll<HTMLElement>('.lumina-settings__desc-guide'));
		expect(guides).toHaveLength(2);
		expect(guides[0].textContent).toContain('MyChats/2026/11/');
		expect(guides[1].style.display).toBe('none');

		const warnings = Array.from(el.querySelectorAll<HTMLElement>('.lumina-settings__desc-warning'));
		expect(warnings.every(w => w.style.display === 'none')).toBe(true);
	});

	it('별도 프로젝트가 활성 상태이면 전역 미리보기와 함께 활성 프로젝트 적용 경로를 표시한다', () => {
		const defaultProj = createDefaultProject();
		const workProj = { ...createDefaultProject(), id: 'work', name: 'Work', historySubfolder: 'Work' };
		initProjectStore([defaultProj, workProj], 'work');

		const el = document.createElement('div');
		const tab = createMockTab({ historyPath: 'chatHistory', historyFolderFormat: '{{YYYY}}/{{MM}}' });
		renderChatHistorySection(tab, el);

		const guides = Array.from(el.querySelectorAll<HTMLElement>('.lumina-settings__desc-guide'));
		expect(guides[0].textContent).toContain('chatHistory/2026/11/');
		expect(guides[1].style.display).toBe('');
		expect(guides[1].textContent).toContain('Work');
		expect(guides[1].textContent).toContain('chatHistory/Work/2026/11/');
	});

	it('historyPath에 .. 또는 금지 문자가 포함되면 정제 경고를 표시하고 정제된 미리보기를 보여준다', () => {
		const defaultProj = createDefaultProject();
		initProjectStore([defaultProj], defaultProj.id);

		const el = document.createElement('div');
		const tab = createMockTab({ historyPath: '../My:Chats', historyFolderFormat: '{{YYYY}}' });
		renderChatHistorySection(tab, el);

		const guides = Array.from(el.querySelectorAll<HTMLElement>('.lumina-settings__desc-guide'));
		expect(guides[0].textContent).toContain('My_Chats/2026/');

		const warnings = Array.from(el.querySelectorAll<HTMLElement>('.lumina-settings__desc-warning'));
		expect(warnings[0].style.display).toBe('');
		expect(warnings[0].textContent).not.toBe('');
	});
});
