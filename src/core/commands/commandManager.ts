import { Notice, Editor, MarkdownView, App } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { activateView, activateMainView } from '../views/viewHelper';
import { CHAT_VIEW_TYPE } from '../../features/chat/chatView';
import { DEBUG_VIEW_TYPE } from '../../features/debug/debugView';
import { GRAPH_VIEW_TYPE } from '../../features/graph/graphView';
import { debugLogger } from '../../shared/debugLogger';
import { StripFrontmatterModal } from '../../features/frontmatter/stripFrontmatterModal';

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
				debugLogger.logSystem('commands', 'Command executed: open-chat');
				void activateView(this.plugin.app.workspace, CHAT_VIEW_TYPE);
			},
		});

		this.plugin.addCommand({
			id: 'open-devlog',
			name: t('uiMessages.cmdLogTitle'),
			callback: () => {
				debugLogger.logSystem('commands', 'Command executed: open-devlog');
				void activateView(this.plugin.app.workspace, DEBUG_VIEW_TYPE);
			},
		});

		this.plugin.addCommand({
			id: 'open-graph-view',
			name: t('graph.title'),
			callback: () => {
				debugLogger.logSystem('commands', 'Command executed: open-graph-view');
				void activateMainView(this.plugin.app.workspace, GRAPH_VIEW_TYPE);
			},
		});

		// RAG 전체 재인덱싱 커맨드
		this.plugin.addCommand({
			id: 'reindex-vault',
			name: t('uiMessages.cmdReindex'),
			callback: async () => {
				debugLogger.logSystem('commands', 'Command executed: reindex-vault');
				if (!this.plugin.indexer) {
					debugLogger.logSystem('commands', 'reindex-vault: indexer not activated.');
					new Notice(t('settings.rag.reindex.notActivated'));
					return;
				}
				new Notice(t('settings.rag.reindex.started'), 2000);
				try {
					await this.plugin.indexer.resetIndex();
					await this.plugin.indexer.indexVault();
					debugLogger.logSystem('commands', 'reindex-vault: completed successfully');
					new Notice(t('settings.rag.reindex.success'), 3000);
				} catch (err) {
					debugLogger.logError('commands', err instanceof Error ? err : new Error(`reindex-vault failed: ${err}`));
					new Notice(`${t('settings.rag.reindex.fail')}${(err as Error).message}`, 5000);
				}
			},
		});

		// RAG 인덱스 초기화 커맨드
		this.plugin.addCommand({
			id: 'clear-index',
			name: t('uiMessages.cmdClearIdx'),
			callback: async () => {
				debugLogger.logSystem('commands', 'Command executed: clear-index');
				if (!this.plugin.indexer) {
					debugLogger.logSystem('commands', 'clear-index: indexer not activated.');
					new Notice(t('settings.rag.reindex.notActivated'));
					return;
				}
				await this.plugin.indexer.resetIndex();
				debugLogger.logSystem('commands', 'clear-index: completed successfully');
				new Notice(t('settings.rag.reset.resetSuccess'), 3000);
			},
		});

		// lumina 메타데이터 정리 커맨드 (autoFrontmatter로 생성된 잔재 제거)
		this.plugin.addCommand({
			id: 'strip-lumina-metadata',
			name: t('uiMessages.cmdStripMetadata'),
			callback: async () => {
				debugLogger.logSystem('commands', 'Command executed: strip-lumina-metadata');
				const fm = this.plugin.frontmatterManager;
				const count = fm.countLuminaStampedFiles();
				if (count === 0) {
					new Notice(t('uiMessages.stripMetadataNone'));
					return;
				}

				new StripFrontmatterModal(this.plugin.app, count, async () => {
					const progressNotice = new Notice(`${t('uiMessages.stripMetadataProgress')} 0/0`, 0);
					const stripped = await fm.stripLuminaMetadata(
						(done, total) => progressNotice.noticeEl.setText(
							`${t('uiMessages.stripMetadataProgress')} ${done}/${total}`
						),
					);
					progressNotice.hide();
					debugLogger.logSystem('commands', `strip-lumina-metadata completed (stripped=${stripped})`);
					new Notice(t('uiMessages.stripMetadataDone', { count: stripped }), 4000);
				}).open();
			},
		});

		this.plugin.addCommand({
			id: 'auto-link-current-note',
			name: t('uiMessages.cmdAutoLinkNote'),
			editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
				debugLogger.logSystem('commands', 'Command executed: auto-link-current-note');
				const activeFile = (view as MarkdownView)?.file ?? this.plugin.app.workspace.getActiveFile();
				if (!activeFile) {
					debugLogger.logSystem('commands', 'auto-link-current-note: no active file.');
					new Notice('No active file to auto-link.');
					return;
				}
				const { processAutoLink } = await import('../mcp/server/handlers/utils/autoLinker');
				const res = await processAutoLink(this.plugin.app, activeFile, editor);
				debugLogger.logSystem('commands', `auto-link-current-note completed (file=${activeFile.path})`);
				new Notice(res.message);
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
