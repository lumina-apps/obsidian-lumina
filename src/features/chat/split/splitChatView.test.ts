import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { resetEntitlementState } from '../../../core/store/entitlementStore';
import { SplitChatView } from './splitChatView';

describe('SplitChatView 권한 가드', () => {
	beforeEach(() => {
		resetEntitlementState();
	});

	afterEach(() => {
		resetEntitlementState();
		vi.restoreAllMocks();
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
});
