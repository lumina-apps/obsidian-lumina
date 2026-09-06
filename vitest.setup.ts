import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import path from 'path';

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
		Platform: {
			isDesktop: true,
			isMobile: false,
			isDesktopApp: true,
			isWin: false,
			isMacOS: false,
			isLinux: false,
			isIosApp: false,
			isAndroidApp: false,
		},
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
		Modal: class {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			constructor(_app: any) {}
			open() {}
			close() {}
		},
		FuzzySuggestModal: class {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			constructor(_app: any) {}
			open() {}
			close() {}
		},
		setTooltip: vi.fn(),
		setIcon: vi.fn(),
		Vault: vi.fn(() => mockVault),
		Workspace: vi.fn(() => mockWorkspace),
		Notice: vi.fn((_message: string, _timeout?: number) => mockNotice),
		MarkdownRenderer: {
			render: vi.fn(),
		},
		MarkdownView: vi.fn(),
		TFile: class TFile {
			path = '';
			name = '';
			basename = '';
			extension = 'md';
			stat = { ctime: 0, mtime: 0, size: 0 };
		},
		TFolder: class TFolder {
			path = '';
			name = '';
			children: unknown[] = [];
		},
		FileSystemAdapter: class FileSystemAdapter {
			getBasePath(): string {
				return '';
			}
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		getAllTags: vi.fn((cache: any) => cache?.tags?.map((t: any) => t.tag) || []),
		// normalizePath: path를 그대로 반환
		normalizePath: (p: string) => p,
		// requestUrl: 네트워크 요청 (테스트에서 필요하면 개별적으로 spy/mock)
		requestUrl: vi.fn(),
		request: vi.fn(),
		sanitizeHTMLToDom: (html: string) => {
			const div = document.createElement('div');
			div.innerHTML = html;
			const frag = document.createDocumentFragment();
			while (div.firstChild) frag.appendChild(div.firstChild);
			return frag;
		},
		// Settings 관련
		Setting: class {
			settingEl = document.createElement('div');
			infoEl = document.createElement('div');
			controlEl = document.createElement('div');
			nameEl = document.createElement('div');
			descEl = document.createElement('div');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			constructor(containerEl?: any) {
				if (containerEl?.appendChild) {
					containerEl.appendChild(this.settingEl);
				}
				this.settingEl.appendChild(this.infoEl);
				this.settingEl.appendChild(this.controlEl);
			}
			setName(_name: string) { return this; }
			setDesc(_desc: string) { return this; }
			setClass(_cls: string) { return this; }
			setHeading() { return this; }
			setDisabled(_disabled?: boolean) { return this; }
			setTooltip(_tooltip: string) { return this; }
			clear() { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addText(cb: any) {
				const inputEl = document.createElement('input');
				const text = {
					inputEl,
					setValue: vi.fn().mockReturnThis(),
					onChange: vi.fn().mockReturnThis(),
					setPlaceholder: vi.fn().mockReturnThis(),
					setDisabled: vi.fn().mockReturnThis(),
				};
				cb(text);
				return this;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addTextArea(cb: any) {
				const inputEl = document.createElement('textarea');
				const text = {
					inputEl,
					setValue: vi.fn().mockReturnThis(),
					onChange: vi.fn().mockReturnThis(),
					setPlaceholder: vi.fn().mockReturnThis(),
					setDisabled: vi.fn().mockReturnThis(),
				};
				cb(text);
				return this;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addToggle(cb: any) {
				const toggle = {
					toggleEl: document.createElement('div'),
					setValue: vi.fn().mockReturnThis(),
					onChange: vi.fn().mockReturnThis(),
					setTooltip: vi.fn().mockReturnThis(),
					setDisabled: vi.fn().mockReturnThis(),
				};
				cb(toggle);
				return this;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addDropdown(cb: any) {
				const drop = {
					selectEl: document.createElement('select'),
					addOption: vi.fn().mockReturnThis(),
					setValue: vi.fn().mockReturnThis(),
					onChange: vi.fn().mockReturnThis(),
					setDisabled: vi.fn().mockReturnThis(),
				};
				cb(drop);
				return this;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addSlider(_cb: any) { return this; }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addButton(cb: any) {
				const buttonEl = document.createElement('button');
				const btn = {
					buttonEl,
					setButtonText: vi.fn().mockReturnThis(),
					setCta: vi.fn().mockReturnThis(),
					setTooltip: vi.fn().mockReturnThis(),
					setDisabled: vi.fn().mockReturnThis(),
					setWarning: vi.fn().mockReturnThis(),
					onClick: vi.fn((fn: any) => { buttonEl.addEventListener('click', fn); return btn; }),
				};
				cb(btn);
				return this;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			addExtraButton(cb: any) {
				const extraSettingsEl = document.createElement('div');
				const btn = {
					extraSettingsEl,
					setIcon: vi.fn().mockReturnThis(),
					setTooltip: vi.fn().mockReturnThis(),
					setDisabled: vi.fn().mockReturnThis(),
					onClick: vi.fn((fn: any) => { extraSettingsEl.addEventListener('click', fn); return btn; }),
				};
				cb(btn);
				return this;
			}
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

// ── Obsidian createFragment global ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).createFragment === 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).createFragment = (callback?: (frag: DocumentFragment) => void) => {
		const frag = document.createDocumentFragment();
		if (callback) callback(frag);
		return frag;
	};
}

if (typeof DocumentFragment !== 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const fragProto = DocumentFragment.prototype as any;
	if (!fragProto.createEl) {
		fragProto.createEl = function (tag: string, o?: any) {
			const el = document.createElement(tag);
			if (o?.cls) el.className = o.cls;
			if (o?.text) el.textContent = o.text;
			this.appendChild(el);
			return el;
		};
	}
	if (!fragProto.appendText) {
		fragProto.appendText = function (text: string) {
			this.appendChild(document.createTextNode(text));
		};
	}
}

// ── Window require Stub ──
if (typeof window !== 'undefined' && typeof (window as unknown as { require?: unknown }).require === 'undefined') {
	(window as unknown as { require: (mod: string) => unknown }).require = (mod: string) => {
		if (mod === 'path') return path;
		throw new Error(`Module ${mod} not found in window.require stub`);
	};
}

// ── Obsidian DOM prototype extensions ──
if (typeof HTMLElement !== 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const proto = HTMLElement.prototype as any;
	if (!proto.empty) {
		proto.empty = function () {
			while (this.firstChild) {
				this.removeChild(this.firstChild);
			}
		};
	}
	if (!proto.addClass) {
		proto.addClass = function (...classes: string[]) {
			for (const cls of classes) {
				if (cls) {
					for (const c of cls.split(/\s+/)) {
						if (c) this.classList.add(c);
					}
				}
			}
		};
	}
	if (!proto.removeClass) {
		proto.removeClass = function (...classes: string[]) {
			for (const cls of classes) {
				if (cls) {
					for (const c of cls.split(/\s+/)) {
						if (c) this.classList.remove(c);
					}
				}
			}
		};
	}
	if (!proto.hasClass) {
		proto.hasClass = function (cls: string) {
			return this.classList.contains(cls);
		};
	}
	if (!proto.createEl) {
		proto.createEl = function (tag: string, o?: any) {
			const el = document.createElement(tag);
			if (o?.cls) el.className = o.cls;
			if (o?.text) el.textContent = o.text;
			if (o?.attr) {
				for (const [k, v] of Object.entries(o.attr)) {
					el.setAttribute(k, String(v));
				}
			}
			this.appendChild(el);
			return el;
		};
	}
	if (!proto.createDiv) {
		proto.createDiv = function (o?: any) {
			return this.createEl('div', o);
		};
	}
	if (!proto.createSpan) {
		proto.createSpan = function (o?: any) {
			return this.createEl('span', o);
		};
	}
	if (!proto.setCssStyles) {
		proto.setCssStyles = function (styles: Partial<CSSStyleDeclaration>) {
			Object.assign(this.style, styles);
		};
	}
	if (!proto.setText) {
		proto.setText = function (text: string) {
			this.textContent = text;
		};
	}
	if (!proto.appendText) {
		proto.appendText = function (text: string) {
			this.appendChild(document.createTextNode(text));
		};
	}
}