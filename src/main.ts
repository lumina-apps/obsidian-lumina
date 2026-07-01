import { Notice, Platform, Plugin, PluginSettingTab, App } from 'obsidian';
// Note: LuminaSettingTab is no longer imported statically to improve startup time.
import { ChatView, CHAT_VIEW_TYPE } from './features/chat/chatView';
import { DebugView, DEBUG_VIEW_TYPE } from './features/debug/debugView';
import { GraphView, GRAPH_VIEW_TYPE } from './features/graph/graphView';
import type { LuminaSettings } from './core/settings/settings.types';
import { EmbeddingWorkerBridge } from './features/rag/workerBridge';
import { VaultIndexer } from './features/rag/indexer';
import { loadSystemLocaleCache } from './shared/locales/translator';
import { setLanguage, t } from './shared/locales/helpers';
import { debugLogger } from './shared/debugLogger';
import { registerLuminaIcons } from './shared/icons';
import { runMigrations } from './core/settings/migrations';
import { activateView, activateMainView } from './core/views/viewHelper';
import { cleanupApprovalListener } from './features/chat/utils/approvalListener';
import { SettingsManager } from './core/settings/settingsManager';
import { CommandManager } from './core/commands/commandManager';
import { EventManager } from './core/events/eventManager';
import { RagWatchManager } from './features/rag/watchManager';

import type { McpManager } from './core/mcp/mcpManager';
import type { QuickActionHandler } from './features/editor/quickActionHandler';
import type { FrontmatterManager } from './features/frontmatter/frontmatterManager';
// Lazy Loading Type
import type { LuminaSettingTab } from './core/settings/settingTab';

class LazyLuminaSettingTab extends PluginSettingTab {
	private plugin: LuminaPlugin;
	private realTab: LuminaSettingTab | null = null;
	private loadingPromise: Promise<void> | null = null;

	constructor(app: App, plugin: LuminaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		if (this.realTab) {
			this.realTab.refreshDisplay();
			return;
		}

		this.containerEl.empty();
		this.containerEl.createEl('div', { text: t('uiMessages.noticeIndexing') || 'Loading settings...', cls: 'setting-item-description' });

		if (!this.loadingPromise) {
			this.loadingPromise = (async () => {
				const { LuminaSettingTab: RealTab } = await import('./core/settings/settingTab');
				this.realTab = new RealTab(this.app, this.plugin);
				// Proxy the container element so real tab can manipulate it
				this.realTab.containerEl = this.containerEl;
			})();
		}

		this.loadingPromise.then(() => {
			if (this.realTab) {
				this.realTab.refreshDisplay();
			}
		}).catch(console.error);
	}

	hide(): void {
		if (this.realTab) {
			this.realTab.hide();
		} else {
			super.hide();
		}
	}

	refreshDisplay(): void {
		if (this.realTab) {
			this.realTab.refreshDisplay();
		}
	}
}

export default class LuminaPlugin extends Plugin {
	settings!: LuminaSettings;
	embeddingWorker: EmbeddingWorkerBridge | null = null;
	indexer: VaultIndexer | null = null;
	mcpManager!: McpManager;
	isFirstRun: boolean = false;
	private ribbonEl: HTMLElement | null = null;
	private graphRibbonEl: HTMLElement | null = null;
	public settingTab: LazyLuminaSettingTab | null = null;
	public frontmatterManager!: FrontmatterManager;
	public quickActionHandler!: QuickActionHandler;

	// Managers
	public settingsManager!: SettingsManager;
	public commandManager!: CommandManager;
	private eventManager!: EventManager;
	public watchManager!: RagWatchManager;

	// ─── Lifecycle ───────────────────────────────────────────────────────

	async onload() {
		// ── 매니저 초기화 ───────────────────────────────────────────────
		this.settingsManager = new SettingsManager(this);
		this.commandManager = new CommandManager(this);
		this.eventManager = new EventManager(this);
		this.watchManager = new RagWatchManager(this);

		// ── 커스텀 아이콘 등록 ──────────────────────────────────────────
		registerLuminaIcons();

		await this.settingsManager.loadSettings();

		// 기본 언어 즉시 적용 (en.json은 정적 캐시되어 있어 지연 없음)
		// 이후 onLayoutReady에서 비동기적으로 실제 시스템/사용자 언어 적용
		void setLanguage('en');

		// ── View 등록 ──────────────────────────────────────────────────
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.registerView(DEBUG_VIEW_TYPE, (leaf) => new DebugView(leaf, this));
		this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));

		// ── 리본 아이콘 ────────────────────────────────────────────────
		this.updateRibbonIcon();

		// ── 설정 탭 (Lazy Wrapper 등록) ─────────────────────────────────
		this.settingTab = new LazyLuminaSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// ── 지연 초기화 (onLayoutReady) ──────────────────────────────────
		this.app.workspace.onLayoutReady(async () => {
			
			// ── 언어 및 동적 모듈 로딩 병렬 처리 ─────────────────────────────
			const initLocale = async () => {
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
			};

			// 지연 로딩할 무거운 모듈들 및 locale 설정 병렬 대기
			const [
				,
				,
				[
					{ McpManager },
					{ setupApprovalListener },
					{ QuickActionHandler },
					{ InlineAISuggest },
					{ inlineDiffExtension },
					{ FrontmatterManager },
					{ AutocompleteHandler },
					{ buildInlineAutocompleteExtension }
				]
			] = await Promise.all([
				initLocale(),
				this.settingsManager.loadSecrets(),
				Promise.all([
					import('./core/mcp/mcpManager'),
					import('./features/chat/utils/approvalListener'),
					import('./features/editor/quickActionHandler'),
					import('./features/editor/inlineSuggest'),
					import('./features/editor/diffExtension'),
					import('./features/frontmatter/frontmatterManager'),
					import('./features/editor/autocompleteHandler'),
					import('./features/editor/autocompleteExtension')
				])
			]);

			// ── 설정 마이그레이션 ──────────────────────────────────────────
			const needsSave = runMigrations(this);
			if (needsSave) {
				await this.settingsManager.saveSettings();
			}

			// ── Approval Listener 초기화
			setupApprovalListener(this.app);

			// ── MCP 매니저 초기화 및 동기화
			this.mcpManager = new McpManager(this);
			this.mcpManager.syncServers().catch((err: unknown) => {
				debugLogger.logError(
					'mcp',
					err instanceof Error ? err : new Error(`MCP sync failed on startup: ${err}`),
				);
				new Notice(t('uiMessages.mcpSyncError'));
			});

			// ── 퀵 액션 핸들러 및 커맨드/이벤트 등록
			this.quickActionHandler = new QuickActionHandler(this);
			this.commandManager.registerCommands();
			this.eventManager.registerEvents();

			// ── 인라인 서제스트 및 Diff Extension 초기화
			this.registerEditorSuggest(new InlineAISuggest(this));
			this.registerEditorExtension(inlineDiffExtension);
			
			// ── 인라인 고스트 텍스트 자동완성 초기화
			const autocompleteHandler = new AutocompleteHandler(this);
			this.registerEditorExtension(buildInlineAutocompleteExtension(autocompleteHandler));

			// ── 프론트매터 매니저 초기화
			this.frontmatterManager = new FrontmatterManager(this);
			this.frontmatterManager.registerIfEnabled();

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
					import('./features/rag/ragInitializer').then(({ initEmbeddingWorker }) => {
						initEmbeddingWorker(this, true, this.isFirstRun).catch(console.error);
					}).catch(console.error);
				}
			}
		});
	}

	onunload() {
		this.embeddingWorker?.terminate();
		this.watchManager?.clearWatchEvents();
		this.frontmatterManager?.destroy();
		cleanupApprovalListener();
		void this.mcpManager?.destroy();
	}

	// ─── Settings ───────────────────────────────────────────────────────

	async loadSettings() {
		await this.settingsManager.loadSettings();
	}

	async saveSettings() {
		await this.settingsManager.saveSettings();
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

	// ─── Locales ────────────────────────────────────────────────────────

	refreshLocales(): void {
		this.updateRibbonIcon();
		for (const type of [CHAT_VIEW_TYPE, GRAPH_VIEW_TYPE, DEBUG_VIEW_TYPE]) {
			const leaves = this.app.workspace.getLeavesOfType(type);
			leaves.forEach((leaf) => {
				const view = leaf.view;
				if (typeof view.getDisplayText === 'function') {
					const newTitle = view.getDisplayText();
					const tabHeaderInnerTitleEl = (leaf as unknown as { tabHeaderInnerTitleEl?: HTMLElement }).tabHeaderInnerTitleEl;
					if (tabHeaderInnerTitleEl) tabHeaderInnerTitleEl.innerText = newTitle;
				}
			});
		}
	}

	// ─── Ribbon Icon ────────────────────────────────────────────────────

	updateRibbonIcon(): void {
		if (this.settings.misc.showRibbonIcon) {
			if (!this.ribbonEl) {
				this.ribbonEl = this.addRibbonIcon('message-circle', t('uiMessages.ribbonTitle'), () => {
					void activateView(this.app.workspace, CHAT_VIEW_TYPE);
				});
			} else {
				this.ribbonEl.setAttribute('aria-label', t('uiMessages.ribbonTitle'));
			}

			if (!this.graphRibbonEl) {
				this.graphRibbonEl = this.addRibbonIcon('network', t('graph.title'), () => {
					void activateMainView(this.app.workspace, GRAPH_VIEW_TYPE);
				});
			} else {
				this.graphRibbonEl.setAttribute('aria-label', t('graph.title'));
			}
		} else {
			if (this.ribbonEl) {
				this.ribbonEl.remove();
				this.ribbonEl = null;
			}
			if (this.graphRibbonEl) {
				this.graphRibbonEl.remove();
				this.graphRibbonEl = null;
			}
		}
	}
}