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
			plugins: {
				manifests: {
					lumina: { version: '1.4.7' },
				},
			},
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

	describe('Settings search', () => {
		it('renders search bar with input and icon', () => {
			tab.display();

			const searchBar = container.querySelector('.lumina-settings__search');
			expect(searchBar).not.toBeNull();

			const input = searchBar?.querySelector<HTMLInputElement>('input.lumina-settings__search-input');
			expect(input).not.toBeNull();
			expect(input?.placeholder).toBeTruthy();

			const icon = searchBar?.querySelector('.lumina-settings__search-icon');
			expect(icon).not.toBeNull();
		});

		it('filters settings across all tabs when searchQuery is set', () => {
			tab.display();
			tab.searchQuery = 'debug';
			tab.refreshDisplay();

			const searchSections = container.querySelectorAll('.lumina-settings__search-section');
			expect(searchSections.length).toBeGreaterThan(0);

			const nav = container.querySelector('.lumina-settings__nav');
			expect(nav?.classList.contains('lumina-settings__nav--search-active')).toBe(true);

			const visibleItems = Array.from(
				container.querySelectorAll<HTMLElement>('.setting-item')
			).filter(el => el.style.display !== 'none');

			const visibleNonHeadingItems = visibleItems.filter(
				el => !el.classList.contains('setting-item-heading') &&
					!el.classList.contains('lumina-settings__section-heading')
			);

			expect(visibleNonHeadingItems.length).toBeGreaterThan(0);
			for (const item of visibleNonHeadingItems) {
				const text = (item.textContent ?? '').toLowerCase();
				expect(text).toContain('debug');
			}
		});

		it('matches model settings when searching with "model" or "모델"', () => {
			tab.display();

			// 1. Search with English "model"
			tab.searchQuery = 'model';
			tab.refreshDisplay();

			const visibleItemsEn = Array.from(
				container.querySelectorAll<HTMLElement>('.setting-item')
			).filter(el => el.style.display !== 'none');
			expect(visibleItemsEn.length).toBeGreaterThan(0);

			// 2. Search with Korean "모델"
			tab.searchQuery = '모델';
			tab.refreshDisplay();

			const visibleItemsKo = Array.from(
				container.querySelectorAll<HTMLElement>('.setting-item')
			).filter(el => el.style.display !== 'none');
			expect(visibleItemsKo.length).toBeGreaterThan(0);
		});

		it('shows no results message for unmatched query', () => {
			tab.display();
			tab.searchQuery = 'xyznonexistentquery999';
			tab.refreshDisplay();

			const emptyMsg = container.querySelector('.lumina-settings__search-empty');
			expect(emptyMsg).not.toBeNull();
			expect(emptyMsg?.textContent).toContain('xyznonexistentquery999');

			const visibleSections = Array.from(
				container.querySelectorAll<HTMLElement>('.lumina-settings__search-section')
			).filter(el => el.style.display !== 'none');
			expect(visibleSections.length).toBe(0);
		});

		it('restores normal tab view when search is cleared', () => {
			tab.display();
			tab.searchQuery = 'debug';
			tab.refreshDisplay();

			expect(container.querySelectorAll('.lumina-settings__search-section').length).toBeGreaterThan(0);

			tab.searchQuery = '';
			tab.refreshDisplay();

			expect(container.querySelector('.lumina-settings__search-section')).toBeNull();
			expect(container.querySelector('.lumina-settings__body')).not.toBeNull();

			const nav = container.querySelector('.lumina-settings__nav');
			expect(nav?.classList.contains('lumina-settings__nav--search-active')).toBe(false);
		});

		it('performs debounced search on input event', () => {
			vi.useFakeTimers();
			try {
				tab.display();
				const input = container.querySelector<HTMLInputElement>('.lumina-settings__search-input')!;
				expect(input).not.toBeNull();

				input.value = 'debug';
				input.dispatchEvent(new Event('input'));

				// Before debounce fires
				expect(tab.searchQuery).toBe('');

				// Advance debounce timer (150ms)
				vi.advanceTimersByTime(200);

				expect(tab.searchQuery).toBe('debug');
				const visibleItems = Array.from(
					container.querySelectorAll<HTMLElement>('.setting-item')
				).filter(el => el.style.display !== 'none');
				expect(visibleItems.length).toBeGreaterThan(0);
			} finally {
				vi.useRealTimers();
			}
		});

		it('clears search when Escape key is pressed in search input', () => {
			tab.display();
			tab.searchQuery = 'debug';
			tab.refreshDisplay();

			const input = container.querySelector<HTMLInputElement>('.lumina-settings__search-input')!;
			expect(input.value).toBe('debug');

			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

			expect(tab.searchQuery).toBe('');
			expect(input.value).toBe('');
			expect(container.querySelector('.lumina-settings__search-section')).toBeNull();
		});

		it('clears search when clear button is clicked', () => {
			tab.display();
			tab.searchQuery = 'debug';
			tab.refreshDisplay();

			const clearBtn = container.querySelector<HTMLButtonElement>('.lumina-settings__search-clear')!;
			expect(clearBtn.classList.contains('is-hidden')).toBe(false);

			clearBtn.click();

			expect(tab.searchQuery).toBe('');
			expect(container.querySelector('.lumina-settings__search-section')).toBeNull();
		});
	});
});
