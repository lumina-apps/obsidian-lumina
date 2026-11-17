import { describe, it, expect, vi } from 'vitest';
import { renderRagTab } from './RagTab';
import { DEFAULT_SETTINGS } from '../defaultSettings';
import { createDefaultProject } from '../../../shared/types/project.types';
import type { LuminaSettingTab } from '../settingTab';

describe('RagTab project history path display', () => {
	function createMockTab(historyPath: string) {
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		settings.chat.historyPath = historyPath;
		const defaultProj = createDefaultProject();
		const workProj = { ...createDefaultProject(), id: 'work', name: 'Work', historySubfolder: 'Work' };
		settings.projects = { list: [defaultProj, workProj], activeProjectId: defaultProj.id };

		return {
			plugin: { settings, app: { vault: { configDir: '.obsidian' } } },
			app: { vault: { configDir: '.obsidian' } },
			showAdvanced: false,
			infoBox: vi.fn(),
			sectionHeading: vi.fn(),
			advancedLabel: vi.fn(),
			saveAndSync: vi.fn().mockResolvedValue(undefined),
			refreshDisplay: vi.fn(),
		} as unknown as LuminaSettingTab;
	}

	it('전역 historyPath가 공백이거나 비어 있을 때 Chat History가 아닌 chatHistory 기준으로 표시한다', () => {
		const el = document.createElement('div');
		renderRagTab(createMockTab('   '), el);

		const descs = Array.from(el.querySelectorAll('.lumina-feature-card .setting-item-description'))
			.map(node => node.textContent ?? '');
		expect(descs[1]).toContain('chatHistory/Work');
		expect(descs[1]).not.toContain('Chat History');
	});

	it('전역 historyPath 앞뒤 슬래시가 있어도 이중 슬래시 없이 정규화해 표시한다', () => {
		const el = document.createElement('div');
		renderRagTab(createMockTab('/MyChats/'), el);

		const descs = Array.from(el.querySelectorAll('.lumina-feature-card .setting-item-description'))
			.map(node => node.textContent ?? '');
		expect(descs[1]).toContain('MyChats/Work');
		expect(descs[1]).not.toContain('//');
		expect(descs[1]).not.toContain(': /MyChats');
	});
});
