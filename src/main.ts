import { Notice, Platform, Plugin, addIcon, TFile, moment, getLanguage } from 'obsidian';
import { LuminaSettingTab } from './core/settings/settingTab';
import { DEFAULT_SETTINGS } from './core/settings/defaultSettings';
import type { LuminaSettings } from './core/settings/settings.types';
import { EmbeddingWorkerBridge } from './features/rag/workerBridge';
import { getModelCacheDir } from './features/rag/storage';
import { VaultIndexer } from './features/rag/indexer';
import { ChatView, CHAT_VIEW_TYPE } from './features/chat/chatView';
import { DebugView, DEBUG_VIEW_TYPE } from './features/debug/debugView';
import { initSettingsStore, syncSettingsStore } from './core/store/settingsStore';
import { setIndexingStatus } from './core/store/ragStore';
import { loadSystemLocaleCache } from './shared/locales/translator';
import { setLanguage, t } from './shared/locales/helpers';
import { createProvider } from './core/llm-providers';
import { addPendingAttachment } from './core/store/chatStore';
import { updateDiscoveryState } from './core/store/discoveryStore';
import { McpManager } from './core/mcp/mcpManager';
import { QuickActionHandler } from './features/editor/quickActionHandler';
import { InlineAISuggest } from './features/editor/inlineSuggest';
import { Editor, MarkdownView } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import { debugLogger } from './shared/debugLogger';

// ─── Frontmatter Auto-Generation ──────────────────────────────────────────────

/** Obsidian 마크다운 파일인지 확인 */
function isMarkdownFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === 'md';
}

/** 
 * 프론트매터 자동 생성 기능
 * - Obsidian의 내장 processFrontMatter를 사용하여 안전하게 YAML 업데이트
 */
async function autoGenerateFrontmatter(plugin: LuminaPlugin, file: TFile, isUpdate: boolean = false): Promise<void> {
	if (!plugin.settings.misc.autoFrontmatter) return;

	// 재귀 방지: 이미 이 파일의 프론트매터를 생성 중이면 무시
	if (plugin.generatingFrontmatterFiles.has(file.path)) return;
	plugin.generatingFrontmatterFiles.add(file.path);

	try {
		interface LuminaFrontmatter {
			luminaCreated?: string;
			luminaModified?: string;
			luminaVersion?: string;
			tags?: string | string[];
		}
		await plugin.app.fileManager.processFrontMatter(file, (fmObj) => {
			const fm = fmObj as LuminaFrontmatter;
			const now = new Date().toISOString();

			if (!isUpdate) {
				fm.luminaCreated = fm.luminaCreated || now;
				// tags 처리 (문자열인 경우 배열로 변환, 없으면 빈 배열 생성)
				if (typeof fm.tags === 'string') {
					fm.tags = fm.tags
						.split(',')
						.map((t: string) => t.trim())
						.filter((t: string) => t.length > 0);
				} else if (!fm.tags || !Array.isArray(fm.tags)) {
					fm.tags = [];
				}
			}

			fm.luminaModified = now;
			fm.luminaVersion = plugin.manifest.version;
		});

		// 플러그인에 의해 마지막으로 업데이트된 시간을 기록 (무한 루프 방지용)
		plugin.lastFrontmatterUpdateMap.set(file.path, Date.now());
	} catch (err) {
		debugLogger.logError('system', err instanceof Error ? err : new Error(`프론트매터 자동생성 실패: ${err}`));
	} finally {
		plugin.generatingFrontmatterFiles.delete(file.path);
	}
}

/**
 * 기본 임베딩 모델 (원클릭 RAG auto 모드).
 * 한국어 포함 다국어 지원.
 */
const DEFAULT_EMBEDDING_MODEL = 'ibm-granite/granite-embedding-97m-multilingual-r2';

/**
 * 이 파일 수 이상일 때 두 번째 임베딩 워커를 임시로 띄워 병렬 처리합니다.
 * 워커 1개당 ONNX 모델이 RAM에 추가 로드되므로 너무 작은 값은 피합니다.
 */
const PARALLEL_WORKER_THRESHOLD = 5000;

export default class LuminaPlugin extends Plugin {
	settings!: LuminaSettings;
	embeddingWorker: EmbeddingWorkerBridge | null = null;
	indexer: VaultIndexer | null = null;
	mcpManager!: McpManager;
	isFirstRun: boolean = false;
	private ribbonEl: HTMLElement | null = null;
	public settingTab: LuminaSettingTab | null = null;
		/** watch 모드 파일 변경 디바운스 타이머 */
	private watchDebounceTimer: number | null = null;
		/** watch 모드 이벤트 해제 함수 모음 */
	private watchEventRefs: import('obsidian').EventRef[] = [];
	quickActionHandler!: QuickActionHandler;
	private registeredQuickActionIds: string[] = [];
			/** 프론트매터 자동생성 재귀 방지 플래그 (파일 경로별) */
	public generatingFrontmatterFiles: Set<string> = new Set();
		/** 프론트매터 업데이트 방지용 맵 (path -> timestamp) */
	public lastFrontmatterUpdateMap: Map<string, number> = new Map();
		/** 현재 보고 있는 파일 경로 (알림 방지용) */
	private activeFilePath: string | null = null;
		/** 탭 전환 시 업데이트할 대기열 */
	private pendingFrontmatterUpdates: Set<string> = new Set();
		/** 프론트매터 이벤트 해제 함수 모음 */
	private frontmatterEventRefs: import('obsidian').EventRef[] = [];

	async onload() {
		// ── 커스텀 아이콘 등록 ──────────────────────────────────────────
		addIcon('lumina-send', `<g transform="scale(4.1667)"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`);
		addIcon('lumina-square', `<g transform="scale(4.1667)"><rect x="4.5" y="4.5" width="15" height="15" rx="2.5" fill="currentColor"/></g>`);
		addIcon('lumina-message-plus', `<g transform="scale(4.1667)"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>`);
		addIcon('lumina-at-sign', `<g transform="scale(4.1667)"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>`);
		addIcon('lumina-server', `<g transform="scale(4.1667)"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="6.01" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="18" x2="6.01" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>`);

		await this.loadSettings();

		// ── 언어 초기화 ───────────────────────────────────────────────
		if (this.settings.connections.language === 'system') {
			const success = await loadSystemLocaleCache(this.app);
			if (success) {
				setLanguage('system');
			} else {
				setLanguage('en');
			}
		} else {
			setLanguage(this.settings.connections.language);
		}

		// 기본 퀵액션 다국어 최신화 및 설정 마이그레이션
		let needsSave = false;
		if (this.migrateQuickActions()) needsSave = true;
		if (this.migrateExcludedPaths()) needsSave = true;
		
		if (needsSave) {
			await this.saveSettings();
		}

		// ── 스토어 초기화 ─────────────────────────────────────────────
		initSettingsStore(this.settings);

		// ── MCP 매니저 초기화 ─────────────────────────────────────────
		this.mcpManager = new McpManager(this);
		// MCP 서버 동기화는 onLayoutReady에서 한 번만 실행 (중복 호출 방지)

		// ── 퀵 액션 핸들러 및 인라인 서제스트 초기화 ───────────────
		this.quickActionHandler = new QuickActionHandler(this);
		this.registerQuickActions();
		this.registerEditorSuggest(new InlineAISuggest(this));

		// ── 채팅 뷰 등록 ─────────────────────────────────────────────────────
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

		// ── 디버그 뷰 등록 ────────────────────────────────────────────────────
		this.registerView(DEBUG_VIEW_TYPE, (leaf) => new DebugView(leaf, this));

		// ── 리본 아이콘 (설정값 반영) ──────────────────────────────────────────
		this.updateRibbonIcon();

		// ── 컨텍스트 메뉴 (항상 등록, 설정에 따라 표시 여부 제어) ───────────────
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				if (!this.settings.misc.contextMenuEnabled) return;
				const selection = editor.getSelection();
				if (!selection.trim()) return;
				menu.addItem((item) => {
					item
						.setTitle(t('uiMessages.cmdCtxMenu'))
						.setIcon('message-circle')
						.onClick(async () => {
							await this.activateChatView();
							addPendingAttachment({
								type: 'selection',
								path: `selection-${Date.now()}`,
								name: t('uiMessages.qaSelectedText'),
								content: selection
							});
						});
				});
			}),
		);

		// ── 활성 문서 감지 (스마트 탐색용) ──────────────────────────────────────
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file && file.extension === 'md') {
					updateDiscoveryState({ activeFile: file });
				} else {
					updateDiscoveryState({ activeFile: null });
				}
			})
		);

		// ── 커맨드 팔레트 ─────────────────────────────────────────────────────
		this.addCommand({
			id: 'open-chat',
			name: t('uiMessages.cmdChatTitle'),
			callback: () => { void this.activateChatView(); },
		});

		this.addCommand({
			id: 'open-devlog',
			name: t('uiMessages.cmdLogTitle'),
			callback: () => { void this.activateDebugView(); },
		});

		// RAG 전체 재인덱싱 커맨드
		this.addCommand({
			id: 'reindex-vault',
			name: t('uiMessages.cmdReindex'),
			callback: async () => {
				if (!this.indexer) {
					new Notice(t('settings.rag.reindex.notActivated'));
					return;
				}
				new Notice(t('settings.rag.reindex.started'), 2000);
				try {
					await this.indexer.indexVault();
					new Notice(t('settings.rag.reindex.success'), 3000);
				} catch (err) {
					new Notice(`${t('settings.rag.reindex.fail')}${(err as Error).message}`, 5000);
				}
			},
		});

		// RAG 인덱스 초기화 커맨드
		this.addCommand({
			id: 'clear-index',
			name: t('uiMessages.cmdClearIdx'),
			callback: async () => {
				if (!this.indexer) {
					new Notice(t('settings.rag.reindex.notActivated'));
					return;
				}
				await this.indexer.resetIndex();
				new Notice(t('settings.rag.reset.resetSuccess'), 3000);
			},
		});

		// ── 설정 탭 ────────────────────────────────────────────────────────────
		this.settingTab = new LuminaSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

			// ── 프론트매터 자동생성 이벤트 등록 ─────────────────────────────
		if (this.settings.misc.autoFrontmatter) {
			this.registerFrontmatterEvents();
			}

	// ── 지연 초기화 (onLayoutReady) ────────────────────────────────────────
		this.app.workspace.onLayoutReady(() => {
			// MCP 서버 동기화 (한 번만 실행)
			this.mcpManager.syncServers().catch(err => {
				debugLogger.logError('mcp', err instanceof Error ? err : new Error(`MCP sync failed on startup: ${err}`));
				new Notice(t('uiMessages.mcpSyncError'));
			});

			// debugMode ON이면 자동으로 패널 열기
			if (this.settings.misc.debugMode) {
				void this.activateDebugView();
			}

			// RAG 워커 초기화
			if (this.settings.connections.ragEnabled) {
				if (Platform.isMobile && this.settings.connections.embedding.mode === 'auto') {
					new Notice(t('uiMessages.noticeMobileRag'), 10000);
				} else {
					if (this.isFirstRun && !Platform.isMobile) {
						const noteCount = this.app.vault.getMarkdownFiles().length;
						if (noteCount > 10000) {
							new Notice(t('uiMessages.noticeLargeVault', { count: noteCount }), 10000);
						} else {
							new Notice(t('uiMessages.noticeIndexing'), 8000);
						}
					}
					// 모바일(클라우드 임베딩 설정 시) 또는 데스크톱인 경우 초기화 진행
					this.initEmbeddingWorker(true, this.isFirstRun).catch(console.error);
				}
			}
		});
	}

	onunload() {
		this.embeddingWorker?.terminate();
		this.clearWatchEvents();
		this.clearFrontmatterEvents();
		void this.mcpManager?.destroy();
	}

	registerQuickActions() {
		// Unregister previous commands
		const appWithCommands = this.app as typeof this.app & {
			commands: {
				removeCommand(id: string): void;
			};
		};
		for (const cmdId of this.registeredQuickActionIds) {
			appWithCommands.commands.removeCommand(`${this.manifest.id}:${cmdId}`);
		}
		this.registeredQuickActionIds = [];

		const actions = this.settings.chat.quickActions || [];
		for (const action of actions) {
			const cmdId = action.id;
			this.addCommand({
				id: cmdId,
				name: action.name,
				editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
					void this.quickActionHandler.executeAction(action, editor, view);
				}
			});
			this.registeredQuickActionIds.push(cmdId);
		}
	}

	migrateQuickActions(): boolean {
		const actions = this.settings.chat.quickActions;
		if (!actions) return false;
		let changed = false;

		const knownSummarizeNames = ['요약하기', 'Summarize', 'Resumir', 'Résumer', 'Riassumi', '要約する', 'Zusammenfassen', 'Резюмировать', '總結', '总结'];
		const knownTranslateNames = ['영어로 번역', '한국어로 번역', 'Translate to English', 'Traducir al Inglés', 'Traducir al Español', 'Traduire en Anglais', 'Traduire en Français', 'Traduci in Inglese', 'Traduci in Italiano', '英語に翻訳', '日本語に翻訳', 'Ins Englische übersetzen', 'Ins Deutsche übersetzen', 'Перевести на Английский', 'Перевести на Русский', '翻譯為英文', '翻譯為繁體中文', '翻译为英文', '翻译为中文', 'Traduzir para Inglês', 'Traduzir para o Português'];
		const knownExplainNames = ['설명하기', 'Explain', 'Explicar', 'Expliquer', 'Spiega', '説明する', 'Erklären', 'Объяснить', '解釋', '解释'];

		for (const action of actions) {
			if (action.id === 'qa-summarize' && knownSummarizeNames.includes(action.name)) {
				action.name = t('settings.chat.quickActions.defaults.summarize.name');
				action.prompt = t('settings.chat.quickActions.defaults.summarize.prompt');
				changed = true;
			} else if (action.id === 'qa-translate' && knownTranslateNames.includes(action.name)) {
				action.name = t('settings.chat.quickActions.defaults.translate.name');
				action.prompt = t('settings.chat.quickActions.defaults.translate.prompt');
				changed = true;
			} else if (action.id === 'qa-explain' && knownExplainNames.includes(action.name)) {
				action.name = t('settings.chat.quickActions.defaults.explain.name');
				action.prompt = t('settings.chat.quickActions.defaults.explain.prompt');
				changed = true;
			}
		}
		if (changed) {
			this.registerQuickActions();
		}
		return changed;
	}

	migrateExcludedPaths(): boolean {
		let changed = false;
		if (!this.settings.misc.hasMigratedChatHistory) {
			if (!this.settings.rag.excludedPaths.includes('chatHistory')) {
				this.settings.rag.excludedPaths.push('chatHistory');
			}
			this.settings.misc.hasMigratedChatHistory = true;
			changed = true;
		}
		const configDir = this.app.vault.configDir;
		if (configDir && !this.settings.rag.excludedPaths.includes(configDir)) {
			this.settings.rag.excludedPaths.push(configDir);
			changed = true;
		}
		const oldConfigDir = '.' + 'obsidian';
		if (configDir !== oldConfigDir && this.settings.rag.excludedPaths.includes(oldConfigDir)) {
			this.settings.rag.excludedPaths = this.settings.rag.excludedPaths.filter(p => p !== oldConfigDir);
			changed = true;
		}
		return changed;
	}

	async loadSettings() {
		const saved = await this.loadData() as Partial<LuminaSettings> | null;
		this.isFirstRun = !saved || Object.keys(saved).length === 0;
		const safeSaved = saved ?? {};
		// 섹션별 깊은 병합: 기존 저장된 서브키를 보존하면서 새 기본값 추가
		this.settings = {
			connections: Object.assign({}, DEFAULT_SETTINGS.connections, safeSaved.connections ?? {}),
			chat:        Object.assign({}, DEFAULT_SETTINGS.chat,        safeSaved.chat ?? {}),
			rag:         Object.assign({}, DEFAULT_SETTINGS.rag,         safeSaved.rag ?? {}),
			misc:        Object.assign({}, DEFAULT_SETTINGS.misc,        safeSaved.misc ?? {}),
			mcp:         Object.assign({}, DEFAULT_SETTINGS.mcp,         safeSaved.mcp ?? {}),
		};

		// SecretStorage에서 자격 증명 로드 (LLM Provider)
		for (const provider of this.settings.connections.providers) {
			const storedSecret = this.app.secretStorage.getSecret(`lumina-provider-${provider.id}`);
			if (storedSecret !== null) {
				provider.credential = storedSecret;
			}
		}

		// SecretStorage에서 MCP 토큰 로드 (내장 서버)
		const mcpServerSecret = this.app.secretStorage.getSecret('lumina-mcp-server-auth');
		if (mcpServerSecret !== null) {
			this.settings.mcp.serverAuthToken = mcpServerSecret;
		}

		// SecretStorage에서 MCP 토큰 로드 (외부 서버)
		for (const server of this.settings.mcp.servers) {
			const storedSecret = this.app.secretStorage.getSecret(`lumina-mcp-client-${server.id}`);
			if (storedSecret !== null) {
				server.authToken = storedSecret;
			}
		}

		if (this.isFirstRun) {
			// Obsidian의 설정 언어를 최우선으로 가져오고, 없으면 moment.locale() (옵시디언 UI 언어), 마지막으로 OS 언어 사용
			// 사용자가 언어 설정을 명시적으로 안 바꿨다면 localStorage가 비어있을 수 있으므로 moment.locale()이 가장 확실합니다.
			let obsLang = getLanguage();
			const momentLang = moment.locale();
			const navLangRaw = navigator.language;

			if (!obsLang) {
				obsLang = momentLang || navLangRaw;
			}
			const navLang = (obsLang || 'en').toLowerCase();
			const supportedLangs = ['en', 'ko', 'ja', 'zh', 'zh-tw', 'es', 'pt', 'de', 'fr', 'ru', 'it'];
			let detectLang = 'en';
			
			if (navLang.startsWith('zh')) {
				detectLang = navLang === 'zh-tw' || navLang === 'zh-hk' ? 'zh-tw' : 'zh';
			} else {
				const baseLang = navLang.split('-')[0];
				if (supportedLangs.includes(baseLang)) {
					detectLang = baseLang;
				}
			}
			
			this.settings.connections.language = detectLang as import('./shared/types/settings.types').PluginLanguage;
			// 최초 실행 시 설정값을 즉시 파일로 저장하여 이후 실행에서 유지되도록 함
			await this.saveSettings();
		}
	}

	async saveSettings() {
		// data.json에 저장할 설정 객체 복제본 생성
		const settingsToSave = JSON.parse(JSON.stringify(this.settings)) as LuminaSettings;

		// 자격 증명은 SecretStorage에 저장하고, 파일 저장 객체에서는 제거 (LLM Provider)
		for (const provider of settingsToSave.connections.providers) {
			const originalProvider = this.settings.connections.providers.find((p) => p.id === provider.id);
			if (originalProvider) {
				this.app.secretStorage.setSecret(`lumina-provider-${provider.id}`, originalProvider.credential || '');
			}
			provider.credential = ''; // 평문 저장 방지
		}

		// MCP 내장 서버 토큰: SecretStorage에 저장하고 data.json에서는 제거
		this.app.secretStorage.setSecret('lumina-mcp-server-auth', this.settings.mcp.serverAuthToken || '');
		settingsToSave.mcp.serverAuthToken = '';

		// MCP 외부 서버 토큰: SecretStorage에 저장하고 data.json에서는 제거
		for (const server of settingsToSave.mcp.servers) {
			const originalServer = this.settings.mcp.servers.find((s) => s.id === server.id);
			if (originalServer?.authToken) {
				this.app.secretStorage.setSecret(`lumina-mcp-client-${server.id}`, originalServer.authToken);
			}
			server.authToken = '';
		}

		await this.saveData(settingsToSave);
		syncSettingsStore(this.settings);
	}

	refreshSettingTab(): void {
		if (this.settingTab && this.settingTab.containerEl && this.settingTab.containerEl.offsetParent !== null) {
			this.settingTab.refreshDisplay();
		}
	}

	// ─── Ribbon Icon ──────────────────────────────────────────────────────────

	/**
	 * 설정값(showRibbonIcon)에 따라 리본 아이콘을 추가/제거합니다.
	 * 설정 변경 시 settingTab에서 호출하여 즉시 반영.
	 */
	updateRibbonIcon(): void {
		if (this.settings.misc.showRibbonIcon && !this.ribbonEl) {
			this.ribbonEl = this.addRibbonIcon('message-circle', t('uiMessages.ribbonTitle'), () => {
				void this.activateChatView();
			});
		} else if (!this.settings.misc.showRibbonIcon && this.ribbonEl) {
			this.ribbonEl.remove();
			this.ribbonEl = null;
		}
	}

	// ─── Chat View ────────────────────────────────────────────────────────────

	async activateChatView(): Promise<void> {
		const { workspace } = this.app;

		// 이미 열려있으면 포커스만
		const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);
			return;
		}

		// 오른쪽 사이드바에 새 탭으로 열기
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	// ─── Debug View ───────────────────────────────────────────────────────────

	/**
	 * DevLog 패널을 오른쪽 사이드바에 열거나 포커스합니다.
	 * settingTab에서 debugMode 토글 시 호출됩니다.
	 */
	async activateDebugView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(DEBUG_VIEW_TYPE);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: DEBUG_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * DevLog 패널을 닫습니다.
	 * settingTab에서 debugMode를 끌 때 호출됩니다.
	 */
	closeDebugView(): void {
		this.app.workspace
			.getLeavesOfType(DEBUG_VIEW_TYPE)
			.forEach(leaf => leaf.detach());
	}

	// ─── Frontmatter Auto-Generation Events ─────────────────────────────────────

	/** 프론트매터 자동생성 이벤트 리스닝 등록 */
	public registerFrontmatterEvents(): void {
		// 이벤트 중복 등록을 방지하기 위해 먼저 해제합니다.
		this.clearFrontmatterEvents();

		// 초기 활성 파일 세팅
		const activeFile = this.app.workspace.getActiveFile();
		this.activeFilePath = activeFile ? activeFile.path : null;

		const refFileOpen = this.app.workspace.on('file-open', (file) => {
			this.activeFilePath = file ? file.path : null;
			void this.processPendingFrontmatterUpdates();
		});
		this.registerEvent(refFileOpen);
		this.frontmatterEventRefs.push(refFileOpen);

		const refCreate = this.app.vault.on('create', (file) => {
			if (isMarkdownFile(file)) {
				autoGenerateFrontmatter(this, file, false).catch(console.error);
			}
		});
		this.registerEvent(refCreate);
		this.frontmatterEventRefs.push(refCreate);

		const refModify = this.app.vault.on('modify', (file) => {
			if (!isMarkdownFile(file)) return;
			
			// 플러그인이 수정한 직후 발생하는 modify 이벤트는 무시 (1.5초 이내)
			const lastUpdate = this.lastFrontmatterUpdateMap.get(file.path) || 0;
			if (Date.now() - lastUpdate < 1500) return;

			if (this.activeFilePath === file.path) {
				// 현재 보고 있는 파일이면 업데이트를 대기열에 넣음 (옵시디언의 '자동 병합' 알림 방지)
				this.pendingFrontmatterUpdates.add(file.path);
			} else {
				// 현재 보고 있지 않은 파일이면 즉시 업데이트
				autoGenerateFrontmatter(this, file, true).catch(console.error);
			}
		});
		this.registerEvent(refModify);
		this.frontmatterEventRefs.push(refModify);
		
		const refRename = this.app.vault.on('rename', (file, oldPath) => {
			if (this.lastFrontmatterUpdateMap.has(oldPath)) {
				const val = this.lastFrontmatterUpdateMap.get(oldPath)!;
				this.lastFrontmatterUpdateMap.delete(oldPath);
				this.lastFrontmatterUpdateMap.set(file.path, val);
			}
			if (this.pendingFrontmatterUpdates.has(oldPath)) {
				this.pendingFrontmatterUpdates.delete(oldPath);
				this.pendingFrontmatterUpdates.add(file.path);
			}
		});
		this.registerEvent(refRename);
		this.frontmatterEventRefs.push(refRename);
		
		const refDelete = this.app.vault.on('delete', (file) => {
			this.lastFrontmatterUpdateMap.delete(file.path);
			this.pendingFrontmatterUpdates.delete(file.path);
		});
		this.registerEvent(refDelete);
		this.frontmatterEventRefs.push(refDelete);
	}

	/** 대기 중인 프론트매터 업데이트 처리 */
	private async processPendingFrontmatterUpdates() {
		for (const path of this.pendingFrontmatterUpdates) {
			if (path === this.activeFilePath) continue; // 여전히 활성화되어 있으면 보류
			
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && isMarkdownFile(file)) {
				this.pendingFrontmatterUpdates.delete(path);
				await autoGenerateFrontmatter(this, file, true).catch(console.error);
			} else {
				this.pendingFrontmatterUpdates.delete(path);
			}
		}
	}

	/** 프론트매터 자동생성 이벤트 리스닝 해제 */
	public clearFrontmatterEvents(): void {
		for (const ref of this.frontmatterEventRefs) {
			this.app.vault.offref(ref);
		}
		this.frontmatterEventRefs = [];
		this.pendingFrontmatterUpdates.clear();
		this.lastFrontmatterUpdateMap.clear();
	}

	// ─── Watch Mode ───────────────────────────────────────────────────────────

	/**
	  * vault.on('modify', 'create', 'delete', 'rename') 이벤트로 파일 변경 감지 + 2초 디바운스 후 증분 인덱싱.
	  * syncMode='watch' 일 때만 등록합니다.
	  */
	private registerWatchEvents(): void {
		this.clearWatchEvents();

		const triggerUpdate = () => {
			if (this.watchDebounceTimer) window.clearTimeout(this.watchDebounceTimer);
			this.watchDebounceTimer = window.setTimeout(() => {
				void (async () => {
					if (!this.indexer) return;
					try {
						await this.indexer.updateIndex();
					} catch (err) {
						debugLogger.logError('rag', err instanceof Error ? err : new Error(`watch 인덱싱 실패: ${err}`));
					}
				})();
			}, 2000) as unknown as number;
		};

		const modifyRef = this.app.vault.on('modify', triggerUpdate);
		const createRef = this.app.vault.on('create', triggerUpdate);
		const deleteRef = this.app.vault.on('delete', triggerUpdate);
		const renameRef = this.app.vault.on('rename', triggerUpdate);

		this.watchEventRefs.push(modifyRef, createRef, deleteRef, renameRef);

		// registerEvent로 등록하여 플러그인 종료 시 자동 해제되도록 함
		this.registerEvent(modifyRef);
		this.registerEvent(createRef);
		this.registerEvent(deleteRef);
		this.registerEvent(renameRef);
	}

	/** watch 이벤트 및 타이머 정리 */
	private clearWatchEvents(): void {
		if (this.watchDebounceTimer) {
			window.clearTimeout(this.watchDebounceTimer);
			this.watchDebounceTimer = null;
		}
		
		for (const ref of this.watchEventRefs) {
			this.app.vault.offref(ref);
		}
		this.watchEventRefs = [];
	}

	// ─── RAG 워커 + 인덱서 ────────────────────────────────────────────────────

	/**
	 * 임베딩 워커를 초기화하고, 완료 후 VaultIndexer를 생성하여 인덱싱을 시작합니다.
	 * 설정에서 ragEnabled를 켤 때 settingTab이 직접 호출합니다.
	 */
	async initEmbeddingWorker(isStartup: boolean = false, isFirstRun: boolean = false): Promise<void> {
		// 기존에 실행 중인 워커가 있으면 먼저 정리
		if (this.embeddingWorker) {
			this.embeddingWorker.terminate();
			this.embeddingWorker = null;
		}
		if (this.indexer) {
			this.indexer.destroy();
		}
		this.indexer = null;
		this.clearWatchEvents();

		const { embedding, providers } = this.settings.connections;
		let progressNotice: Notice | null = null;

		try {
			if (!isStartup) {
				progressNotice = new Notice(t('settings.rag.init.loadingModel'), 0);
			}
			setIndexingStatus('loading-model');

			let embedFn: (texts: string[]) => Promise<number[][]>;
			let modelName = DEFAULT_EMBEDDING_MODEL;

			if (embedding.mode === 'custom' && embedding.providerId && embedding.modelId) {
				modelName = embedding.modelId;
				const providerConfig = providers.find(p => p.id === embedding.providerId);
				if (!providerConfig) throw new Error('선택한 임베딩 프로바이더 설정을 찾을 수 없습니다.');
				
				const provider = createProvider(providerConfig);
				embedFn = (texts: string[]) => provider.embed(texts, { model: modelName });
				progressNotice?.setMessage(t('settings.rag.init.cloudSuccess'));
			} else {
				if (Platform.isMobile) {
					throw new Error(t('uiMessages.errMobileAuto'));
				}
				modelName = DEFAULT_EMBEDDING_MODEL;
				const cacheDir = getModelCacheDir(this.app);

				this.embeddingWorker = new EmbeddingWorkerBridge();

				// 항상 pluginDir을 전달합니다.
				// 로컬에 WASM 파일이 있으면 우선 사용하고, 없으면 Worker에서 CDN 폴백을 시도합니다.
				const pluginDir = this.app.vault.adapter.getResourcePath(this.manifest.dir || '');

				await this.embeddingWorker.init(
					modelName,
					cacheDir,
					pluginDir,
					(progress, status) => {
						const pct = Math.round(progress * 100);
						if (!isStartup) progressNotice?.setMessage(t('settings.rag.init.loadingProgress', { pct: pct, status: status }));
					},
				);
				embedFn = (texts: string[]) => this.embeddingWorker!.embed(texts);
			}

			// ── 대규모 볼트: 두 번째 워커를 임시로 띄워 병렬 임베딩 ─────────────────
			// 파일 수가 PARALLEL_WORKER_THRESHOLD 이상이면 워커 2개로 분산 처리.
			// 작은 볼트는 단일 워커로 충분하며, 추가 RAM 부담을 피합니다.
			const targetFileCount = this.app.vault.getMarkdownFiles().length;
			let secondaryWorker: EmbeddingWorkerBridge | null = null;

			if (embedding.mode !== 'custom' && targetFileCount >= PARALLEL_WORKER_THRESHOLD) {
				try {
					const cacheDir2 = getModelCacheDir(this.app);
					const pluginDir2 = this.app.vault.adapter.getResourcePath(this.manifest.dir || '');

					secondaryWorker = new EmbeddingWorkerBridge();
					await secondaryWorker.init(modelName, cacheDir2, pluginDir2);

					// 라운드로빈: 요청을 두 워커에 교대로 분배
					let turn = 0;
					const primaryEmbed = embedFn;
					const secondaryEmbed = (texts: string[]) => secondaryWorker!.embed(texts);
					embedFn = (texts: string[]) => {
						const useSecondary = (turn++ % 2 === 1);
						return useSecondary ? secondaryEmbed(texts) : primaryEmbed(texts);
					};
					debugLogger.logSystem('rag', `대규모 볼트(${targetFileCount}개 파일) 감지 → 워커 2개 병렬 모드 활성화`);
				} catch (workerErr) {
					// 두 번째 워커 초기화 실패 시 단일 워커로 폴백
					debugLogger.logError('rag', workerErr instanceof Error ? workerErr : new Error(`보조 워커 초기화 실패, 단일 워커로 폴백: ${workerErr}`));
					secondaryWorker?.terminate();
					secondaryWorker = null;
				}
			}

			progressNotice?.hide();

			// ── 인덱서 생성 (modelName 전달 → 스키마 무효화 감지) ─────────────
			this.indexer = new VaultIndexer(
				this.app,
				embedFn,
				(buffer, ext) => this.embeddingWorker!.parse(buffer, ext),
				this.settings.rag,
				modelName,
			);

			if (!isStartup) progressNotice?.setMessage(t('settings.rag.init.indexingVault'));

			const { syncMode } = this.settings.rag;

			if (syncMode === 'watch' || syncMode === 'on-start') {
				if (!isStartup || isFirstRun) new Notice(t('settings.rag.init.indexingVault'), 2000);
				
				// 최초 실행일 경우 전체 볼트 인덱싱(indexVault) 강제 실행, 아닐 경우 증분 업데이트(updateIndex) 실행
				const indexPromise = isFirstRun ? this.indexer.indexVault() : this.indexer.updateIndex();
				
				indexPromise
					.then(() => {
						if (!isStartup || isFirstRun) new Notice(t('settings.rag.init.ready'), 3000);
					})
					.catch((err: Error) => {
						new Notice(t('settings.rag.init.indexFail', { error: err.message }), 5000);
						debugLogger.logError('rag', err instanceof Error ? err : new Error(`인덱싱 실패: ${err}`));
					})
					.finally(() => {
						// 인덱싱 완료(성공/실패 무관) 후 보조 워커 즉시 해제 → RAM 반환
						if (secondaryWorker) {
							secondaryWorker.terminate();
							secondaryWorker = null;
							debugLogger.logSystem('rag', '보조 워커 종료 완료 (RAM 반환)');
						}

						// watch 모드: 초기 인덱싱 완료 후에만 파일 변경 이벤트 등록
						// (인덱싱 중 watch 발동 시 currentProcessId 증가로 indexVault가 조기 종료되는 레이스 컨디션 방지)
						if (syncMode === 'watch') {
							this.registerWatchEvents();
						}
					});
			} else {
				// manual 모드: 즉시 ready 상태로 설정
				setIndexingStatus('ready');
				if (!isStartup) new Notice(t('settings.rag.init.readyManual'), 3000);
			}
		} catch (err) {
			if (progressNotice) {
				progressNotice.hide();
			}
			setIndexingStatus('error', { errorMessage: (err as Error).message });
			new Notice(t('settings.rag.init.initFail', { error: (err as Error).message }), 5000);
			debugLogger.logError('rag', err instanceof Error ? err : new Error(`embedding worker init failed: ${err}`));
			this.embeddingWorker = null;
			// 임베딩 워커 초기화 실패 시 RAG 토글을 false로 되돌려 UI 불일치 방지
			if (this.settings.connections.ragEnabled) {
				this.settings.connections.ragEnabled = false;
				await this.saveSettings();
				this.refreshSettingTab();
			}
		}
	}
}
