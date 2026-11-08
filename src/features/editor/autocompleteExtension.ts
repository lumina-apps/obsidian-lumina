import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, ViewUpdate, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import type { AutocompleteHandler } from './autocompleteHandler';

interface AutocompleteSuggestion {
	text: string;
	pos: number;
}

export const setSuggestion = StateEffect.define<AutocompleteSuggestion | null>();

	class GhostTextWidget extends WidgetType {
		constructor(public text: string) { super(); }
		toDOM() {
			const span = createSpan({ cls: 'lumina-autocomplete-ghost', text: this.text });
			return span;
		}
	}

export const autocompleteStateField = StateField.define<AutocompleteSuggestion | null>({
	create() { return null; },
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(setSuggestion)) {
				return e.value;
			}
		}
		if (tr.docChanged || tr.selection) {
			return null; // Clear suggestion on typing or moving cursor
		}
		return value;
	},
	provide: f => EditorView.decorations.from(f, val => {
		if (!val) return Decoration.none;
		return Decoration.set([
			Decoration.widget({
				widget: new GhostTextWidget(val.text),
				side: 1
			}).range(val.pos)
		]);
	})
});

export function splitFirstWord(text: string): { firstWord: string; remaining: string } {
	const match = text.match(/^\s*\S+/);
	const firstWord = match ? match[0] : text;
	const remaining = text.slice(firstWord.length);
	return { firstWord, remaining };
}

export const autocompleteKeymap = Prec.highest(keymap.of([
	{
		key: 'Tab',
		run: (view: EditorView) => {
			const suggestion = view.state.field(autocompleteStateField, false);
			if (suggestion && suggestion.text) {
				view.dispatch({
					changes: { from: suggestion.pos, insert: suggestion.text },
					selection: { anchor: suggestion.pos + suggestion.text.length },
					effects: setSuggestion.of(null)
				});
				return true;
			}
			return false;
		}
	},
	{
		key: 'ArrowRight',
		run: (view: EditorView) => {
			const suggestion = view.state.field(autocompleteStateField, false);
			if (!suggestion || !suggestion.text) return false;
			if (!view.state.selection.main.empty || view.state.selection.main.head !== suggestion.pos) {
				return false;
			}

			const { firstWord, remaining } = splitFirstWord(suggestion.text);
			const nextPos = suggestion.pos + firstWord.length;

			view.dispatch({
				changes: { from: suggestion.pos, insert: firstWord },
				selection: { anchor: nextPos },
				effects: setSuggestion.of(remaining ? { text: remaining, pos: nextPos } : null)
			});
			return true;
		}
	},
	{
		key: 'Escape',
		run: (view: EditorView) => {
			const suggestion = view.state.field(autocompleteStateField, false);
			if (suggestion && suggestion.text) {
				view.dispatch({
					effects: setSuggestion.of(null)
				});
				return true;
			}
			return false;
		}
	}
]));

export const autocompletePlugin = (handler: AutocompleteHandler) => ViewPlugin.fromClass(class {
	timer: number | null = null;
	view: EditorView;

	constructor(view: EditorView) {
		this.view = view;
	}

	update(update: ViewUpdate) {
		if (update.docChanged) {
			if (this.timer) window.clearTimeout(this.timer);

			// 제안 수락(Tab / ArrowRight)으로 인한 문서 변경 시에는 불필요한 재요청 타이머를 실행하지 않음
			const hasSuggestionEffect = update.transactions.some(tr =>
				tr.effects.some(e => e.is(setSuggestion))
			);
			if (hasSuggestionEffect) {
				return;
			}

			const waitTimeMs = handler.getWaitTimeMs();
			this.timer = window.setTimeout(() => {
				void (async () => {
					// Get current cursor
					const pos = this.view.state.selection.main.head;
					
					// Extract context before cursor
					const contextLength = handler.getContextLength();
					const startOffset = Math.max(0, pos - contextLength);
					const contextText = this.view.state.doc.sliceString(startOffset, pos);
					
					const suggestion = await handler.fetchSuggestion(contextText);
					
					if (suggestion) {
						// Check if cursor hasn't moved
						if (this.view.state.selection.main.head === pos) {
							this.view.dispatch({
								effects: setSuggestion.of({ text: suggestion, pos })
							});
						}
					}
				})();
			}, waitTimeMs);
		}
	}

	destroy() {
		if (this.timer) window.clearTimeout(this.timer);
	}
});

export function buildInlineAutocompleteExtension(handler: AutocompleteHandler) {
	return [
		autocompleteStateField,
		autocompleteKeymap,
		autocompletePlugin(handler)
	];
}
