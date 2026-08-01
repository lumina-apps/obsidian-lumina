import { ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';

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
		debugLogger.logSystem('graph_view', 'GraphView opened');
		this.contentEl.empty();
		this.contentEl.addClass('lumina-graph-view');

		// Mount Svelte component
		try {
			const { default: GraphPanel } = await import('./ui/GraphPanel.svelte');
			this.component = mount(GraphPanel, {
				target: this.contentEl,
				props: { plugin: this.plugin },
			});
			debugLogger.logSystem('graph_view', 'GraphView component mounted');
		} catch (e) {
			debugLogger.logError('graph_view', e instanceof Error ? e : new Error(`GraphView mount failed: ${e}`));
			throw e;
		}
	}

	async onClose(): Promise<void> {
		debugLogger.logSystem('graph_view', 'GraphView closed');
		if (this.component) {
			const comp = this.component;
			this.component = null;
			window.setTimeout(() => {
				try {
					void unmount(comp);
				} catch (e) {
					debugLogger.logError('graph_view', e instanceof Error ? e : new Error(`GraphView unmount error: ${e}`));
					console.error('[Lumina] GraphView unmount error:', e);
				}
			}, 0);
		}
	}
}
