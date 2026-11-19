import { StateField, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, Decoration, showTooltip } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { Editor, MarkdownView, Notice, Platform, editorInfoField } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type LuminaPlugin from '../../main';
import { t } from '../../shared/locales/helpers';
import {
	INITIAL_STATE,
	closePromptBarEffect,
	getCmEditorView,
	hasPendingEditForView,
	openPromptBarEffect,
	pluginFieldMap,
	resolveTargetRange,
	sessionPromptBarModeMap,
	setMiniIconEffect,
	updatePromptBarEffect,
	viewContextMap,
	type PromptBarFieldValue,
	type PromptBarInternalState,
	type PromptBarPhase,
} from './promptBar/promptBarState';
import { DiffStreamingWidget } from './promptBar/promptBarDom';
import { PromptBarTooltipView } from './promptBar/promptBarTooltipView';
import { buildSelectionMiniIconExtension } from './promptBar/selectionMiniIcon';

export type { PromptBarPhase, PromptBarInternalState };
export {
	openPromptBarEffect,
	updatePromptBarEffect,
	closePromptBarEffect,
	setMiniIconEffect,
	getCmEditorView,
	resolveTargetRange,
};

const targetRangeMark = Decoration.mark({ class: 'lumina-promptbar-target-highlight' });
const targetReplacingMark = Decoration.mark({ class: 'lumina-promptbar-target-replacing' });

/**
 * 에디터 선택 영역(또는 현재 줄) 위에 플로팅 즉석 프롬프트 바를 연다.
 */
export function openPromptBar(
	plugin: LuminaPlugin,
	editor: Editor,
	view: MarkdownView | MarkdownFileInfo,
	initialPrompt?: string,
): boolean {
	const cmView = getCmEditorView(editor);
	if (!cmView) {
		return false;
	}

	const field = pluginFieldMap.get(plugin);
	if (!field) {
		return false;
	}

	viewContextMap.set(cmView, { editor, view });

	const existing = cmView.state.field(field, false);
	if (existing?.state.open) {
		// 이미 열려 있으면 입력창에 포커스 유도 (새 초기 프롬프트가 주어진 경우에만 내용 갱신)
		if (initialPrompt !== undefined && existing.state.phase === 'input') {
			cmView.dispatch({
				effects: updatePromptBarEffect.of({ prompt: initialPrompt }),
			});
		}
		const inputEl = cmView.dom.querySelector<HTMLTextAreaElement>('.lumina-promptbar-input');
		inputEl?.focus();
		return true;
	}

	const range = resolveTargetRange(editor, cmView);
	if (!range) {
		new Notice(t('uiMessages.inlineEmpty'));
		return false;
	}

	if (hasPendingEditForView(plugin, cmView, view)) {
		new Notice(t('uiMessages.promptBar.pendingDiffExists'));
		return false;
	}

	cmView.dispatch({
		effects: openPromptBarEffect.of({
			from: range.from,
			to: range.to,
			originalText: range.text,
			initialPrompt,
		}),
	});
	return true;
}

/**
 * CM6 에디터 플로팅 즉석 프롬프트 바 및 선택 영역 미니 AI 버튼 확장을 생성한다.
 */
export function buildPromptBarExtension(plugin: LuminaPlugin): Extension {
	const promptBarField: StateField<PromptBarFieldValue> = StateField.define<PromptBarFieldValue>({
		create() {
			return {
				state: { ...INITIAL_STATE },
				tooltip: null,
			};
		},
		update(value, tr) {
			let nextState = value.state;
			let nextTooltip = value.tooltip;

			// 같은 뷰에서 다른 노트로 전환되면 열린 프롬프트 바를 정리
			if (editorInfoField && nextState.open) {
				const oldFile = tr.startState.field(editorInfoField, false)?.file?.path;
				const newFile = tr.state.field(editorInfoField, false)?.file?.path;
				if (oldFile !== newFile) {
					nextState = { ...INITIAL_STATE };
					nextTooltip = null;
					return { state: nextState, tooltip: nextTooltip };
				}
			}

			if (tr.docChanged && nextState.open) {
				const docLen = tr.state.doc.length;
				const mappedFrom = Math.max(0, Math.min(tr.changes.mapPos(nextState.from, 1), docLen));
				const mappedTo = Math.max(mappedFrom, Math.min(tr.changes.mapPos(nextState.to, -1), docLen));
				nextState = {
					...nextState,
					from: mappedFrom,
					to: mappedTo,
				};
			}

			for (const effect of tr.effects) {
				if (effect.is(openPromptBarEffect)) {
					const payload = effect.value;
					const newState: PromptBarInternalState = {
						open: true,
						phase: 'input',
						from: payload.from,
						to: payload.to,
						originalText: payload.originalText,
						prompt: payload.initialPrompt ?? '',
						mode: sessionPromptBarModeMap.get(plugin) ?? 'replace',
						errorMessage: null,
						approvalRequestId: null,
						streamingPreview: '',
						isThinking: false,
					};
					nextState = newState;
					nextTooltip = {
						pos: payload.from,
						end: payload.to,
						above: !Platform.isMobile,
						strictSide: false,
						create(view: EditorView) {
							return new PromptBarTooltipView(plugin, view, promptBarField, newState);
						},
					};
				} else if (effect.is(updatePromptBarEffect)) {
					if (nextState.open) {
						nextState = {
							...nextState,
							...effect.value,
						};
					}
				} else if (effect.is(closePromptBarEffect)) {
					nextState = { ...INITIAL_STATE };
					nextTooltip = null;
				}
			}

			if (nextState === value.state && nextTooltip === value.tooltip) {
				return value;
			}
			return { state: nextState, tooltip: nextTooltip };
		},
		provide(field) {
			return [
				showTooltip.from(field, (val) => val.tooltip),
				EditorView.decorations.compute([field], (state): DecorationSet => {
					const val = state.field(field);
					if (!val.state.open) {
						return Decoration.none;
					}

					const docLen = state.doc.length;
					const from = Math.max(0, Math.min(val.state.from, docLen));
					const to = Math.max(from, Math.min(val.state.to, docLen));
					const isStreamingPreview =
						val.state.phase === 'generating' && val.state.streamingPreview.length > 0;

					const builder = new RangeSetBuilder<Decoration>();
					if (from < to) {
						const mark =
							isStreamingPreview && val.state.mode === 'replace'
								? targetReplacingMark
								: targetRangeMark;
						builder.add(from, to, mark);
					}
					if (isStreamingPreview) {
						const lineEnd = state.doc.lineAt(to).to;
						builder.add(
							lineEnd,
							lineEnd,
							Decoration.widget({
								widget: new DiffStreamingWidget(val.state.streamingPreview),
								block: true,
								side: 1,
							}),
						);
					}
					return builder.finish();
				}),
			];
		},
	});

	const miniIconExtensions = buildSelectionMiniIconExtension(plugin, promptBarField, openPromptBar);

	pluginFieldMap.set(plugin, promptBarField);
	return [promptBarField, ...miniIconExtensions];
}
