/** IME 입력 중 onChange 발동 방지 유틸리티 */

import type { TextComponent } from 'obsidian';

export interface ComposingSafeHandler {
	dispose: () => void;
	isComposing: () => boolean;
}

/** composition 이벤트로 IME 조합 중 onChange 방지 */
export function createComposingSafeTextHandler(
	inputEl: HTMLInputElement | HTMLTextAreaElement,
	onCommit: (value: string) => void,
): ComposingSafeHandler {
	let composing = false;

	const onCompositionStart = () => { composing = true; };
	const onCompositionEnd = () => {
		composing = false;
		onCommit(inputEl.value);
	};
	const onChange = () => {
		if (composing) return;
		onCommit(inputEl.value);
	};

	inputEl.addEventListener('compositionstart', onCompositionStart);
	inputEl.addEventListener('compositionend', onCompositionEnd);
	// input 이벤트는 composition과 별도로 발생하므로 직접 감시
	inputEl.addEventListener('input', onChange);

	return {
		dispose: () => {
			inputEl.removeEventListener('compositionstart', onCompositionStart);
			inputEl.removeEventListener('compositionend', onCompositionEnd);
			inputEl.removeEventListener('input', onChange);
		},
		isComposing: () => composing,
	};
}

/** Obsidian TextComponent에 IME-safe 바인딩 적용 */
export function createImeTextBinding(
	text: TextComponent,
	initialValue: string,
	onChange: (val: string) => Promise<void>,
): void {
	const handler = createComposingSafeTextHandler(text.inputEl, (val) => {
		void onChange(val);
	});
	text.setValue(initialValue);
	text.onChange((val: string) => {
		if (handler.isComposing()) return;
		void onChange(val);
	});
}

/** Obsidian TextComponent에 IME-safe + password 타입 바인딩 적용 */
export function createImePasswordBinding(
	text: TextComponent,
	initialValue: string,
	placeholder: string,
	onChange: (val: string) => Promise<void>,
): void {
	text.inputEl.type = 'password';
	const handler = createComposingSafeTextHandler(text.inputEl, (val) => {
		void onChange(val);
	});
	text.setValue(initialValue);
	text.setPlaceholder(placeholder);
	text.onChange((val: string) => {
		if (handler.isComposing()) return;
		void onChange(val);
	});
}