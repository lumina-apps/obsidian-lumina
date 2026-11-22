import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { activateMainView, activateView } from '../views/viewHelper';
import { BATCH_STUDIO_VIEW_TYPE, CHAT_VIEW_TYPE } from '../../shared/constants/viewTypes';
import { addPendingAttachment, activeSidebarTab } from '../store/chatStore';
import { setBatchTargetFolder } from '../store/batchStore';
import { canUseFeature } from '../store/entitlementStore';
import { updateDiscoveryState } from '../store/discoveryStore';
import { Notice, Menu, MenuItem, TFolder } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';

export class EventManager {
	private plugin: LuminaPlugin;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	registerEvents(): void {
		// ── 컨텍스트 메뉴 ──────────────────────────────────────────────
		interface MenuItemWithSubmenu extends MenuItem {
			setSubmenu?: () => Menu;
		}

		this.plugin.registerEvent(
			this.plugin.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (!this.plugin.settings.misc.contextMenuEnabled) return;
				const selection = editor.getSelection();
				const activeFile = view?.file ?? this.plugin.app.workspace.getActiveFile();
				
				menu.addItem((item) => {
					item.setTitle('✨ Lumina').setIcon('bot');
					
					const itemWithSubmenu = item as MenuItemWithSubmenu;
					const submenu = itemWithSubmenu.setSubmenu ? itemWithSubmenu.setSubmenu() : null;
					const target = submenu || menu;

					target.addItem((subItem) => {
						subItem
							.setTitle(t('uiMessages.promptBar.menuTitle'))
							.setIcon('sparkles')
							.onClick(() => {
								debugLogger.logSystem('events', 'context-menu: inline prompt bar triggered');
								void import('../../features/editor/promptBarExtension').then(({ openPromptBar }) => {
									openPromptBar(this.plugin, editor, view);
								});
							});
					});

					if (selection.trim()) {
						target.addItem((subItem) => {
							subItem
								.setTitle(t('uiMessages.cmdCtxMenu'))
								.setIcon('message-circle')
							.onClick(async () => {
								debugLogger.logSystem('events', 'context-menu: "Ask with selection" triggered');
								activeSidebarTab.set('chat');
								await activateView(this.plugin.app.workspace, CHAT_VIEW_TYPE);
								addPendingAttachment({
									type: 'selection',
									path: `selection-${Date.now()}`,
									name: t('uiMessages.qaSelectedText'),
									content: selection,
								});
							});
						});
					}

					if (activeFile) {
						target.addItem((subItem) => {
							subItem
								.setTitle(t('uiMessages.cmdAutoLinkNote'))
								.setIcon('link')
								.onClick(async () => {
									debugLogger.logSystem('events', `context-menu: auto-link triggered (file=${activeFile?.path ?? 'null'})`);
									const { processAutoLink } = await import('../mcp/server/handlers/utils/autoLinker');
									const res = await processAutoLink(this.plugin.app, activeFile, editor);
									new Notice(res.message);
								});
						});
					}

					if (activeFile && activeFile.extension === 'md') {
						target.addItem((subItem) => {
							subItem
								.setTitle('🗺️ ' + t('canvas.menuItem'))
								.setIcon('map')
								.onClick(async () => {
									debugLogger.logSystem('events', `context-menu: canvas generate triggered (file=${activeFile.path})`);
									await this.plugin.canvasManager?.generateForFile(activeFile);
								});
						});

						target.addItem((subItem) => {
							subItem
								.setTitle(t('uiMessages.cmdRestoreBackup'))
								.setIcon('history')
								.onClick(async () => {
									debugLogger.logSystem('events', `context-menu: restore backup triggered (file=${activeFile.path})`);
									const { openRestoreBackupModal } = await import('../../features/backup/backupManager');
									openRestoreBackupModal(this.plugin.app, activeFile);
								});
						});
					}

					if (selection.trim() && (this.plugin.settings.chat.quickActions?.length ?? 0) > 0) {
						target.addSeparator();
						for (const qa of (this.plugin.settings.chat.quickActions ?? [])) {
							target.addItem((subItem) => {
								subItem
									.setTitle(qa.name)
									.setIcon('zap')
									.onClick(() => {
										void this.plugin.quickActionHandler.executeAction(qa, editor, view);
									});
							});
						}
					}
				});
			}),
		);

		// ── 파일 탐색기 폴더 컨텍스트 메뉴 (Pro Batch Studio) ───────────
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-menu', (menu, abstractFile) => {
				if (!this.plugin.settings.misc.contextMenuEnabled) return;
				if (!canUseFeature('batch-studio')) return;
				if (!(abstractFile instanceof TFolder)) return;

				menu.addItem((item) => {
					item
						.setTitle(`✨ Lumina: ${t('batchStudio.folderMenuTitle')}`)
						.setIcon('lumina-batch-studio')
						.setSection('action')
						.onClick(() => {
							debugLogger.logSystem(
								'events',
								`file-menu: batch studio triggered (folder=${abstractFile.path})`,
							);
							const applied = setBatchTargetFolder(abstractFile.path);
							if (!applied) {
								new Notice(t('batchStudio.execution.alreadyRunningNotice'));
							}
							void activateMainView(this.plugin.app.workspace, BATCH_STUDIO_VIEW_TYPE);
						});
				});
			}),
		);

		// ── 활성 문서 감지 (스마트 탐색용) ──────────────────────────────
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', (file) => {
				if (file && file.extension === 'md') {
					updateDiscoveryState({ activeFile: file });
				} else {
					updateDiscoveryState({ activeFile: null });
				}
			}),
		);
	}
}
