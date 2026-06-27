import { ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';

export const GRAPH_VIEW_TYPE = 'lumina-graph';

export class GraphView extends ItemView {
	private plugin: LuminaPlugin;
	private component: Record<string, unknown> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LuminaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GRAPH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('graph.title');
	}

	getIcon(): string {
		return 'network';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('lumina-graph-view');

		// Mount Svelte component
		const { default: GraphPanel } = await import('./ui/GraphPanel.svelte');
		this.component = mount(GraphPanel, {
			target: this.contentEl,
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
					console.error('[Lumina] GraphView unmount error:', e);
				}
			}, 0);
		}
	}
}
