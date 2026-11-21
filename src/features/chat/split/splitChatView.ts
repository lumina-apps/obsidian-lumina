/**
 * Obsidian 메인 워크스페이스 탭에서 멀티 모델 비교(Split / Arena) UI를 호스팅하는 ItemView.
 * Pro 권한이 비활성화된 상태에서는 Svelte 컴포넌트를 로드하지 않고 즉시 뷰를 닫습니다.
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LuminaPlugin from '../../../main';
import { canUseFeature } from '../../../core/store/entitlementStore';
import { SPLIT_CHAT_VIEW_TYPE } from '../../../shared/constants/viewTypes';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import { normalizeError } from '../../../shared/utils/errorUtils';

export { SPLIT_CHAT_VIEW_TYPE };

export class SplitChatView extends ItemView {
	private plugin: LuminaPlugin;
	private component: Record<string, unknown> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LuminaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return SPLIT_CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('splitChat.title');
	}

	getIcon(): string {
		return 'lumina-split-chat';
	}

	async onOpen(): Promise<void> {
		// 권한 미보유 시 컴포넌트를 동적 로드하지 않고 즉시 탭 닫기
		if (!canUseFeature('split-chat')) {
			this.leaf?.detach?.();
			return;
		}

		this.contentEl.empty();
		this.contentEl.addClass('lumina-split-view');

		try {
			const { default: SplitChatPanel } = await import('./ui/SplitChatPanel.svelte');
			if (!canUseFeature('split-chat')) {
				this.leaf.detach();
				return;
			}
			this.component = mount(SplitChatPanel, {
				target: this.contentEl,
				props: { plugin: this.plugin },
			});
			debugLogger.logSystem('split_view', 'SplitChatView component mounted');
		} catch (e) {
			debugLogger.logError('split_view', normalizeError(e, `SplitChatView mount failed: ${e}`));
			throw e;
		}
	}

	async onClose(): Promise<void> {
		debugLogger.logSystem('split_view', 'SplitChatView closed');
		if (this.component) {
			const comp = this.component;
			this.component = null;
			window.setTimeout(() => {
				try {
					void unmount(comp);
				} catch (e) {
					debugLogger.logError('split_view', normalizeError(e, `SplitChatView unmount error: ${e}`));
				}
			}, 0);
		}
	}
}
