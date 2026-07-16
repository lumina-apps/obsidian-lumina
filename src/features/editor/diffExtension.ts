import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { approvalStore, approvalManager, type ApprovalRequest, type ApprovalState } from '../chat/utils/approvalManager';
import { get } from 'svelte/store';

export const setDiffs = StateEffect.define<ApprovalRequest | null>();

class DiffAddedWidget extends WidgetType {
	constructor(public text: string) { super(); }
	toDOM() {
		const div = document.createElement('div');
		div.className = 'lumina-diff-added-widget';
		
			// Remove trailing newline for visual neatness
		const display = this.text.endsWith('\n') ? this.text.slice(0, -1) : this.text;
		
		const lines = display.split('\n');
		lines.forEach(line => {
			const lineDiv = document.createElement('div');
			lineDiv.className = 'lumina-diff-added-line';
			lineDiv.innerText = '+ ' + line;
			div.appendChild(lineDiv);
		});
		return div;
	}
}

class DiffActionWidget extends WidgetType {
	constructor(public requestId: string, public chunkId: string) { super(); }
	toDOM() {
		const div = document.createElement('div');
		div.className = 'lumina-diff-action-widget';
		
		const acceptBtn = document.createElement('button');
		acceptBtn.innerText = '✓ Accept';
		acceptBtn.className = 'lumina-diff-btn accept';
		acceptBtn.onclick = () => approvalManager.acceptChunk(this.requestId, this.chunkId);
		
		const rejectBtn = document.createElement('button');
		rejectBtn.innerText = '✗ Reject';
		rejectBtn.className = 'lumina-diff-btn reject';
		rejectBtn.onclick = () => approvalManager.rejectChunk(this.requestId, this.chunkId);
		
		div.appendChild(acceptBtn);
		div.appendChild(rejectBtn);
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

				for (const change of request.allChanges) {
					const lines = change.value.split('\n');
					const numLines = change.value.endsWith('\n') ? lines.length - 1 : lines.length;

					if (change.chunkId && !processedChunks.has(change.chunkId)) {
						const chunk = request.chunks.find(c => c.id === change.chunkId);
						if (chunk && chunk.status === 'pending') {
							// Place action widget before the change block
							const pos = Math.min(doc.length, docLine <= doc.lines ? doc.line(docLine).from : doc.length);
							builder.add(pos, pos, Decoration.widget({
								widget: new DiffActionWidget(request.id, change.chunkId),
								block: true,
								side: -2
							}));
							processedChunks.add(change.chunkId);
						}
					}

					if (change.removed) {
						for (let i = 0; i < numLines; i++) {
							if (docLine + i <= doc.lines) {
								const lineObj = doc.line(docLine + i);
								builder.add(lineObj.from, lineObj.from, removedLineDeco);
							}
						}
						docLine += numLines;
					} else if (change.added) {
						const chunk = request.chunks.find(c => c.id === change.chunkId);
						if (chunk && chunk.status === 'pending') {
							const pos = Math.min(doc.length, docLine <= doc.lines ? doc.line(docLine).from : doc.length);
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
		// editorInfoField가 변경되어 파일 정보가 뒤늦게 들어올 때를 대비함
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
