import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LuminaSettingTab } from './settingTab';
import { DEFAULT_SETTINGS } from './defaultSettings';
import { initProjectStore } from '../store/projectStore';
import type LuminaPlugin from '../../main';
import type { App } from 'obsidian';

describe('LuminaSettingTab scroll preservation', () => {
	let mockApp: App;
	let mockPlugin: LuminaPlugin;
	let tab: LuminaSettingTab;
	let container: HTMLElement;

	beforeEach(() => {
		mockApp = {
			vault: {},
			workspace: {},
		} as unknown as App;
		mockPlugin = {
			app: mockApp,
			settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
			saveSettings: vi.fn().mockResolvedValue(undefined),
			refreshLocales: vi.fn(),
			commandManager: {},
		} as unknown as LuminaPlugin;
		initProjectStore(mockPlugin.settings.projects.list, mockPlugin.settings.projects.activeProjectId);
		tab = new LuminaSettingTab(mockApp, mockPlugin);
		container = document.createElement('div');
		tab.containerEl = container;
	});

	it('preserves scrollTop when refreshDisplay is called with preserveScroll = true', () => {
		tab.display();

		// Simulate user scrolling down
		container.scrollTop = 350;

		// Re-render with default preserveScroll (true)
		tab.refreshDisplay();

		// ScrollTop should be restored
		expect(container.scrollTop).toBe(350);
	});

	it('resets scrollTop when refreshDisplay is called with preserveScroll = false', () => {
		tab.display();

		// Simulate user scrolling down
		container.scrollTop = 350;

		// Re-render with preserveScroll = false (e.g. tab switch)
		tab.refreshDisplay(false);

		expect(container.scrollTop).toBe(0);
	});

	it('preserves scroll position when toggling advanced settings', () => {
		tab.display();
		container.scrollTop = 200;

		// Find the advanced button in nav
		const advBtn = container.querySelector('.lumina-settings__nav-btn--advanced') as HTMLButtonElement | null;
		expect(advBtn).not.toBeNull();

		advBtn?.click();

		expect(tab.showAdvanced).toBe(true);
		expect(container.scrollTop).toBe(200);
	});

	it('resets scroll position when switching tabs', () => {
		tab.display();
		container.scrollTop = 400;

		// Find a different tab button in nav (e.g. Chat)
		const navBtns = container.querySelectorAll<HTMLButtonElement>('.lumina-settings__nav-btn');
		const chatBtn = Array.from(navBtns).find(btn => !btn.classList.contains('is-active') && !btn.classList.contains('lumina-settings__nav-btn--advanced'));
		expect(chatBtn).toBeDefined();

		chatBtn?.click();

		expect(container.scrollTop).toBe(0);
	});

	it('preserves scroll position when saveAndSync(true) triggers delayed refresh', async () => {
		vi.useFakeTimers();
		try {
			tab.display();
			container.scrollTop = 500;

			await tab.saveAndSync(true);

			vi.advanceTimersByTime(300);

			expect(container.scrollTop).toBe(500);
		} finally {
			vi.useRealTimers();
		}
	});
});
