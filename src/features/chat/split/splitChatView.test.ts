/**
 * splitChatView.test.ts
 *
 * SplitChatView의 메타데이터, Pro 권한 게이트(detach) 및
 * 권한 활성 시 Svelte 패널 마운트·언마운트 수명주기를 검증합니다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { WorkspaceLeaf } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import {
	resetEntitlementState,
	setEntitlementState,
} from '../../../core/store/entitlementStore';
import { resetSplitChat } from '../../../core/store/splitChatStore';
import { SPLIT_CHAT_VIEW_TYPE } from '../../../shared/constants/viewTypes';
import { t } from '../../../shared/locales/helpers';
import { SplitChatView } from './splitChatView';

describe('SplitChatView', () => {
	beforeEach(() => {
		resetEntitlementState();
		resetSplitChat(false);
	});

	afterEach(() => {
		vi.useRealTimers();
		resetEntitlementState();
		resetSplitChat(false);
		vi.restoreAllMocks();
	});

	it('getViewType, getDisplayText, getIcon이 올바른 뷰 식별 정보를 반환한다', () => {
		const leaf = { detach: vi.fn() } as unknown as WorkspaceLeaf;
		const view = new SplitChatView(leaf, {} as LuminaPlugin);

		expect(view.getViewType()).toBe(SPLIT_CHAT_VIEW_TYPE);
		expect(view.getDisplayText()).toBe(t('splitChat.title'));
		expect(view.getIcon()).toBe('lumina-split-chat');
	});

	it('Pro 권한이 비활성화된 상태에서 onOpen이 호출되면 UI를 마운트하지 않고 즉시 leaf.detach()한다', async () => {
		const detach = vi.fn();
		const leaf = { detach } as unknown as WorkspaceLeaf;
		const plugin = {} as LuminaPlugin;
		const view = new SplitChatView(leaf, plugin);
		const contentEl = document.createElement('div');
		Object.assign(view as unknown as { leaf: WorkspaceLeaf; contentEl: HTMLElement }, {
			leaf,
			contentEl,
		});

		await view.onOpen();

		expect(detach).toHaveBeenCalledTimes(1);
		expect(contentEl.childElementCount).toBe(0);
	});

	it('Pro 권한이 활성화된 상태에서 onOpen 시 SplitChatPanel을 마운트하고 onClose에서 안전하게 언마운트한다', async () => {
		vi.useFakeTimers();
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['split-chat']),
		});

		const detach = vi.fn();
		const leaf = { detach } as unknown as WorkspaceLeaf;
		const plugin = {
			app: {
				vault: {
					getMarkdownFiles: () => [],
					getAbstractFileByPath: () => null,
				},
				workspace: {
					getActiveFile: () => null,
				},
			},
			settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS,
		} as unknown as LuminaPlugin;

		const view = new SplitChatView(leaf, plugin);
		const contentEl = document.createElement('div');
		Object.assign(view as unknown as { leaf: WorkspaceLeaf; contentEl: HTMLElement }, {
			leaf,
			contentEl,
		});

		await view.onOpen();
		flushSync();

		expect(detach).not.toHaveBeenCalled();
		expect(contentEl.classList.contains('lumina-split-view')).toBe(true);
		expect(contentEl.childElementCount).toBeGreaterThan(0);

		await view.onClose();
		await vi.advanceTimersByTimeAsync(10);
		expect(contentEl.childElementCount).toBe(0);
	});
});
