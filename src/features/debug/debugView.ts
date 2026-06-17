/** Obsidian ItemView 래퍼. 우측 사이드바에 Lumina DevLog 패널 등록 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LuminaPlugin from '../../main';
import DebugPanel from './ui/DebugPanel.svelte';

export const DEBUG_VIEW_TYPE = 'lumina-debug-panel';

export class DebugView extends ItemView {
	private plugin: LuminaPlugin;
	private component: Record<string, unknown> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LuminaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return DEBUG_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Lumina DevLog';
	}

	getIcon(): string {
		return 'bug';
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lumina-debug-view');

		this.component = mount(DebugPanel, {
			target: contentEl,
			props: { plugin: this.plugin },
		});
	}

	async onClose(): Promise<void> {
		if (this.component) {
			const comp = this.component;
			this.component = null;
			window.setTimeout(() => {
				try {
					void unmount(comp);
				} catch (e) {
					console.error('[Lumina] debug panel unmount error:', e);
				}
			}, 0);
		}

		if (this.plugin.settings.misc.debugMode) {
			this.plugin.settings.misc.debugMode = false;
			this.plugin.saveSettings().catch(e => console.error('[Lumina] Failed to save settings on debug view close', e));
		}
	}
}
