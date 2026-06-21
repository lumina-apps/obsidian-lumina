import { Notice, Editor, MarkdownView, App } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { activateView } from '../views/viewHelper';
import { CHAT_VIEW_TYPE } from '../../features/chat/chatView';
import { DEBUG_VIEW_TYPE } from '../../features/debug/debugView';

interface ObsidianAppWithCommands extends App {
	commands: {
		removeCommand(id: string): void;
	};
}

export class CommandManager {
	private plugin: LuminaPlugin;
	private registeredQuickActionIds: string[] = [];

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	registerCommands(): void {
		this.plugin.addCommand({
			id: 'open-chat',
			name: t('uiMessages.cmdChatTitle'),
			callback: () => {
				void activateView(this.plugin.app.workspace, CHAT_VIEW_TYPE);
			},
		});

		this.plugin.addCommand({
			id: 'open-devlog',
			name: t('uiMessages.cmdLogTitle'),
			callback: () => {
				void activateView(this.plugin.app.workspace, DEBUG_VIEW_TYPE);
			},
		});

		// RAG 전체 재인덱싱 커맨드
		this.plugin.addCommand({
			id: 'reindex-vault',
			name: t('uiMessages.cmdReindex'),
			callback: async () => {
				if (!this.plugin.indexer) {
					new Notice(t('settings.rag.reindex.notActivated'));
					return;
				}
				new Notice(t('settings.rag.reindex.started'), 2000);
				try {
					await this.plugin.indexer.indexVault();
					new Notice(t('settings.rag.reindex.success'), 3000);
				} catch (err) {
					new Notice(`${t('settings.rag.reindex.fail')}${(err as Error).message}`, 5000);
				}
			},
		});

		// RAG 인덱스 초기화 커맨드
		this.plugin.addCommand({
			id: 'clear-index',
			name: t('uiMessages.cmdClearIdx'),
			callback: async () => {
				if (!this.plugin.indexer) {
					new Notice(t('settings.rag.reindex.notActivated'));
					return;
				}
				await this.plugin.indexer.resetIndex();
				new Notice(t('settings.rag.reset.resetSuccess'), 3000);
			},
		});

		this.registerQuickActions();
	}

	registerQuickActions(): void {
		const appWithCommands = this.plugin.app as unknown as ObsidianAppWithCommands;
		
		for (const cmdId of this.registeredQuickActionIds) {
			appWithCommands.commands.removeCommand(`${this.plugin.manifest.id}:${cmdId}`);
		}
		this.registeredQuickActionIds = [];

		const actions = this.plugin.settings.chat.quickActions || [];
		for (const action of actions) {
			const cmdId = action.id;
			this.plugin.addCommand({
				id: cmdId,
				name: action.name,
				editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
					void this.plugin.quickActionHandler.executeAction(action, editor, view);
				},
			});
			this.registeredQuickActionIds.push(cmdId);
		}
	}
}
