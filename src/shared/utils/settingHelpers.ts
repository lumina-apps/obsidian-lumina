/**
 * settingHelpers.ts
 *
 * 설정 탭에서 공통으로 사용되는 유틸리티 함수 모음.
 * - 모델 옵션 빌더
 * - 프로바이더-모델 값 파싱
 * - IME 입력 안전 텍스트 핸들러
 * - 슬라이더+숫자입력 콤보
 * - 모델 셀렉터 (FuzzyModal / Dropdown)
 * - 비동기 래퍼 (wrapAsync)
 * - 임베딩 모델 판별기
 */

import { App, FuzzySuggestModal, Notice, Setting, TextComponent } from 'obsidian';
import { PROVIDER_LABELS, PROVIDER_CATEGORIES } from '../types/settings.types';
import type { LLMProviderConfig, ProviderType } from '../types/settings.types';
import { debugLogger } from '../debugLogger';
import type { FuzzyMatch } from 'obsidian';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** FuzzyModelSuggestModal로 전환할 옵션 개수 임계값 */
export const FUZZY_MODAL_THRESHOLD = 30;
/** MCP 서버 토글 후 UI 리프레시 대기 시간 (ms) */
export const MCP_REFRESH_DELAY = 1500;
/** 추론형 모델 경고 Notice 표시 시간 (ms) */
export const REASONING_MODEL_NOTICE_DURATION = 10000;

// ─── UI Helpers ───────────────────────────────────────────────────────────────

/** feature-card 생성: is-active 클래스는 active일 때만 추가 */
export function createFeatureCard(el: HTMLElement, active: boolean): HTMLDivElement {
	const cls = 'lumina-feature-card' + (active ? ' is-active' : '');
	return el.createDiv({ cls });
}

/** multiline document fragment 생성 (개행 포함) */
export function createMultilineDesc(text: string): DocumentFragment {
	const frag = activeDocument.createDocumentFragment();
	text.split('\n').forEach((line, i) => {
		if (i > 0) frag.createEl('br');
		frag.appendText(line);
	});
	return frag;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModelOption {
	value: string;
	label: string;
}

export type ModelFilterFn = (providerType: ProviderType, modelId: string) => boolean;

export interface ParsedProviderModel {
	providerId: string;
	modelId: string;
}

// ─── Embedding Model Detector ─────────────────────────────────────────────────

/**
 * 프로바이더 타입별로 임베딩 전용 모델인지 판별합니다.
 * 클라우드 프로바이더는 모델명 패턴으로 필터링.
 * 로컬/커스텀은 판별 불가 → 전체 허용 + ⚠️ 표시.
 */
export function isEmbeddingModel(providerType: ProviderType, modelId: string): boolean {
	const category = PROVIDER_CATEGORIES[providerType];
	if (category === 'local' || providerType === 'custom') return true;

	switch (providerType) {
		case 'anthropic':
		case 'xai':
		case 'groq':
			return false; // 임베딩 모델 없음
		default:
			return modelId.toLowerCase().includes('embedding');
	}
}

// ─── Model Option Builders ────────────────────────────────────────────────────

/**
 * 검증된 프로바이더 목록에서 모델 옵션 배열을 생성합니다.
 *
 * @param providers - 전체 프로바이더 설정 배열
 * @param filter - 모델 포함 여부를 결정하는 필터 함수.
 *                 (providerType, modelId) => boolean.
 *                 true를 반환한 모델만 옵션에 포함.
 * @param localWarning - 로컬/커스텀 프로바이더의 모델에 붙일 경고 접미사 (기본 ' ⚠️')
 * @returns ModelOption 배열. 값은 `${providerId}::${modelId}` 형태.
 */
export function buildProviderModelOptions(
	providers: LLMProviderConfig[],
	filter: ModelFilterFn,
	localWarning: string = ' ⚠️',
): ModelOption[] {
	const options: ModelOption[] = [];
	const verified = providers.filter(p => p.isVerified && p.availableModels.length > 0);

	for (const p of verified) {
		const isLocal = PROVIDER_CATEGORIES[p.type] === 'local' || p.type === 'custom';
		for (const model of p.availableModels) {
			if (!filter(p.type, model)) continue;
			const label = isLocal
				? `[${PROVIDER_LABELS[p.type]}] ${model}${localWarning}`
				: `[${PROVIDER_LABELS[p.type]}] ${model}`;
			options.push({ value: `${p.id}::${model}`, label });
		}
	}

	return options;
}

/**
 * 채팅용 모델 옵션을 생성합니다 (임베딩 모델 제외).
 * buildProviderModelOptions의 채팅 특화 래퍼입니다.
 */
export function buildChatModelOptions(providers: LLMProviderConfig[]): ModelOption[] {
	return buildProviderModelOptions(providers, (type, modelId) => {
		const isLocal = PROVIDER_CATEGORIES[type] === 'local' || type === 'custom';
		if (isLocal) return true;
		return !isEmbeddingModel(type, modelId);
	});
}

/**
 * 임베딩용 모델 옵션을 생성합니다.
 * 클라우드는 isEmbeddingModel()로 필터링, 로컬은 전체 허용.
 * anthropic은 임베딩 모델을 제공하지 않으므로 자동 제외.
 */
export function buildEmbeddingModelOptions(providers: LLMProviderConfig[]): ModelOption[] {
	return buildProviderModelOptions(providers, (type, modelId) => {
		if (PROVIDER_CATEGORIES[type] === 'local' || type === 'custom') return true;
		if (type === 'anthropic') return false;
		return isEmbeddingModel(type, modelId);
	});
}

// ─── Value Parser ─────────────────────────────────────────────────────────────

/**
 * "providerId::modelId" 형식의 문자열을 파싱합니다.
 *
 * @param raw - "pid::modelId" 형식의 문자열
 * @returns { providerId, modelId } 또는 null (형식이 올바르지 않을 경우)
 */
export function parseProviderModelValue(raw: string): ParsedProviderModel | null {
	const sepIdx = raw.indexOf('::');
	if (sepIdx === -1) return null;
	return {
		providerId: raw.slice(0, sepIdx),
		modelId: raw.slice(sepIdx + 2),
	};
}

/**
 * providerId와 modelId를 "::" 구분자로 결합합니다.
 */
export function toProviderModelValue(providerId: string, modelId: string): string {
	return `${providerId}::${modelId}`;
}

// ─── Async Wrapper ────────────────────────────────────────────────────────────

/**
 * Promise를 반환하는 비동기 함수를 void 반환 함수로 래핑합니다.
 * 이벤트 핸들러나 Obsidian onChange 콜백에서 async 함수를 안전하게 호출하기 위해 사용.
 */
export function wrapAsync<T extends unknown[]>(fn: (...args: T) => Promise<unknown>): (...args: T) => void {
	return (...args) => {
		void fn(...args);
	};
}

// ─── Slider + Number Input Combo ──────────────────────────────────────────────

/** 슬라이더 + 숫자 입력 콤보를 Settings에 추가하는 헬퍼 */
export function addSliderWithInput(
	setting: Setting,
	opts: { min: number; max: number; step: number; value: number },
	onChange: (val: number) => void,
): void {
	const state = { val: opts.value };
	setting
		.addSlider(slider => {
			slider
				.setLimits(opts.min, opts.max, opts.step)
				.setValue(opts.value)
				.onChange(val => {
					state.val = val;
					// 숫자 인풋 동기화
					const inp = slider.sliderEl.parentElement?.querySelector<HTMLInputElement>('.lumina-slider-number');
					if (inp) inp.value = String(val);
					onChange(val);
				});
			slider.sliderEl.setCssStyles({ minWidth: '200px' });
		})
		.addText(text => {
			text.inputEl.type = 'number';
			text.inputEl.className = 'lumina-slider-number';
			text.inputEl.min = String(opts.min);
			text.inputEl.max = String(opts.max);
			text.inputEl.step = String(opts.step);
			text.inputEl.value = String(opts.value);
			text.inputEl.setCssStyles({ width: '60px', textAlign: 'right' });
			text.onChange(raw => {
				const n = parseFloat(raw);
				if (!isNaN(n) && n >= opts.min && n <= opts.max) {
					onChange(n);
				}
			});
		});
}

// ─── Fuzzy Model Suggest Modal ────────────────────────────────────────────────

export interface ModelSuggestItem {
	value: string;
	label: string;
}

export class FuzzyModelSuggestModal extends FuzzySuggestModal<ModelSuggestItem> {
	private items: ModelSuggestItem[];
	private onChoose: (item: ModelSuggestItem) => void;
	private defaultItemValue?: string;

	constructor(app: App, items: ModelSuggestItem[], onChoose: (item: ModelSuggestItem) => void, defaultItemValue?: string) {
		super(app);
		this.items = items;
		this.onChoose = onChoose;
		this.defaultItemValue = defaultItemValue;
		this.setPlaceholder('Search models...');
	}

	getItems(): ModelSuggestItem[] {
		return this.items;
	}

	getItemText(item: ModelSuggestItem): string {
		return item.label;
	}

	renderSuggestion(match: FuzzyMatch<ModelSuggestItem>, el: HTMLElement) {
		super.renderSuggestion(match, el);
		if (this.defaultItemValue !== undefined && match.item.value === this.defaultItemValue) {
			el.classList.add('is-selected-default');
		}
	}

	onChooseItem(item: ModelSuggestItem, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(item);
	}

	onOpen(): void {
		void super.onOpen();

		if (this.defaultItemValue) {
			// give it a bit of time to render suggestions
			window.setTimeout(() => {
				const selectedEl = this.containerEl.querySelector('.is-selected-default');
				if (selectedEl) {
					selectedEl.scrollIntoView({ behavior: 'auto', block: 'center' });
				}
			}, 50);
		}
	}
}

// ─── Model Selector (FuzzyModal / Dropdown) ───────────────────────────────────

/**
 * 모델 선택 UI를 옵션 개수에 따라 FuzzyModal 또는 Dropdown으로 자동 렌더링합니다.
 * @param setting - 대상 Setting 인스턴스
 * @param options - 선택 옵션 배열
 * @param currentValue - 현재 선택된 값
 * @param currentLabel - 현재 표시될 라벨
 * @param onChange - 값 변경 시 호출 (value: string)
 * @param getDynamicValue - FuzzyModal open 시점에 동적으로 현재 값을 가져오는 함수
 * @param app - Obsidian App 인스턴스
 */
export function addModelSelector(
	setting: Setting,
	options: { value: string; label: string }[],
	currentValue: string,
	currentLabel: string,
	onChange: (val: string) => Promise<void>,
	getDynamicValue: () => string,
	app: App,
): void {
	if (options.length >= FUZZY_MODAL_THRESHOLD) {
		setting.addButton(btn => {
			btn.setButtonText(currentLabel)
				.onClick(() => {
					new FuzzyModelSuggestModal(
						app,
						options,
						wrapAsync(async (item) => {
							await onChange(item.value);
							btn.setButtonText(item.label);
						}),
						getDynamicValue(),
					).open();
				});
		});
	} else {
		setting.addDropdown(drop => {
			for (const opt of options) {
				drop.addOption(opt.value, opt.label);
			}
			drop.setValue(currentValue)
				.onChange(wrapAsync(async (val) => {
					await onChange(val);
				}));
		});
	}
}

// ─── IME-safe Text Handler ────────────────────────────────────────────────────

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
export interface ComposingSafeHandler {
	/** 이벤트 리스너를 제거합니다 */
	dispose: () => void;
	/** 현재 composing 상태인지 여부 */
	isComposing: () => boolean;
}

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

// ─── IME-safe Obsidian Setting Binding ─────────────────────────────────────────

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

// ─── Error Normalizer ─────────────────────────────────────────────────────────

/**
 * unknown 타입의 에러를 Error 객체로 정규화합니다.
 * debugLogger.logError 등의 호출부에서 반복되는 instanceof 체크를 제거하기 위함.
 */
export function normalizeError(err: unknown, fallbackMessage: string = '알 수 없는 오류'): Error {
	if (err instanceof Error) return err;
	return new Error(typeof err === 'string' ? err : fallbackMessage);
}