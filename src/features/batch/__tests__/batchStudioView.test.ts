import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { TFile, type WorkspaceLeaf } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import { resetBatchStore } from '../../../core/store/batchStore';
import {
	resetEntitlementState,
	setEntitlementState,
} from '../../../core/store/entitlementStore';
import { BatchStudioView } from '../batchStudioView';

describe('BatchStudioView 권한 가드', () => {
	beforeEach(() => {
		resetEntitlementState();
		resetBatchStore();
	});

	afterEach(() => {
		resetEntitlementState();
		resetBatchStore();
		vi.restoreAllMocks();
	});

	it('Pro 권한이 비활성화된 상태에서 onOpen이 호출되면 UI를 마운트하지 않고 즉시 leaf.detach()한다', async () => {
		const detach = vi.fn();
		const leaf = { detach } as unknown as WorkspaceLeaf;
		const plugin = {} as LuminaPlugin;
		const view = new BatchStudioView(leaf, plugin);
		const contentEl = document.createElement('div');
		Object.assign(view as unknown as { leaf: WorkspaceLeaf; contentEl: HTMLElement }, {
			leaf,
			contentEl,
		});

		await view.onOpen();

		expect(detach).toHaveBeenCalledTimes(1);
		expect(contentEl.childElementCount).toBe(0);
	});

	it('Pro 권한이 활성화된 상태에서 onOpen이 호출되면 BatchStudioPanel UI를 정상 마운트하고 onClose에서 정리한다', async () => {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['batch-studio']),
		});

		const detach = vi.fn();
		const leaf = { detach } as unknown as WorkspaceLeaf;
		const sampleFile = Object.assign(new TFile(), {
			path: 'Notes/demo.md',
			name: 'demo.md',
			basename: 'demo',
			extension: 'md',
			stat: { ctime: 0, mtime: 0, size: 200 },
		});
		const plugin = {
			app: {
				vault: {
					getMarkdownFiles: () => [sampleFile],
					getAllLoadedFiles: () => [sampleFile],
					on: vi.fn(() => ({})),
					offref: vi.fn(),
				},
				metadataCache: {
					getFileCache: () => null,
					on: vi.fn(() => ({})),
					offref: vi.fn(),
				},
				workspace: {
					openLinkText: vi.fn(),
				},
			},
			settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS,
		} as unknown as LuminaPlugin;

		const view = new BatchStudioView(leaf, plugin);
		const contentEl = document.createElement('div');
		Object.assign(view as unknown as { leaf: WorkspaceLeaf; contentEl: HTMLElement }, {
			leaf,
			contentEl,
		});

		await view.onOpen();
		flushSync();

		expect(detach).not.toHaveBeenCalled();
		expect(contentEl.querySelector('.lumina-batch-studio')).not.toBeNull();
		expect(contentEl.querySelectorAll('.lumina-batch-recipe-tab')).toHaveLength(4);

		await view.onClose();
	});
});
