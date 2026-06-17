/**
 * imeUtils.ts
 *
 * IME 입력(한글, 일본어 등)을 안전하게 처리하기 위한 유틸리티.
 * compositionstart/compositionend 이벤트를 활용하여
 * IME 조합 중에는 onChange가 발동하지 않도록 합니다.
 */

import type { TextComponent } from 'obsidian';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComposingSafeHandler {
	/** 이벤트 리스너를 제거합니다 */
	dispose: () => void;
	/** 현재 composing 상태인지 여부 */
	isComposing: () => boolean;
}

// ─── Core: IME-safe Event Handler ─────────────────────────────────────────────

/**
 * IME 입력(한글, 일본어 등) 중에는 onChange가 발동하지 않도록
 * compositionstart/compositionend 이벤트를 처리하는 핸들러를 input 요소에 부착합니다.
 *
 * Usage:
 * ```
 * const handler = createComposingSafeTextHandler(inputEl, (value) => {
 *   someState = value;
 *   void tab.saveAndSync();
 * });
 * // handler.dispose()로 이벤트 제거 가능
 * ```
 */
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

// ─── Obsidian Setting Binding Wrappers ────────────────────────────────────────

/**
 * Obsidian Setting.addText() 콜백에서 받은 TextComponent에 IME-safe 바인딩을 적용합니다.
 * 초기값을 설정하고, composition 이벤트로 IME 입력 중에는 onChange가 발동하지 않도록 합니다.
 *
 * Usage:
 * ```
 * setting.addText(text => {
 *   createImeTextBinding(text, myValue, async (val) => {
 *     myValue = val;
 *     await tab.saveAndSync();
 *   });
 * });
 * ```
 */
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
		handler.dispose();
		void onChange(val);
	});
}

/**
 * Obsidian Setting.addText() 콜백에서 받은 TextComponent에 IME-safe + password 타입 바인딩을 적용합니다.
 * inputEl.type을 'password'로 설정하고 placeholder도 함께 지정합니다.
 */
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
		handler.dispose();
		void onChange(val);
	});
}