/**
 * canvasManager.ts
 *
 * Feature manager encapsulating Canvas visualization commands, context menu events, and exports.
 */

import { Menu, MenuItem, TFile, TFolder, type EventRef } from 'obsidian';
import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';
import {
	generateCanvasForFile,
	generateCanvasForFolder,
	generateCanvasForRagGraph,
} from './canvasGenerator';
import type { CanvasBuildOptions } from './canvasTypes';
import type { RagGraphCanvasOptions } from './ragGraphCanvasExporter';
import type { GraphData } from '../../shared/types/graph.types';

export class CanvasManager {
	private plugin: LuminaPlugin;
	private eventRefs: EventRef[] = [];

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	registerEvents(): void {
		// File Explorer Context Menu (file-menu)
		const fileMenuRef = this.plugin.app.workspace.on('file-menu', (menu, abstractFile) => {
			if (!this.plugin.settings.misc.contextMenuEnabled) return;

			if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
				menu.addItem((item) => {
					item
						.setTitle('🗺️ ' + t('canvas.menuItem'))
						.setIcon('map')
						.setSection('action')
						.onClick(async () => {
							debugLogger.logSystem('canvas', `file-menu: canvas generate triggered (file=${abstractFile.path})`);
							await this.generateForFile(abstractFile);
						});
				});
			} else if (abstractFile instanceof TFolder) {
				menu.addItem((item) => {
					item
						.setTitle('🗺️ ' + t('canvas.menuItemFolder'))
						.setIcon('map')
						.setSection('action')
						.onClick(async () => {
							debugLogger.logSystem('canvas', `file-menu: folder canvas generate triggered (folder=${abstractFile.path})`);
							await this.generateForFolder(abstractFile);
						});
				});
			}
		});
		this.plugin.registerEvent(fileMenuRef);
		this.eventRefs.push(fileMenuRef);
	}

	async generateForFile(file: TFile): Promise<void> {
		const opts = this.getCanvasOptions();
		await generateCanvasForFile(
			this.plugin.app,
			file,
			opts,
			this.plugin.settings.canvas.outputPath,
			this.plugin.settings.canvas.showFolderGroups,
		);
	}

	async generateForFolder(folder: TFolder): Promise<void> {
		const opts = this.getCanvasOptions();
		await generateCanvasForFolder(
			this.plugin.app,
			folder,
			opts,
			this.plugin.settings.canvas.outputPath,
			this.plugin.settings.canvas.showFolderGroups,
		);
	}

	async exportRagGraph(graphData: GraphData, opts?: Partial<RagGraphCanvasOptions>): Promise<void> {
		const fullOpts: RagGraphCanvasOptions = {
			showSimilarityLabel: opts?.showSimilarityLabel ?? false,
			showGroups: opts?.showGroups ?? this.plugin.settings.canvas.showFolderGroups,
		};
		await generateCanvasForRagGraph(
			this.plugin.app,
			graphData,
			fullOpts,
			this.plugin.settings.canvas.outputPath,
		);
	}

	getCanvasOptions(): CanvasBuildOptions {
		const s = this.plugin.settings.canvas;
		return {
			depth: s.depth,
			layout: s.layout,
			bidirectional: s.bidirectional,
			includeAttachments: s.includeAttachments,
			maxNodes: s.maxNodes,
			folderDepth: s.folderDepth,
		};
	}

	destroy(): void {
		for (const ref of this.eventRefs) {
			this.plugin.app.workspace.offref(ref);
		}
		this.eventRefs = [];
	}
}

