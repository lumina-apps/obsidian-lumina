import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { activateView } from '../views/viewHelper';
import { CHAT_VIEW_TYPE } from '../../features/chat/chatView';
import { addPendingAttachment } from '../store/chatStore';
import { updateDiscoveryState } from '../store/discoveryStore';
import { Notice, Menu, MenuItem, TFile, TFolder } from 'obsidian';
import { generateCanvasForFile, generateCanvasForFolder } from '../../features/canvas/canvasGenerator';
import type { CanvasBuildOptions } from '../../features/canvas/canvasTypes';
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

				debugLogger.logSystem('events', `context-menu opened (hasSelection=${selection.trim().length > 0}, activeFile=${activeFile?.path ?? 'null'}, contextMenuEnabled=${this.plugin.settings.misc.contextMenuEnabled})`);
				
				menu.addItem((item) => {
					item.setTitle('✨ Lumina').setIcon('bot');
					
					const itemWithSubmenu = item as MenuItemWithSubmenu;
					const submenu = itemWithSubmenu.setSubmenu ? itemWithSubmenu.setSubmenu() : null;
					const target = submenu || menu;

					if (selection.trim()) {
						target.addItem((subItem) => {
							subItem
								.setTitle(t('uiMessages.cmdCtxMenu'))
								.setIcon('message-circle')
							.onClick(async () => {
								debugLogger.logSystem('events', 'context-menu: "Ask with selection" triggered');
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

						target.addItem((subItem) => {
							subItem
								.setTitle('🗺️ ' + t('canvas.menuItem'))
								.setIcon('map')
								.setSection('action')
								.onClick(async () => {
									debugLogger.logSystem('events', `context-menu: canvas generate triggered (file=${activeFile?.path ?? 'null'})`);
									const opts = this.getCanvasOptions();
									await generateCanvasForFile(
										this.plugin.app,
										activeFile,
										opts,
										this.plugin.settings.canvas.outputPath,
										this.plugin.settings.canvas.showFolderGroups,
									);
								});
						});
					}

					if (selection.trim() && this.plugin.settings.chat.quickActions.length > 0) {
						target.addSeparator();
						for (const qa of this.plugin.settings.chat.quickActions) {
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

		// ── 파일탐색기 노트 우클릭 (file-menu) ────────────────────
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-menu', (menu, abstractFile) => {
				if (!(abstractFile instanceof TFile)) return;
				if (abstractFile.extension !== 'md') return;

				menu.addItem((item) => {
					item
						.setTitle('🗺️ ' + t('canvas.menuItem'))
						.setIcon('map')
						.setSection('action')
						.onClick(async () => {
							debugLogger.logSystem('events', `file-menu: canvas generate triggered (file=${abstractFile.path})`);
							const opts = this.getCanvasOptions();
							await generateCanvasForFile(
								this.plugin.app,
								abstractFile,
								opts,
								this.plugin.settings.canvas.outputPath,
								this.plugin.settings.canvas.showFolderGroups,
							);
						});
				});
			}),
		);

		// ── 파일탐색기 폴더 우클릭 (files-menu) ───────────────────
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-menu', (menu, abstractFile) => {
				if (!(abstractFile instanceof TFolder)) return;

				menu.addItem((item) => {
					item
						.setTitle('🗺️ ' + t('canvas.menuItemFolder'))
						.setIcon('map')
						.setSection('action')
						.onClick(async () => {
							debugLogger.logSystem('events', `file-menu: folder canvas generate triggered (folder=${abstractFile.path})`);
							const opts = this.getCanvasOptions();
							await generateCanvasForFolder(
								this.plugin.app,
								abstractFile,
								opts,
								this.plugin.settings.canvas.outputPath,
								this.plugin.settings.canvas.showFolderGroups,
							);
						});
				});
			}),
		);

		// ── 활성 문서 감지 (스마트 탐색용) ──────────────────────────────
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', (file) => {
				debugLogger.logSystem('events', `file-open event (file=${file?.path ?? 'null'})`);
				if (file && file.extension === 'md') {
					updateDiscoveryState({ activeFile: file });
				} else {
					updateDiscoveryState({ activeFile: null });
				}
			}),
		);
	}

	private getCanvasOptions(): CanvasBuildOptions {
		const s = this.plugin.settings.canvas;
		return {
			depth: s.depth,
			layout: s.layout,
			bidirectional: s.bidirectional,
			includeAttachments: s.includeAttachments,
			maxNodes: s.maxNodes,
			folderDepth: s.folderDepth,
		};
	}
}
