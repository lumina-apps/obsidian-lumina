/**
 * chatView.ts
 *
 * Obsidian의 ItemView를 상속하여 ChatPanel.svelte를 사이드바 탭으로 마운트.
 * - 뷰 타입: 'lumina-chat'
 * - 아이콘: 'message-circle'
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LuminaPlugin from '../../main';
import Sidebar from '../rag/ui/Sidebar.svelte';

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
		this.contentEl.empty();
		this.contentEl.addClass('lumina-chat-view');

		// Svelte 컴포넌트를 Obsidian 탭 컨테이너에 마운트
		this.component = mount(Sidebar, {
			target: this.contentEl,
			props: { plugin: this.plugin },
		});
	}

	async onClose(): Promise<void> {
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
					console.error('[Lumina] unmount error:', e);
				}
			}, 0);
		}
	}
}
