import { Notice, Platform, Plugin, moment, getLanguage } from 'obsidian';
import { Editor, MarkdownView } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import { LuminaSettingTab } from './core/settings/settingTab';
import { DEFAULT_SETTINGS } from './core/settings/defaultSettings';
import type { LuminaSettings } from './core/settings/settings.types';
import { EmbeddingWorkerBridge } from './features/rag/workerBridge';
import { VaultIndexer } from './features/rag/indexer';
import { ChatView, CHAT_VIEW_TYPE } from './features/chat/chatView';
import { DebugView, DEBUG_VIEW_TYPE } from './features/debug/debugView';
import { initSettingsStore, syncSettingsStore } from './core/store/settingsStore';
import { loadSystemLocaleCache } from './shared/locales/translator';
import { setLanguage, t } from './shared/locales/helpers';
import { addPendingAttachment } from './core/store/chatStore';
import { updateDiscoveryState } from './core/store/discoveryStore';
import { McpManager } from './core/mcp/mcpManager';
import { QuickActionHandler } from './features/editor/quickActionHandler';
import { InlineAISuggest } from './features/editor/inlineSuggest';
import { inlineDiffExtension } from './features/editor/diffExtension';
import { debugLogger } from './shared/debugLogger';
import { registerLuminaIcons } from './shared/icons';
import { FrontmatterManager } from './features/frontmatter/frontmatterManager';
import { runMigrations } from './core/settings/migrations';
import { initEmbeddingWorker } from './features/rag/ragInitializer';
import { activateView, closeView } from './core/views/viewHelper';
import { setupApprovalListener, cleanupApprovalListener } from './features/chat/utils/approvalListener';

export default class LuminaPlugin extends Plugin {
	settings!: LuminaSettings;
	embeddingWorker: EmbeddingWorkerBridge | null = null;
	indexer: VaultIndexer | null = null;
	mcpManager!: McpManager;
	isFirstRun: boolean = false;
	private ribbonEl: HTMLElement | null = null;
	public settingTab: LuminaSettingTab | null = null;
	public frontmatterManager!: FrontmatterManager;

	/** watch 모드 파일 변경 디바운스 타이머 */
	private watchDebounceTimer: number | null = null;
	/** watch 모드 이벤트 해제 함수 모음 */
	private watchEventRefs: import('obsidian').EventRef[] = [];

	quickActionHandler!: QuickActionHandler;
	private registeredQuickActionIds: string[] = [];

	// ─── Lifecycle ───────────────────────────────────────────────────────

	async onload() {
		// ── 커스텀 아이콘 등록 ──────────────────────────────────────────
		registerLuminaIcons();

		await this.loadSettings();

		// ── 언어 초기화 ───────────────────────────────────────────────
		if (this.settings.connections.language === 'system') {
			const success = await loadSystemLocaleCache(this.app);
			if (success) {
				await setLanguage('system');
			} else {
				await setLanguage('en');
			}
		} else {
			await setLanguage(this.settings.connections.language);
		}

		// ── 설정 마이그레이션 ──────────────────────────────────────────
		const needsSave = runMigrations(this);
		if (needsSave) {
			await this.saveSettings();
		}

		// ── 스토어 초기화 ─────────────────────────────────────────────
		initSettingsStore(this.settings);

		// ── MCP 매니저 초기화 ─────────────────────────────────────────
		this.mcpManager = new McpManager(this);

		// ── Approval Listener 초기화 ──────────────────────────────────
		setupApprovalListener(this.app);

		// ── 퀵 액션 핸들러 및 인라인 서제스트 초기화 ───────────────
		this.quickActionHandler = new QuickActionHandler(this);
		this.registerQuickActions();
		this.registerEditorSuggest(new InlineAISuggest(this));

		// ── 에디터 인라인 Diff Extension 등록 ───────────────────────
		this.registerEditorExtension(inlineDiffExtension);

		// ── 프론트매터 매니저 초기화 ──────────────────────────────────
		this.frontmatterManager = new FrontmatterManager(this);
		this.frontmatterManager.registerIfEnabled();

		// ── View 등록 ──────────────────────────────────────────────────
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.registerView(DEBUG_VIEW_TYPE, (leaf) => new DebugView(leaf, this));

		// ── 리본 아이콘 ────────────────────────────────────────────────
		this.updateRibbonIcon();

		// ── 컨텍스트 메뉴 ──────────────────────────────────────────────
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
							await activateView(this.app.workspace, CHAT_VIEW_TYPE);
							addPendingAttachment({
								type: 'selection',
								path: `selection-${Date.now()}`,
								name: t('uiMessages.qaSelectedText'),
								content: selection,
							});
						});
				});
			}),
		);

		// ── 활성 문서 감지 (스마트 탐색용) ──────────────────────────────
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file && file.extension === 'md') {
					updateDiscoveryState({ activeFile: file });
				} else {
					updateDiscoveryState({ activeFile: null });
				}
			}),
		);

		// ── 커맨드 팔레트 ───────────────────────────────────────────────
		this.addCommand({
			id: 'open-chat',
			name: t('uiMessages.cmdChatTitle'),
			callback: () => {
				void activateView(this.app.workspace, CHAT_VIEW_TYPE);
			},
		});

		this.addCommand({
			id: 'open-devlog',
			name: t('uiMessages.cmdLogTitle'),
			callback: () => {
				void activateView(this.app.workspace, DEBUG_VIEW_TYPE);
			},
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

		// ── 설정 탭 ────────────────────────────────────────────────────
		this.settingTab = new LuminaSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// ── 지연 초기화 (onLayoutReady) ──────────────────────────────────
		this.app.workspace.onLayoutReady(() => {
			// MCP 서버 동기화
			this.mcpManager.syncServers().catch((err) => {
				debugLogger.logError(
					'mcp',
					err instanceof Error ? err : new Error(`MCP sync failed on startup: ${err}`),
				);
				new Notice(t('uiMessages.mcpSyncError'));
			});

			// debugMode ON이면 자동으로 패널 열기
			if (this.settings.misc.debugMode) {
				void activateView(this.app.workspace, DEBUG_VIEW_TYPE);
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
					initEmbeddingWorker(this, true, this.isFirstRun).catch(console.error);
				}
			}
		});
	}

	onunload() {
		this.embeddingWorker?.terminate();
		this.clearWatchEvents();
		this.frontmatterManager.destroy();
		cleanupApprovalListener();
		void this.mcpManager?.destroy();
	}

	// ─── Quick Actions ──────────────────────────────────────────────────

	registerQuickActions() {
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
				},
			});
			this.registeredQuickActionIds.push(cmdId);
		}
	}

	// ─── Settings ───────────────────────────────────────────────────────

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<LuminaSettings> | null;
		this.isFirstRun = !saved || Object.keys(saved).length === 0;
		const safeSaved = saved ?? {};

		this.settings = {
			connections: Object.assign({}, DEFAULT_SETTINGS.connections, safeSaved.connections ?? {}),
			chat: Object.assign({}, DEFAULT_SETTINGS.chat, safeSaved.chat ?? {}),
			rag: Object.assign({}, DEFAULT_SETTINGS.rag, safeSaved.rag ?? {}),
			misc: Object.assign({}, DEFAULT_SETTINGS.misc, safeSaved.misc ?? {}),
			mcp: Object.assign({}, DEFAULT_SETTINGS.mcp, safeSaved.mcp ?? {}),
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

			this.settings.connections.language =
				detectLang as import('./shared/types/settings.types').PluginLanguage;
			await this.saveSettings();
		}
	}

	async saveSettings() {
		const settingsToSave = JSON.parse(JSON.stringify(this.settings)) as LuminaSettings;

		// 자격 증명은 SecretStorage에 저장하고, 파일 저장 객체에서는 제거 (LLM Provider)
		for (const provider of settingsToSave.connections.providers) {
			const originalProvider = this.settings.connections.providers.find((p) => p.id === provider.id);
			if (originalProvider) {
				this.app.secretStorage.setSecret(
					`lumina-provider-${provider.id}`,
					originalProvider.credential || '',
				);
			}
			provider.credential = '';
		}

		// MCP 내장 서버 토큰
		this.app.secretStorage.setSecret(
			'lumina-mcp-server-auth',
			this.settings.mcp.serverAuthToken || '',
		);
		settingsToSave.mcp.serverAuthToken = '';

		// MCP 외부 서버 토큰
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
		if (
			this.settingTab &&
			this.settingTab.containerEl &&
			this.settingTab.containerEl.offsetParent !== null
		) {
			this.settingTab.refreshDisplay();
		}
	}

	// ─── Ribbon Icon ────────────────────────────────────────────────────

	updateRibbonIcon(): void {
		if (this.settings.misc.showRibbonIcon && !this.ribbonEl) {
			this.ribbonEl = this.addRibbonIcon('message-circle', t('uiMessages.ribbonTitle'), () => {
				void activateView(this.app.workspace, CHAT_VIEW_TYPE);
			});
		} else if (!this.settings.misc.showRibbonIcon && this.ribbonEl) {
			this.ribbonEl.remove();
			this.ribbonEl = null;
		}
	}

	// ─── Chat View (간편 wrapper) ───────────────────────────────────────

	async activateChatView(): Promise<void> {
		await activateView(this.app.workspace, CHAT_VIEW_TYPE);
	}

	// ─── Debug View (간편 wrapper) ──────────────────────────────────────

	async activateDebugView(): Promise<void> {
		await activateView(this.app.workspace, DEBUG_VIEW_TYPE);
	}

	closeDebugView(): void {
		closeView(this.app.workspace, DEBUG_VIEW_TYPE);
	}

	// ─── Watch Mode ─────────────────────────────────────────────────────

	/**
	 * vault.on('modify', 'create', 'delete', 'rename') 이벤트로 파일 변경 감지 + 2초 디바운스 후 증분 인덱싱.
	 * syncMode='watch' 일 때만 등록합니다.
	 */
	public registerWatchEvents(): void {
		this.clearWatchEvents();

		const triggerUpdate = () => {
			if (this.watchDebounceTimer) window.clearTimeout(this.watchDebounceTimer);
			this.watchDebounceTimer = window.setTimeout(() => {
				void (async () => {
					if (!this.indexer) return;
					try {
						await this.indexer.updateIndex();
					} catch (err) {
						debugLogger.logError(
							'rag',
							err instanceof Error ? err : new Error(`watch 인덱싱 실패: ${err}`),
						);
					}
				})();
			}, 2000) as unknown as number;
		};

		const modifyRef = this.app.vault.on('modify', triggerUpdate);
		const createRef = this.app.vault.on('create', triggerUpdate);
		const deleteRef = this.app.vault.on('delete', triggerUpdate);
		const renameRef = this.app.vault.on('rename', triggerUpdate);

		this.watchEventRefs.push(modifyRef, createRef, deleteRef, renameRef);

		this.registerEvent(modifyRef);
		this.registerEvent(createRef);
		this.registerEvent(deleteRef);
		this.registerEvent(renameRef);
	}

	/** watch 이벤트 및 타이머 정리 */
	public clearWatchEvents(): void {
		if (this.watchDebounceTimer) {
			window.clearTimeout(this.watchDebounceTimer);
			this.watchDebounceTimer = null;
		}

		for (const ref of this.watchEventRefs) {
			this.app.vault.offref(ref);
		}
		this.watchEventRefs = [];
	}
}