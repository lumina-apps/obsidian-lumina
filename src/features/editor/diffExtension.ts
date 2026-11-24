import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { editorInfoField, MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import { approvalStore, approvalManager, type ApprovalRequest, type ApprovalState } from '../../core/store/approvalStore';
import { get } from 'svelte/store';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import { computeInlineDiff, splitDiffLines, type InlineSegment, type MergedLine } from '../../shared/utils/inlineDiff';

export const setDiffs = StateEffect.define<ApprovalRequest | null>();

class DiffAddedWidget extends WidgetType {
	constructor(
		public text: string,
		public inlineLines?: (InlineSegment[] | null)[],
		/** 삭제 줄에 인라인으로 병합되어 이 위젯에서는 숨길 줄 인덱스 */
		public skipLines?: Set<number>,
	) { super(); }
	toDOM() {
		const div = createDiv({ cls: 'lumina-diff-added-widget' });

		// Remove trailing newline for visual neatness
		const display = this.text.replace(/\r?\n$/, '');

		const lines = display.split(/\r?\n/);
		lines.forEach((line, idx) => {
			if (this.skipLines?.has(idx)) return;
			const lineEl = div.createDiv({ cls: 'lumina-diff-added-line' });
			lineEl.appendChild(document.createTextNode('+ '));
			const segments = this.inlineLines?.[idx];
			if (segments && segments.length > 0) {
				for (const seg of segments) {
					if (seg.changed) {
						lineEl.createSpan({ cls: 'lumina-diff-inline-added', text: seg.text });
					} else {
						lineEl.appendChild(document.createTextNode(seg.text));
					}
				}
			} else {
				lineEl.appendChild(document.createTextNode(line));
			}
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
	toDOM(view?: EditorView) {
		const div = createDiv({ cls: 'lumina-diff-banner' });
		
		const rejectBtn = div.createEl('button', { cls: 'lumina-diff-banner-btn reject', text: t('uiMessages.actionApproval.rejectAll') });
		rejectBtn.onclick = () => approvalManager.rejectAll(this.requestId);
		
		const acceptBtn = div.createEl('button', { cls: 'lumina-diff-banner-btn accept', text: t('uiMessages.actionApproval.acceptAll') });
		acceptBtn.onclick = () => approvalManager.acceptAll(this.requestId);

		const isSourceMode = Boolean(
			view?.dom?.closest?.('.markdown-source-view') && !view.dom.closest('.is-live-preview'),
		);

		if (this.hasTableChanges && !isSourceMode) {
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
					const activeView = this.app?.workspace.getActiveViewOfType(MarkdownView);
					const leaves = this.app?.workspace.getLeavesOfType('markdown') ?? [];
					for (const leaf of leaves) {
						const view = leaf.view as MarkdownView;
						if (view.file?.path === this.filePath || (activeView && view === activeView)) {
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
const mergedLineDeco = Decoration.line({ class: 'lumina-diff-merged-line' });
const removedInlineDeco = Decoration.mark({ class: 'lumina-diff-inline-removed' });

/** 병합된 줄에서 삭제 단어 바로 뒤에 추가 단어를 인라인으로 보여주는 위젯 */
class DiffInlineAddedWidget extends WidgetType {
	constructor(public text: string) { super(); }
	eq(other: DiffInlineAddedWidget) { return other.text === this.text; }
	toDOM() {
		return createSpan({ cls: 'lumina-diff-inline-added', text: this.text });
	}
}

interface InlineMaps {
	/** 변경 인덱스별 줄 단위 인라인 세그먼트 */
	segments: Map<number, (InlineSegment[] | null)[]>;
	/** 삭제 변경 인덱스별 병합 가능한 줄 쌍 */
	merged: Map<number, MergedLine[]>;
}

/**
 * 연속된 삭제/추가 블록 쌍에 대해 줄별 인라인 diff 세그먼트와 병합 줄 정보를 미리 계산합니다.
 */
function buildInlineMap(allChanges: ApprovalRequest['allChanges']): InlineMaps {
	const segments = new Map<number, (InlineSegment[] | null)[]>();
	const merged = new Map<number, MergedLine[]>();
	for (let i = 0; i < allChanges.length - 1; i++) {
		if (allChanges[i].removed && allChanges[i + 1].added) {
			const inline = computeInlineDiff(allChanges[i].value, allChanges[i + 1].value);
			segments.set(i, inline.removed);
			segments.set(i + 1, inline.added);
			if (inline.merged.length > 0) {
				merged.set(i, inline.merged);
			}
		}
	}
	return { segments, merged };
}

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
				const inlineMaps = buildInlineMap(request.allChanges);
				/** 추가 변경 인덱스별로 삭제 줄에 병합 완료된 추가 줄 인덱스 */
				const mergedAddedLines = new Map<number, Set<number>>();

				try {
					// Add banner widget at the very top of the document
					if (doc.length > 0) {
						builder.add(0, 0, Decoration.widget({
							widget: new DiffBannerWidget(request.id, hasTableChanges, editorInfo?.app, request.filePath),
							block: true,
							side: -10
						}));
					}

					for (let changeIdx = 0; changeIdx < request.allChanges.length; changeIdx++) {
						const change = request.allChanges[changeIdx];
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
							const inlineLines = inlineMaps.segments.get(changeIdx);
							const expectedLines = inlineLines ? splitDiffLines(change.value) : null;
							const mergedByRemoved = new Map<number, MergedLine>();
							for (const m of inlineMaps.merged.get(changeIdx) ?? []) {
								mergedByRemoved.set(m.removedIdx, m);
							}

							if (shouldShow) {
								for (let i = 0; i < numLines; i++) {
									const lineIdx = docLine + i;
									if (lineIdx <= doc.lines) {
										const lineObj = doc.line(lineIdx);

										// 짝이 맞는 삭제/추가 줄은 한 줄로 병합: 삭제 단어에 취소선, 추가 단어는 바로 뒤에 인라인 표시
										const mergedLine = mergedByRemoved.get(i);
										if (mergedLine && expectedLines && lineObj.text === expectedLines[i]) {
											builder.add(lineObj.from, lineObj.from, mergedLineDeco);

											const inlineDecos: Array<{ from: number; to: number; deco: Decoration }> = [];
											let offset = 0;
											for (const seg of mergedLine.segments) {
												const segFrom = lineObj.from + offset;
												if (seg.kind === 'added') {
													inlineDecos.push({
														from: segFrom,
														to: segFrom,
														deco: Decoration.widget({ widget: new DiffInlineAddedWidget(seg.text), side: 1 }),
													});
												} else {
													if (seg.kind === 'removed' && seg.text.length > 0) {
														inlineDecos.push({ from: segFrom, to: segFrom + seg.text.length, deco: removedInlineDeco });
													}
													offset += seg.text.length;
												}
											}
											// RangeSetBuilder는 from, startSide 순 정렬이 필요하다
											inlineDecos.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
											for (const item of inlineDecos) {
												builder.add(item.from, item.to, item.deco);
											}

											const applied = mergedAddedLines.get(changeIdx + 1) ?? new Set<number>();
											applied.add(mergedLine.addedIdx);
											mergedAddedLines.set(changeIdx + 1, applied);
											continue;
										}

										builder.add(lineObj.from, lineObj.from, removedLineDeco);

										const segments = inlineLines?.[i];
										if (segments && expectedLines && lineObj.text === expectedLines[i]) {
											let offset = 0;
											for (const seg of segments) {
												const segLen = seg.text.length;
												if (seg.changed && segLen > 0) {
													const markFrom = Math.min(lineObj.to, lineObj.from + offset);
													const markTo = Math.min(lineObj.to, lineObj.from + offset + segLen);
													if (markFrom < markTo) {
														builder.add(markFrom, markTo, removedInlineDeco);
													}
												}
												offset += segLen;
											}
										}
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
								const skipLines = mergedAddedLines.get(changeIdx);
								const addedLineCount = splitDiffLines(change.value).length;
								// 모든 줄이 삭제 줄에 병합되었다면 별도 추가 위젯은 생략
								if (!skipLines || skipLines.size < addedLineCount) {
									const targetLine = Math.min(doc.lines, Math.max(1, docLine));
									const pos = docLine <= doc.lines ? doc.line(targetLine).from : doc.length;
									builder.add(pos, pos, Decoration.widget({
										widget: new DiffAddedWidget(change.value, inlineMaps.segments.get(changeIdx), skipLines),
										block: true,
										side: -1
									}));
								}
							}
						} else {
							docLine += numLines;
						}
					}

					newDecos = builder.finish();
				} catch (err) {
					debugLogger.logError('editor_diff', normalizeError(err, `Error building diff decorations: ${err}`));
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