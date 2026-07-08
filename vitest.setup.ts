import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// ── Obsidian API Global Mock ──
// Node/jsdom 환경에는 obsidian 모듈이 존재하지 않으므로,
// import { App, Plugin, Notice, ... } from 'obsidian' 호출 시
// 에러가 발생하지 않도록 전체 모듈을 스텁으로 교체한다.

vi.mock('obsidian', () => {
	const mockNotice = {
		setMessage: vi.fn(),
		hide: vi.fn(),
		noticeEl: document.createElement('div'),
	};

	const mockVault = {
		read: vi.fn(),
		readRaw: vi.fn(),
		create: vi.fn(),
		modify: vi.fn(),
		delete: vi.fn(),
		getAbstractFileByPath: vi.fn(),
		getMarkdownFiles: vi.fn(),
		on: vi.fn(),
	};

	const mockWorkspace = {
		getActiveViewOfType: vi.fn(),
		getActiveFile: vi.fn(),
		getLeaf: vi.fn(),
		onLayoutReady: vi.fn((cb: () => void) => cb()),
		on: vi.fn(),
		offref: vi.fn(),
	};

	const mockScope = {
		register: vi.fn(),
	};

	const mockApp = {
		vault: mockVault,
		workspace: mockWorkspace,
		keymap: {
			pushScope: vi.fn(() => mockScope),
			popScope: vi.fn(),
		},
	};



	return {
		App: vi.fn(() => mockApp),
		Plugin: class {
			app = mockApp;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addCommand(_command: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addSettingTab(_tab: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			registerView(_type: string, _viewCreator: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			registerExtensions(_extensions: any[], _viewType: string) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			registerMarkdownPostProcessor(_processor: any, _sortOrder?: number) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			registerObsidianProtocolHandler(_action: string, _handler: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			registerEvent(_eventRef: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addRibbonIcon(_icon: string, _title: string, _callback: any) { return document.createElement('div'); }
			loadData() { return Promise.resolve({}); }
			saveData(_data: unknown) { return Promise.resolve(); }
			onUserEnable() {}
			onUserDisable() {}
		},
		PluginSettingTab: class {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			constructor(_app: any, _plugin: any) {}
			display() {}
		},
		Vault: vi.fn(() => mockVault),
		Workspace: vi.fn(() => mockWorkspace),
		Notice: vi.fn((_message: string, _timeout?: number) => mockNotice),
		MarkdownRenderer: {
			render: vi.fn(),
		},
		MarkdownView: vi.fn(),
		TFile: vi.fn(),
		TFolder: vi.fn(),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		getAllTags: vi.fn((cache: any) => cache?.tags?.map((t: any) => t.tag) || []),
		// normalizePath: path를 그대로 반환
		normalizePath: (p: string) => p,
		// requestUrl: 네트워크 요청 (테스트에서 필요하면 개별적으로 spy/mock)
		requestUrl: vi.fn(),
		request: vi.fn(),
		// Settings 관련
		Setting: class {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			constructor(_containerEl: any) {}
			setName(_name: string) { return this; }
			setDesc(_desc: string) { return this; }
			setClass(_cls: string) { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addText(_cb: any) { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addTextArea(_cb: any) { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addToggle(_cb: any) { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addDropdown(_cb: any) { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addSlider(_cb: any) { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addButton(_cb: any) { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addExtraButton(_cb: any) { return this; }
		},
		// ItemView 등 기타 필요한 클래스
		ItemView: class {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			constructor(_leaf: any) {}
			getViewType() { return 'default'; }
			getDisplayText() { return ''; }
		},
		Component: class {
			load() { return false; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addChild(_component: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			register(_cb: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			registerEvent(_eventRef: any) {}
		},
		Events: class {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			on(_name: string, _callback: any, _ctx?: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			off(_name: string, _callback: any) {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			trigger(_name: string, ..._data: any[]) {}
		},
	};
});

// ── Crypto Stub ──
// Node 18 이하 or jsdom에서 crypto.randomUUID()가 없을 수 있음
if (typeof globalThis.crypto === 'undefined') {
	(globalThis as Record<string, unknown>).crypto = {
		randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		}),
	};
}