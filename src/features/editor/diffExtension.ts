import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { editorInfoField, MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import { approvalStore, approvalManager, type ApprovalRequest, type ApprovalState } from '../chat/utils/approvalManager';
import { get } from 'svelte/store';
import { t } from '../../shared/locales/helpers';

export const setDiffs = StateEffect.define<ApprovalRequest | null>();

class DiffAddedWidget extends WidgetType {
	constructor(public text: string) { super(); }
	toDOM() {
		const div = createDiv({ cls: 'lumina-diff-added-widget' });
		
		// Remove trailing newline for visual neatness
		const display = this.text.replace(/\r?\n$/, '');
		
		const lines = display.split(/\r?\n/);
		lines.forEach(line => {
			div.createDiv({ cls: 'lumina-diff-added-line', text: '+ ' + line });
		});
		return div;
	}
}

/**
 * Per-chunk Accept/Reject buttons shown inline in the editor,
 * so users can review diffs and decide without switching to chat.
 */
class DiffActionWidget extends WidgetType {
	constructor(public requestId: string, public chunkId: string) { super(); }
	toDOM() {
		const div = createDiv({ cls: 'lumina-diff-action-widget' });
		
		const rejectBtn = div.createEl('button', { cls: 'lumina-diff-btn reject', text: '✕ Reject' });
		rejectBtn.onclick = () => approvalManager.rejectChunk(this.requestId, this.chunkId);
		
		const acceptBtn = div.createEl('button', { cls: 'lumina-diff-btn accept', text: '✓ Accept' });
		acceptBtn.onclick = () => approvalManager.acceptChunk(this.requestId, this.chunkId);
		
		return div;
	}
}

/**
 * Action bar at the top of the editor with Accept All / Reject All buttons
 * and an optional notice to switch to Source Mode when table diffs are present.
 */
class DiffBannerWidget extends WidgetType {
	constructor(
		public requestId: string,
		public hasTableChanges: boolean = false,
		public app?: App,
		public filePath?: string
	) { super(); }
	toDOM() {
		const div = createDiv({ cls: 'lumina-diff-banner' });
		
		const rejectBtn = div.createEl('button', { cls: 'lumina-diff-banner-btn reject', text: t('uiMessages.actionApproval.rejectAll') });
		rejectBtn.onclick = () => approvalManager.rejectAll(this.requestId);
		
		const acceptBtn = div.createEl('button', { cls: 'lumina-diff-banner-btn accept', text: t('uiMessages.actionApproval.acceptAll') });
		acceptBtn.onclick = () => approvalManager.acceptAll(this.requestId);

		if (this.hasTableChanges) {
			const notice = div.createDiv({ cls: 'lumina-diff-banner-table-notice' });
			notice.createSpan({
				cls: 'lumina-diff-banner-table-text',
				text: t('uiMessages.actionApproval.tableNotice') || '📊 Table modifications detected.'
			});
			if (this.app) {
				const switchBtn = notice.createEl('button', {
					cls: 'lumina-diff-banner-btn source-mode',
					text: t('uiMessages.actionApproval.switchToSourceMode') || 'Switch to Source Mode'
				});
				switchBtn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					const leaves = this.app?.workspace.getLeavesOfType('markdown') ?? [];
					for (const leaf of leaves) {
						const view = leaf.view as MarkdownView;
						if (view.file?.path === this.filePath || leaf === this.app?.workspace.activeLeaf) {
							const state = view.getState();
							state.mode = 'source';
							state.source = true;
							void view.setState(state, { history: false });
							break;
						}
					}
				};
			}
		}
		
		return div;
	}
}

const removedLineDeco = Decoration.line({ class: 'lumina-diff-removed-line' });

export const diffDecorationField = StateField.define<DecorationSet>({
	create() { return Decoration.none; },
	update(decos, tr) {
		let newDecos = decos.map(tr.changes);
		
		for (const e of tr.effects) {
			if (e.is(setDiffs)) {
				if (!e.value) return Decoration.none;
				
				const request = e.value;
				const builder = new RangeSetBuilder<Decoration>();
				const doc = tr.state.doc;
				
				let docLine = 1;
				const processedChunks = new Set<string>();
				const hasTableChanges = Boolean(request.chunks.some(c => c.isTable));
				const editorInfo = tr.state.field(editorInfoField, false) as { app?: App; file?: { path: string } } | null | undefined;

				// Add banner widget at the very top of the document
				if (doc.length > 0) {
					builder.add(0, 0, Decoration.widget({
						widget: new DiffBannerWidget(request.id, hasTableChanges, editorInfo?.app, request.filePath),
						block: true,
						side: -10
					}));
				}

				for (const change of request.allChanges) {
					const lines = change.value.split('\n');
					const numLines = change.count !== undefined
						? change.count
						: (change.value.endsWith('\n') ? lines.length - 1 : lines.length);

					if (change.chunkId && !processedChunks.has(change.chunkId)) {
						const chunk = request.chunks.find(c => c.id === change.chunkId);
						if (chunk && chunk.status === 'pending') {
							// Place action widget before the change block
							const targetLine = Math.min(doc.lines, Math.max(1, docLine));
							const pos = doc.line(targetLine).from;
							builder.add(pos, pos, Decoration.widget({
								widget: new DiffActionWidget(request.id, change.chunkId),
								block: true,
								side: -2
							}));
						}
						processedChunks.add(change.chunkId);
					}

					if (change.removed) {
						const chunk = change.chunkId ? request.chunks.find(c => c.id === change.chunkId) : null;
						const shouldShow = !chunk || chunk.status === 'pending';
						if (shouldShow) {
							for (let i = 0; i < numLines; i++) {
								const lineIdx = docLine + i;
								if (lineIdx <= doc.lines) {
									const lineObj = doc.line(lineIdx);
									builder.add(lineObj.from, lineObj.from, removedLineDeco);
								} else if (lineIdx === doc.lines + 1 && numLines === 1) {
									// Fallback for EOF boundary edge case
									const lineObj = doc.line(doc.lines);
									builder.add(lineObj.from, lineObj.from, removedLineDeco);
								}
							}
						}
						docLine += numLines;
					} else if (change.added) {
						const chunk = request.chunks.find(c => c.id === change.chunkId);
						if (chunk && chunk.status === 'pending') {
							const targetLine = Math.min(doc.lines, Math.max(1, docLine));
							const pos = docLine <= doc.lines ? doc.line(targetLine).from : doc.length;
							builder.add(pos, pos, Decoration.widget({
								widget: new DiffAddedWidget(change.value),
								block: true,
								side: -1
							}));
						}
					} else {
						docLine += numLines;
					}
				}
				
				try {
					newDecos = builder.finish();
				} catch(e) {
					console.error("Lumina: Error building diff decorations", e);
				}
				return newDecos;
			}
		}
		return newDecos;
	},
	provide: f => EditorView.decorations.from(f)
});

export const diffStorePlugin = ViewPlugin.fromClass(class {
	unsubscribe: () => void;
	view: EditorView;
	
	constructor(view: EditorView) {
		this.view = view;
		
		this.unsubscribe = approvalStore.subscribe(state => {
			window.setTimeout(() => {
				this.updateFromState(state);
			}, 0);
		});
	}

	update(update: ViewUpdate) {
		const oldInfo = update.startState.field(editorInfoField, false) as { file?: { path: string } } | null | undefined;
		const newInfo = update.state.field(editorInfoField, false) as { file?: { path: string } } | null | undefined;
		if (oldInfo?.file?.path !== newInfo?.file?.path) {
			window.setTimeout(() => {
				this.updateFromState(get(approvalStore));
			}, 0);
		}
	}

	updateFromState(state: ApprovalState) {
		const editorInfo = this.view.state.field(editorInfoField, false) as { file?: { path: string } } | null | undefined;
		const file = editorInfo?.file;
		
		if (file) {
			const request = state.queue.find((r) => r.filePath === file.path && r.actionType === 'edit');
			this.view.dispatch({
				effects: setDiffs.of(request ?? null)
			});
		} else {
			this.view.dispatch({
				effects: setDiffs.of(null)
			});
		}
	}
	
	destroy() {
		this.unsubscribe();
	}
});

export const inlineDiffExtension = [diffDecorationField, diffStorePlugin];