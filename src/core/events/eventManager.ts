import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { activateView } from '../views/viewHelper';
import { CHAT_VIEW_TYPE } from '../../features/chat/chatView';
import { addPendingAttachment } from '../store/chatStore';
import { updateDiscoveryState } from '../store/discoveryStore';

export class EventManager {
	private plugin: LuminaPlugin;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	registerEvents(): void {
		// ── 컨텍스트 메뉴 ──────────────────────────────────────────────
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('editor-menu', (menu, editor) => {
				if (!this.plugin.settings.misc.contextMenuEnabled) return;
				const selection = editor.getSelection();
				if (!selection.trim()) return;
				menu.addItem((item) => {
					item
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
