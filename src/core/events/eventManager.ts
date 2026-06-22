import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { activateView } from '../views/viewHelper';
import { CHAT_VIEW_TYPE } from '../../features/chat/chatView';
import { addPendingAttachment } from '../store/chatStore';
import { updateDiscoveryState } from '../store/discoveryStore';
import { Notice, Menu, MenuItem } from 'obsidian';

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

					if (selection.trim()) {
						target.addItem((subItem) => {
							subItem
								.setTitle(t('uiMessages.cmdCtxMenu'))
								.setIcon('message-circle')
								.onClick(async () => {
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
									const { processAutoLink } = await import('../mcp/server/handlers/utils/autoLinker');
									const res = await processAutoLink(this.plugin.app, activeFile, editor);
									new Notice(res.message);
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
