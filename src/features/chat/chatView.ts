/**
 * Obsidian ItemView를 상속해 Svelte ChatPanel을 사이드바 탭으로 마운트한다.
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LuminaPlugin from '../../main';
import { debugLogger } from '../../shared/debugLogger';

export const CHAT_VIEW_TYPE = 'lumina-chat';

export class ChatView extends ItemView {
	private plugin: LuminaPlugin;
	private component: Record<string, unknown> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LuminaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Lumina';
	}

	getIcon(): string {
		return 'message-circle';
	}

	async onOpen(): Promise<void> {
		debugLogger.logSystem('chat_view', 'ChatView opened');
		this.contentEl.empty();
		this.contentEl.addClass('lumina-chat-view');

		// Svelte 컴포넌트를 비동기로 지연 로딩하여 플러그인 초기 로딩 속도 최적화
		try {
			const { default: Sidebar } = await import('../rag/ui/Sidebar.svelte');
			
			this.component = mount(Sidebar, {
				target: this.contentEl,
				props: { plugin: this.plugin },
			});
			debugLogger.logSystem('chat_view', 'ChatView component mounted');
		} catch (e) {
			debugLogger.logError('chat_view', e instanceof Error ? e : new Error(`ChatView mount failed: ${e}`));
			throw e;
		}
	}

	async onClose(): Promise<void> {
		debugLogger.logSystem('chat_view', 'ChatView closed');
		// Svelte 컴포넌트 정리
		// 플러그인 비활성화 시 옵시디언 설정창이 닫히는 현상을 완화하기 위해
		// DOM 제거 처리를 비동기로 지연
		if (this.component) {
			const comp = this.component;
			this.component = null;
			window.setTimeout(() => {
				try {
					void unmount(comp);
				} catch (e) {
					debugLogger.logError('chat_view', e instanceof Error ? e : new Error(`ChatView unmount error: ${e}`));
					console.error('[Lumina] unmount error:', e);
				}
			}, 0);
		}
	}
}
