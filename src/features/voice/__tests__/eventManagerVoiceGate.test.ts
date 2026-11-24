import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, Menu, type EditorSuggestContext } from 'obsidian';

vi.mock('obsidian', () => ({
	Platform: { isMobile: false, isTablet: false, isDesktop: true },
	TFile: class TFile {
		path = '';
		name = '';
		basename = '';
		extension = 'md';
	},
	TFolder: class TFolder {
		path = '';
		name = '';
	},
	Notice: class Notice {},
	Menu: class Menu {},
	MenuItem: class MenuItem {},
	MarkdownView: class MarkdownView {},
	EditorSuggest: class EditorSuggest {
		app: unknown;
		constructor(app: unknown) {
			this.app = app;
		}
	},
}));

import { EventManager } from '../../../core/events/eventManager';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import { resetEntitlementState, setEntitlementState } from '../../../core/store/entitlementStore';
import { InlineAISuggest } from '../../editor/inlineSuggest';
import type LuminaPlugin from '../../../main';

describe('EventManager & InlineAISuggest Voice-to-Note 은닉 게이트', () => {
	beforeEach(() => {
		resetEntitlementState();
	});

	afterEach(() => {
		resetEntitlementState();
		vi.restoreAllMocks();
	});

	it('voice-note 권한이 꺼져 있으면 .m4a 우클릭 메뉴에 아무 항목도 추가하지 않는다', () => {
		let fileMenuCb: ((menu: Menu, file: unknown) => void) | undefined;
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		settings.misc.contextMenuEnabled = true;

		const plugin = {
			settings,
			registerEvent: vi.fn(),
			app: {
				workspace: {
					on: vi.fn((eventName: string, cb: (menu: Menu, file: unknown) => void) => {
						if (eventName === 'file-menu') {
							fileMenuCb = cb;
						}
						return {};
					}),
				},
			},
			ensureVoiceNoteManager: vi.fn(),
		} as unknown as LuminaPlugin;

		const em = new EventManager(plugin);
		em.registerEvents();
		expect(fileMenuCb).toBeDefined();

		const audioFile = new TFile();
		audioFile.path = 'Recordings/meeting.m4a';
		audioFile.extension = 'm4a';

		// 1. 비활성(무료) 상태: 메뉴 항목 0개
		const addItemLocked = vi.fn();
		fileMenuCb?.({ addItem: addItemLocked } as unknown as Menu, audioFile);
		expect(addItemLocked).not.toHaveBeenCalled();

		// 2. 활성(Pro) 상태: .m4a 파일에 메뉴 항목 1개 추가
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['voice-note']),
		});
		const addItemUnlocked = vi.fn();
		fileMenuCb?.({ addItem: addItemUnlocked } as unknown as Menu, audioFile);
		expect(addItemUnlocked).toHaveBeenCalledTimes(1);

		// 3. 비-오디오(.md) 파일에는 voice-note 메뉴가 추가되지 않음
		const mdFile = new TFile();
		mdFile.path = 'Notes/hello.md';
		mdFile.extension = 'md';
		const addItemMd = vi.fn();
		fileMenuCb?.({ addItem: addItemMd } as unknown as Menu, mdFile);
		expect(addItemMd).not.toHaveBeenCalled();
	});

	it('editor-menu(에디터 우클릭)에서도 voice-note 활성 시에만 녹음 항목을 노출한다', () => {
		let editorMenuCb:
			| ((menu: Menu, editor: { getSelection: () => string }, view: { file: TFile | null }) => void)
			| undefined;
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		settings.misc.contextMenuEnabled = true;

		const plugin = {
			settings,
			registerEvent: vi.fn(),
			app: {
				workspace: {
					getActiveFile: () => null,
					on: vi.fn((eventName: string, cb: typeof editorMenuCb) => {
						if (eventName === 'editor-menu') {
							editorMenuCb = cb;
						}
						return {};
					}),
				},
			},
			ensureVoiceNoteManager: vi.fn().mockResolvedValue(null),
		} as unknown as LuminaPlugin;

		const em = new EventManager(plugin);
		em.registerEvents();
		expect(editorMenuCb).toBeDefined();

		const collectSubIcons = (): string[] => {
			const icons: string[] = [];
			const fakeMenu = {
				addItem: (cb: (item: unknown) => void) => {
					const subMenu = {
						addItem: (subCb: (sub: unknown) => void) => {
							const subItem = {
								setTitle: () => subItem,
								setIcon: (ic: string) => {
									icons.push(ic);
									return subItem;
								},
								onClick: () => subItem,
							};
							subCb(subItem);
						},
						addSeparator: () => {},
					};
					cb({
						setTitle: () => ({ setIcon: () => {} }),
						setIcon: () => {},
						setSubmenu: () => subMenu,
					});
				},
			} as unknown as Menu;
			editorMenuCb?.(fakeMenu, { getSelection: () => '' }, { file: null });
			return icons;
		};

		// 비활성 시 lumina-voice-note 아이콘 없음
		expect(collectSubIcons()).not.toContain('lumina-voice-note');

		// 활성 시 lumina-voice-note 아이콘 포함
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['voice-note']),
		});
		expect(collectSubIcons()).toContain('lumina-voice-note');
	});

	it('에디터 /ai 인라인 서제스트에서도 voice-note 활성 시에만 녹음 액션을 제안하고 실행한다', () => {
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		settings.connections.quickActionProviderId = 'p1';
		settings.connections.quickActionModelId = 'm1';

		const ensureVoiceNoteManager = vi.fn().mockResolvedValue({ toggleRecording: vi.fn() });
		const plugin = {
			settings,
			app: {},
			ensureVoiceNoteManager,
		} as unknown as LuminaPlugin;

		const suggest = new InlineAISuggest(plugin);
		const ctx = { query: '' } as unknown as EditorSuggestContext;

		// 1. 비활성 시 __voice_note__ 미포함
		expect(suggest.getSuggestions(ctx).some((a) => a.id === '__voice_note__')).toBe(false);

		// 2. 활성 시 __voice_note__ 포함 및 빈 줄에서도 즉시 실행
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['voice-note']),
		});
		const list = suggest.getSuggestions(ctx);
		const voiceAction = list.find((a) => a.id === '__voice_note__');
		expect(voiceAction).toBeDefined();

		(suggest as unknown as { context: unknown }).context = {
			editor: {
				focus: vi.fn(),
				replaceRange: vi.fn(),
				getLine: () => '',
				getSelection: () => '',
			},
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 3 },
		};
		suggest.selectSuggestion(voiceAction!, new MouseEvent('click'));
		expect(ensureVoiceNoteManager).toHaveBeenCalledTimes(1);
	});
});
