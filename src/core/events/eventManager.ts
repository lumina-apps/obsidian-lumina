import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { activateMainView, activateView } from '../views/viewHelper';
import { BATCH_STUDIO_VIEW_TYPE, CHAT_VIEW_TYPE } from '../../shared/constants/viewTypes';
import { addPendingAttachment, activeSidebarTab } from '../store/chatStore';
import { setBatchTargetFolder } from '../store/batchStore';
import { canUseFeature } from '../store/entitlementStore';
import { updateDiscoveryState } from '../store/discoveryStore';
import { Notice, Menu, MenuItem, Platform, TFile, TFolder, type Editor, type MarkdownFileInfo, type MarkdownView } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';

/** 우클릭 음성 변환 메뉴를 표시할 오디오 확장자 목록 */
const VOICE_AUDIO_EXTENSIONS = new Set(['m4a', 'mp3', 'wav', 'webm', 'ogg']);

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
				const isPhoneMenu = typeof Platform !== 'undefined' && Boolean(Platform?.isMobile) && !Boolean(Platform?.isTablet);

				const populateItems = (target: Menu, titlePrefix: string) => {
					target.addItem((subItem) => {
						subItem
							.setTitle(`${titlePrefix}${t('uiMessages.promptBar.menuTitle')}`)
							.setIcon('sparkles')
							.onClick(() => {
								debugLogger.logSystem('events', 'context-menu: inline prompt bar triggered');
								void import('../../features/editor/promptBarExtension').then(({ openPromptBar }) => {
									openPromptBar(this.plugin, editor, view);
								});
							});
					});

					if (canUseFeature('voice-note')) {
						target.addItem((subItem) => {
							subItem
								.setTitle(`${titlePrefix}${t('voiceNote.cmdToggleRecord')}`)
								.setIcon('lumina-voice-note')
								.onClick(() => {
									debugLogger.logSystem('events', 'context-menu: voice-note recording triggered');
									void this.plugin.ensureVoiceNoteManager().then((manager) => {
										void manager?.toggleRecording();
									});
								});
						});
					}

					if (selection.trim()) {
						target.addItem((subItem) => {
							subItem
								.setTitle(`${titlePrefix}${t('uiMessages.cmdCtxMenu')}`)
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
								.setTitle(`${titlePrefix}${t('uiMessages.cmdAutoLinkNote')}`)
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
								.setTitle(`${titlePrefix}🗺️ ${t('canvas.menuItem')}`)
								.setIcon('map')
								.onClick(async () => {
									debugLogger.logSystem('events', `context-menu: canvas generate triggered (file=${activeFile.path})`);
									await this.plugin.canvasManager?.generateForFile(activeFile);
								});
						});

						target.addItem((subItem) => {
							subItem
								.setTitle(`${titlePrefix}${t('uiMessages.cmdRestoreBackup')}`)
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
									.setTitle(`${titlePrefix}${qa.name}`)
									.setIcon('zap')
									.onClick(() => {
										void this.plugin.quickActionHandler.executeAction(qa, editor, view);
									});
							});
						}
					}
				};

				// 스마트폰 바텀시트 메뉴는 중첩 서브메뉴를 지원하지 않으므로 최상위에 평면 등록
				if (isPhoneMenu) {
					populateItems(menu, '✨ Lumina: ');
					return;
				}

				menu.addItem((item) => {
					item.setTitle('✨ Lumina').setIcon('bot');
					const itemWithSubmenu = item as MenuItemWithSubmenu;
					const submenu = itemWithSubmenu.setSubmenu ? itemWithSubmenu.setSubmenu() : null;
					populateItems(submenu || menu, submenu ? '' : '✨ Lumina: ');
				});
			}),
		);

		// ── 파일 탐색기 컨텍스트 메뉴 (Pro Batch Studio / Pro Voice-to-Note) ──
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-menu', (menu, abstractFile) => {
				if (!this.plugin.settings.misc.contextMenuEnabled) return;

				if (abstractFile instanceof TFolder) {
					if (!canUseFeature('batch-studio')) return;

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
					return;
				}

				if (
					abstractFile instanceof TFile &&
					canUseFeature('voice-note') &&
					VOICE_AUDIO_EXTENSIONS.has(abstractFile.extension.toLowerCase())
				) {
					menu.addItem((item) => {
						item
							.setTitle(`✨ Lumina: ${t('voiceNote.fileMenuTitle')}`)
							.setIcon('lumina-voice-note')
							.setSection('action')
							.onClick(() => {
								debugLogger.logSystem(
									'events',
									`file-menu: voice-note triggered (file=${abstractFile.path})`,
								);
								void this.plugin.ensureVoiceNoteManager().then((manager) => {
									void manager?.transcribeVaultFile(abstractFile);
								});
							});
					});
				}
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
