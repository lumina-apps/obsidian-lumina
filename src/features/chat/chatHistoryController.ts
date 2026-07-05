import { Notice, type App } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import type LuminaPlugin from '../../main';
import { debugLogger } from '../../shared/debugLogger';
import {
	getMessages,
	setSession,
	currentSessionId,
	currentSessionTitle,
	sessionSummary,
	summaryUpToMessageId,
	resetChat,
} from '../../core/store/chatStore';
import { get } from 'svelte/store';
import {
	saveSession,
	generateTitle,
	generateTitleWithLLM,
	loadSessionsList,
	loadSession,
	deleteSession,
} from './history';
import type { ChatSession } from '../../shared/types/chat.types';
import { normalizePath } from 'obsidian';
import { getActiveProject } from '../../core/store/projectStore';
import { sanitizeDisplayContent } from '../../shared/utils/llmTextSanitizer';

export class ChatHistoryController {
	private app: App;
	private plugin: LuminaPlugin;

	constructor(plugin: LuminaPlugin) {
		this.app = plugin.app;
		this.plugin = plugin;
	}

	/**
	 * 활성 프로젝트를 기반으로 히스토리 저장 경로를 계산합니다.
	 * - Default 프로젝트(historySubfolder=''): chat.historyPath 그대로
	 * - 다른 프로젝트: chat.historyPath/historySubfolder
	 */
	private resolveHistoryPath(): string {
		const basePath = this.plugin.settings.chat.historyPath;
		const project = getActiveProject();
		if (!project.historySubfolder) {
			return basePath;
		}
		return normalizePath(`${basePath}/${project.historySubfolder}`);
	}

	/**
	 * 현재 store 상태를 기반으로 히스토리를 저장합니다.
	 * autoSaveHistory 설정이 꺼져있으면 무시.
	 */
	async saveHistory(providerId: string, modelId: string): Promise<void> {
		const { chat, connections } = this.plugin.settings;
		if (!chat.autoSaveHistory) return;

		const msgs = getMessages();
		if (msgs.length === 0) return;

		const currentId = get(currentSessionId);
		const newId = currentId || crypto.randomUUID();

		let title = get(currentSessionTitle);
		if (!title) {
			const { taskProviderId, taskModelId, providers } = connections;
			if (taskProviderId && taskModelId) {
				const providerConfig = providers.find(p => p.id === taskProviderId);
				if (providerConfig) {
					title = await generateTitleWithLLM(msgs, providerConfig, taskModelId, this.plugin.settings);
					currentSessionTitle.set(title);
				} else {
					title = generateTitle(msgs);
				}
			} else {
				title = generateTitle(msgs);
			}
		}

		// 히스토리 저장 전 assistant 메시지에서 생각 과정(<think> 태그)을 제거
		const sanitizedMsgs = msgs.map(m => ({
			...m,
			content: m.role === 'assistant' ? sanitizeDisplayContent(m.content) : m.content,
		}));

		const session: ChatSession = {
			id: newId,
			title,
			messages: sanitizedMsgs,
			createdAt: msgs[0].timestamp,
			updatedAt: Date.now(),
			providerId,
			modelId,
			sessionSummary: get(sessionSummary),
			summaryUpToMessageId: get(summaryUpToMessageId),
		};

		const historyPath = this.resolveHistoryPath();
		try {
			await saveSession(this.app, session, historyPath);
			if (!currentId) {
				currentSessionId.set(newId);
			}
		} catch (e) {
			new Notice(t('settings.chat.history.saveFail', { error: (e as Error).message }));
		}
	}

	/** 히스토리 세션 목록을 반환합니다. */
	async fetchSessions(): Promise<ChatSession[]> {
		return loadSessionsList(this.app, this.resolveHistoryPath());
	}

	/** 특정 세션을 불러와 현재 대화창을 덮어씁니다. */
	async restoreSession(sessionId: string): Promise<boolean> {
		const session = await loadSession(this.app, sessionId, this.resolveHistoryPath());
		if (session) {
			setSession(session);
			return true;
		}
		new Notice(t('settings.chat.history.loadFail'));
		return false;
	}

	/** 특정 세션을 삭제합니다. */
	async removeSession(sessionId: string): Promise<boolean> {
		const success = await deleteSession(this.app, sessionId, this.resolveHistoryPath());
		if (success) {
			const currentId = get(currentSessionId);
			if (currentId === sessionId) {
				resetChat();
			}
			new Notice(t('settings.chat.history.deleteSuccess'));
		} else {
			new Notice(t('settings.chat.history.deleteFail'));
		}
		return success;
	}

	/** 특정 세션을 마크다운 파일로 내보냅니다. */
	async exportSession(sessionId: string): Promise<boolean> {
		try {
			const session = await loadSession(this.app, sessionId, this.resolveHistoryPath());
			if (session) {
				const { exportSessionToMarkdown } = await import('./history');
				await exportSessionToMarkdown(this.app, session);
				new Notice(t('settings.chat.history.exportSuccess') || 'Exported to Lumina Exports folder successfully.');
				return true;
			}
			new Notice(t('settings.chat.history.loadFail') || 'Failed to load session.');
			return false;
		} catch (e) {
			debugLogger.logError('history', e instanceof Error ? e : new Error(String(e)));
			new Notice(t('settings.chat.history.exportFail') || 'Failed to export session.');
			return false;
		}
	}
}
