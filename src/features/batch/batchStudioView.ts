/**
 * batchStudioView.ts
 *
 * Obsidian 메인 워크스페이스 탭에서 볼트 전체 AI 일괄 작업(Batch Studio) UI를 호스팅하는 ItemView.
 * Pro 권한이 비활성화된 상태에서는 Svelte 컴포넌트를 로드하지 않고 즉시 뷰를 닫습니다.
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LuminaPlugin from '../../main';
import { setBatchTargetFolder } from '../../core/store/batchStore';
import { canUseFeature } from '../../core/store/entitlementStore';
import { BATCH_STUDIO_VIEW_TYPE } from '../../shared/constants/viewTypes';
import { debugLogger } from '../../shared/debugLogger';
import { t } from '../../shared/locales/helpers';
import { normalizeError } from '../../shared/utils/errorUtils';

export { BATCH_STUDIO_VIEW_TYPE };

/** Lumina Batch Studio 중앙 탭 ItemView */
export class BatchStudioView extends ItemView {
	private plugin: LuminaPlugin;
	private component: Record<string, unknown> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LuminaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return BATCH_STUDIO_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('batchStudio.title');
	}

	getIcon(): string {
		return 'lumina-batch-studio';
	}

	/**
	 * 폴더 컨텍스트 메뉴 등에서 특정 폴더를 대상으로 바로 열 때 호출합니다.
	 */
	setInitialFolder(folderPath: string): void {
		setBatchTargetFolder(folderPath);
	}

	async onOpen(): Promise<void> {
		// 권한 미보유 시 컴포넌트를 동적 로드하지 않고 즉시 탭 닫기
		if (!canUseFeature('batch-studio')) {
			this.leaf?.detach?.();
			return;
		}

		this.contentEl.empty();
		this.contentEl.addClass('lumina-batch-view');

		try {
			const { default: BatchStudioPanel } = await import('./ui/BatchStudioPanel.svelte');
			if (!canUseFeature('batch-studio')) {
				this.leaf?.detach?.();
				return;
			}
			this.component = mount(BatchStudioPanel, {
				target: this.contentEl,
				props: { plugin: this.plugin },
			});
			debugLogger.logSystem('batch_view', 'BatchStudioView component mounted');
		} catch (e) {
			debugLogger.logError('batch_view', normalizeError(e, `BatchStudioView mount failed: ${e}`));
			throw e;
		}
	}

	async onClose(): Promise<void> {
		debugLogger.logSystem('batch_view', 'BatchStudioView closed');
		if (this.component) {
			const comp = this.component;
			this.component = null;
			window.setTimeout(() => {
				try {
					void unmount(comp);
				} catch (e) {
					debugLogger.logError('batch_view', normalizeError(e, `BatchStudioView unmount error: ${e}`));
				}
			}, 0);
		}
	}
}
