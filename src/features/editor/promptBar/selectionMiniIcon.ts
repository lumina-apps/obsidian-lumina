import { StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, showTooltip, ViewPlugin } from '@codemirror/view';
import type { Tooltip, TooltipView, ViewUpdate } from '@codemirror/view';
import { setIcon, type Editor, type MarkdownFileInfo, type MarkdownView } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { t } from '../../../shared/locales/helpers';
import {
	hasPendingEditForView,
	openPromptBarEffect,
	resolveEditorAndViewForCm,
	setMiniIconEffect,
	type PromptBarFieldValue,
} from './promptBarState';

type TriggerPromptBarFn = (
	plugin: LuminaPlugin,
	editor: Editor,
	view: MarkdownView | MarkdownFileInfo,
) => boolean;

/**
 * 선택 영역 끝자락에 표시되는 작은 플로팅 AI 실행 버튼 툴팁.
 */
class SelectionMiniIconTooltipView implements TooltipView {
	dom: HTMLElement;

	constructor(plugin: LuminaPlugin, view: EditorView, onTriggerPromptBar: TriggerPromptBarFn) {
		const btn = createEl('button', {
			cls: 'lumina-mini-trigger',
			attr: {
				type: 'button',
				'aria-label': t('uiMessages.promptBar.commandTitle'),
			},
		});

		const iconEl = btn.createSpan({ cls: 'lumina-mini-trigger-icon' });
		setIcon(iconEl, 'sparkles');
		btn.createSpan({ cls: 'lumina-mini-trigger-label', text: 'AI' });

		// 마우스 클릭 시 에디터 선택 영역이 해제되지 않도록 기본 동작 차단
		// 터치(pointerdown)에서 preventDefault()를 호출하면 iOS/iPadOS WebKit에서 click 합성이 취소되므로 전파만 중단
		const preserveSelection = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
		};
		btn.addEventListener('mousedown', preserveSelection);
		btn.addEventListener('pointerdown', (e) => {
			e.stopPropagation();
		});

		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const resolved = resolveEditorAndViewForCm(plugin, view);
			if (!resolved) return;
			onTriggerPromptBar(plugin, resolved.editor, resolved.view);
		});

		this.dom = btn;
	}
}

/**
 * 텍스트 선택 시 플로팅 미니 AI 버튼을 표시하는 CM6 확장을 생성한다.
 */
export function buildSelectionMiniIconExtension(
	plugin: LuminaPlugin,
	promptBarField: StateField<PromptBarFieldValue>,
	onTriggerPromptBar: TriggerPromptBarFn,
): Extension[] {
	const miniIconField: StateField<Tooltip | null> = StateField.define<Tooltip | null>({
		create() {
			return null;
		},
		update(value, tr) {
			if (!plugin.settings.chat.enableSelectionMiniIcon) {
				return null;
			}
			if (tr.state.field(promptBarField, false)?.state.open) {
				return null;
			}
			if (tr.docChanged) {
				return null;
			}

			for (const effect of tr.effects) {
				if (effect.is(openPromptBarEffect)) {
					return null;
				}
				if (effect.is(setMiniIconEffect)) {
					const anchor = effect.value;
					if (!anchor) return null;
					if (value && value.pos === anchor.pos) return value;
					return {
						pos: anchor.pos,
						above: false,
						strictSide: false,
						create(view: EditorView) {
							return new SelectionMiniIconTooltipView(plugin, view, onTriggerPromptBar);
						},
					};
				}
			}

			if (tr.selection) {
				// 선택 변경 중에는 숨기고 ViewPlugin 디바운스 완료 후 다시 표시
				return null;
			}

			return value;
		},
		provide: (field) => showTooltip.from(field),
	});

	const miniIconPlugin = ViewPlugin.fromClass(
		class {
			private view: EditorView;
			private timer: number | null = null;
			private isPointerDown = false;
			private destroyed = false;

			private onPointerDown = () => {
				this.isPointerDown = true;
				if (this.timer !== null) {
					window.clearTimeout(this.timer);
					this.timer = null;
				}
			};

			private onPointerUp = () => {
				if (!this.isPointerDown) return;
				this.isPointerDown = false;
				this.scheduleCheck(80);
			};

			// 모바일 스크롤/선택 핸들 전환으로 pointercancel이 발생해도 고착되지 않도록 상태 해제
			private onPointerCancel = () => {
				if (!this.isPointerDown) return;
				this.isPointerDown = false;
				this.scheduleCheck(120);
			};

			constructor(view: EditorView) {
				this.view = view;
				view.dom.addEventListener('pointerdown', this.onPointerDown);
				window.addEventListener('pointerup', this.onPointerUp);
				window.addEventListener('pointercancel', this.onPointerCancel);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.selectionSet) {
					if (!plugin.settings.chat.enableSelectionMiniIcon) {
						if (this.timer !== null) {
							window.clearTimeout(this.timer);
							this.timer = null;
						}
						return;
					}
					if (this.isPointerDown) return;
					this.scheduleCheck(180);
				}
			}

			private scheduleCheck(delayMs: number): void {
				if (this.timer !== null) {
					window.clearTimeout(this.timer);
				}
				this.timer = window.setTimeout(() => {
					this.timer = null;
					if (this.destroyed || this.isPointerDown) return;
					if (!plugin.settings.chat.enableSelectionMiniIcon) return;
					if (this.view.state.field(promptBarField, false)?.state.open) return;

					const sel = this.view.state.selection.main;
					if (sel.empty) return;

					const selectedText = this.view.state.doc.sliceString(sel.from, sel.to);
					if (!selectedText || selectedText.trim().length === 0) return;

					if (hasPendingEditForView(plugin, this.view)) return;

					// 모바일에서도 OS 복사/붙여넣기 콜아웃 메뉴와 겹치지 않도록 선택 끝 하단에 배치
					const anchorPos = sel.to;
					this.view.dispatch({
						effects: setMiniIconEffect.of({ pos: anchorPos }),
					});
				}, delayMs);
			}

			destroy() {
				this.destroyed = true;
				if (this.timer !== null) {
					window.clearTimeout(this.timer);
					this.timer = null;
				}
				this.view.dom.removeEventListener('pointerdown', this.onPointerDown);
				window.removeEventListener('pointerup', this.onPointerUp);
				window.removeEventListener('pointercancel', this.onPointerCancel);
			}
		},
	);

	return [miniIconField, miniIconPlugin];
}
