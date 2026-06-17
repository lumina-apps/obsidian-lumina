/**
 * settingsUIHelpers.ts
 *
 * 설정 UI 렌더링에 사용되는 순수 헬퍼 함수 모음.
 * LuminaSettingTab 클래스의 멤버 메서드로 존재하던 것들을 독립 함수로 분리.
 * - Section & Label helpers
 * - Locale helpers
 * - Model warnings
 * - UI 빌더 (addDescButton, addToggle, addTextInput, addDropdown, addSliderRange)
 * - SecretField, Provider helpers
 * - Error display
 * - Slider + Number input 콤보 (addSliderWithInput)
 * - Model selector (addModelSelector, FuzzyModelSuggestModal)
 */

import { App, FuzzySuggestModal, Notice, Setting } from 'obsidian';
import type { SliderComponent, TextComponent } from 'obsidian';
import { debugLogger } from '../debugLogger';
import { PROVIDER_LABELS, PROVIDER_CATEGORIES } from '../types/settings.types';
import type { LLMProviderConfig } from '../types/settings.types';
import { normalizeError } from './errorUtils';
import { wrapAsync } from './asyncUtils';
import { t } from '../locales/helpers';
import type { PluginLanguage } from '../types/settings.types';
import type { FuzzyMatch } from 'obsidian';

// ─── t with loose key typing for keys not yet in TranslationKeys ──────────────

const _t = t as (key: string, params?: Record<string, string | number>) => string;

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** FuzzyModelSuggestModal로 전환할 옵션 개수 임계값 */
export const FUZZY_MODAL_THRESHOLD = 30;
/** MCP 서버 토글 후 UI 리프레시 대기 시간 (ms) */
export const MCP_REFRESH_DELAY = 1500;
/** 추론형 모델 경고 Notice 표시 시간 (ms) */
export const REASONING_MODEL_NOTICE_DURATION = 10000;

// ─── UI Control Constants ─────────────────────────────────────────────────────

const DEFAULT_HIDE_TOOLTIP = 'Hide value';
const DEFAULT_SHOW_TOOLTIP = 'Show value';
const DEFAULT_RESET_TOOLTIP = 'Reset to default';
const DEFAULT_CONNECT_BUTTON_TEXT = 'Connect';
const DEFAULT_TESTING_TEXT = 'Testing...';
const DEFAULT_DISCONNECT_BUTTON_TEXT = 'Disconnect';
const DEFAULT_UNLINK_BUTTON_TEXT = 'Unlink';

/** 새 연결 프로바이더 ID 접두사 */
export const NEW_CONNECTION_PREFIX = 'new-connection-';
/** 새 연결 임시 프로바이더명 */
export const NEW_CONNECTION_NAME = 'New Connection';

// ═══════════════════════════════════════════════════════════════════════════════
// Section & Label Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** 섹션 제목 heading을 DOM에 추가합니다 */
export function sectionHeading(el: HTMLElement, text: string): void {
	const headingSetting = new Setting(el).setName(text).setHeading();
	headingSetting.settingEl.addClass('lumina-settings__section-heading');
}

/** 고급 설정 레이블을 DOM에 추가합니다 */
export function advancedLabel(el: HTMLElement): void {
	el.createEl('p', { text: `⚙️ ${t('settings.showAdvanced')}`, cls: 'lumina-settings__advanced-label' });
}

/** 정보/경고 박스를 DOM에 추가합니다 */
export function infoBox(el: HTMLElement, text: string, type: 'info' | 'warning' = 'info'): void {
	const div = el.createDiv({ cls: `lumina-settings__info-box lumina-settings__info-box--${type}` });
	text.split('\n').forEach((line, i) => {
		if (i > 0) div.createEl('br');
		div.appendText(line);
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// Locale Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** 현재 브라우저의 시스템 로케일을 반환합니다 */
export function getSystemLocale(): string {
	return navigator.language ?? 'Unknown';
}

/**
 * README URL에 사용할 언어 suffix를 반환합니다.
 * @param language - 플러그인 설정 언어값
 */
export function getLangSuffix(language: PluginLanguage | string): string {
	if (language === 'system') {
		const navLang = (window.navigator.language || 'en').toLowerCase();
		if (navLang.startsWith('zh')) {
			return navLang === 'zh-tw' || navLang === 'zh-hk' ? 'ZH_TW' : 'ZH';
		}
		return navLang.split('-')[0].toUpperCase();
	}
	return language.toUpperCase().replace('-', '_');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Model Warnings
// ═══════════════════════════════════════════════════════════════════════════════

/** 퀵 액션 모델이 추론형인지 확인 후 경고 표시 */
export function warnIfReasoningModel(modelId: string): void {
	const lower = modelId.toLowerCase();
	if (lower.includes('r1') || lower.includes('qwq') || lower.includes('reasoning') || lower.includes('thinking')) {
		new Notice('⚠️ 경고: 추론형 모델(Reasoning Model)이 감지되었습니다! 퀵 액션은 속도가 생명이므로 이 모델을 사용하면 응답이 매우 지연되거나 무한 루프에 빠질 수 있습니다. 일반 Instruct 모델 사용을 강력히 권장합니다.', REASONING_MODEL_NOTICE_DURATION);
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface DescButtonOptions {
	setting: Setting;
	name: string;
	desc: string;
	buttonText: string;
	onClick: (btn: HTMLButtonElement) => void | Promise<void>;
	/** 이름 뒤에 붙는 배지 (예: 연결 상태, 토큰 갯수 등) */
	badge?: { text: string; tooltip?: string };
	/** 버튼 비활성화 여부 */
	disabled?: boolean;
	/** 버튼에 적용할 CSS 클래스 */
	btnCssClass?: string;
}

export interface ToggleOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: boolean;
	onChange: (val: boolean) => void | Promise<void>;
	disabled?: boolean;
}

export interface TextInputOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: string;
	placeholder?: string;
	onChange: (val: string) => void | Promise<void>;
	/** 텍스트 인풋에 적용할 CSS 클래스 */
	cssClass?: string;
	/** 입력 타입 (기본 'text') */
	type?: 'text' | 'password' | 'number';
	/** disabled 상태 */
	disabled?: boolean;
}

export interface DropdownOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: string;
	options: Record<string, string>;
	onChange: (val: string) => void | Promise<void>;
	disabled?: boolean;
}

export interface SliderRangeOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (val: number) => void | Promise<void>;
	tooltip?: string;
}

export interface SecretFieldOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: string;
	placeholder?: string;
	onChange: (val: string) => void | Promise<void>;
	/** reset할 기본값 (기본 '') */
	defaultValue?: string;
	/** 숨김/보기 툴팁 텍스트 커스텀 */
	hideTooltip?: string;
	showTooltip?: string;
	resetTooltip?: string;
	/** 비밀번호 길이 제한 등 추가 유효성 검사 */
	maxLength?: number;
	disabled?: boolean;
}

export interface ModelSuggestItem {
	value: string;
	label: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Notice helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Provider 검증 성공 시 표시할 Notice
 */
export function showConnectionSuccess(providerName: string): void {
	new Notice(`${_t('connection.success')}: ${providerName}`);
}

/**
 * 변경사항 동기화 실패 시 표시할 Notice
 */
export function showSyncFailNotice(): void {
	new Notice(_t('connection.syncFail'));
}

/**
 * MCP 서버와 연결 해제 시 표시할 Notice
 */
export function showDisconnectedNotice(): void {
	new Notice(_t('connection.mcpDisconnected'));
}

/**
 * MCP 서버와 연결 성공 시 표시할 Notice
 */
export function showConnectedNotice(): void {
	new Notice(_t('connection.mcpConnected'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Controls - Basic
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 설명 + 버튼이 있는 설정 행을 생성합니다.
 * import / export / open settings 등에 사용됩니다.
 */
export function addDescButton(opts: DescButtonOptions): void {
	opts.setting
		.setName(opts.name)
		.setDesc(opts.desc)
		.addButton(btn => {
			if (typeof opts.badge?.text === 'string') {
				btn.setButtonText(`${opts.buttonText} (${opts.badge.text})`);
				if (opts.badge.tooltip) btn.setTooltip(opts.badge.tooltip);
			} else {
				btn.setButtonText(opts.buttonText);
			}
			btn.onClick(async () => {
				try {
					await opts.onClick(btn.buttonEl);
				} catch (err: unknown) {
					debugLogger.logError('addDescButton', normalizeError(err));
					new Notice(_t('modal.errorProcessing', { message: normalizeError(err).message }));
				}
			});
			if (opts.disabled) btn.setDisabled(true);
			if (opts.btnCssClass) btn.buttonEl.addClass(opts.btnCssClass);
		});
}

/**
 * Toggle 설정 행을 생성합니다.
 */
export function addToggle(opts: ToggleOptions): void {
	opts.setting
		.setName(opts.name)
		.setDesc(opts.desc)
		.addToggle(toggle => {
			toggle.setValue(opts.value).onChange(wrapAsync(async (val) => {
				await opts.onChange(val);
			}));
			if (opts.disabled) toggle.setDisabled(true);
		});
}

/**
 * Text 입력 설정 행을 생성합니다.
 */
export function addTextInput(opts: TextInputOptions): void {
	opts.setting
		.setName(opts.name)
		.setDesc(opts.desc)
		.addText(text => {
			text.setValue(opts.value).onChange(wrapAsync(async (val) => {
				await opts.onChange(val);
			}));
			if (opts.placeholder) text.setPlaceholder(opts.placeholder);
			if (opts.cssClass) text.inputEl.addClass(opts.cssClass);
			if (opts.type) text.inputEl.type = opts.type;
			if (opts.disabled) text.setDisabled(true);
		});
}

/**
 * Dropdown 설정 행을 생성합니다.
 */
export function addDropdown(opts: DropdownOptions): void {
	opts.setting
		.setName(opts.name)
		.setDesc(opts.desc)
		.addDropdown(drop => {
			drop.addOptions(opts.options);
			drop.setValue(opts.value).onChange(wrapAsync(async (val) => {
				await opts.onChange(val);
			}));
			if (opts.disabled) drop.setDisabled(true);
		});
}

/**
 * Slider 설정 행을 생성합니다.
 */
export function addSliderRange(opts: SliderRangeOptions): void {
	opts.setting
		.setName(opts.name)
		.setDesc(opts.desc)
		.addSlider(slider => {
			(slider as SliderComponent)
				.setLimits(opts.min, opts.max, opts.step)
				.setValue(opts.value)
				.onChange(wrapAsync(async (val) => {
					await opts.onChange(val);
				}));
			slider.setDynamicTooltip();
		});
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Controls - Special
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * API 키와 같은 Secret 필드 설정 행을 생성합니다.
 * Show/Hide 버튼과 Reset 버튼이 포함됩니다.
 */
export function addSecretField(opts: SecretFieldOptions): void {
	const defaultValue = opts.defaultValue ?? '';
	const hideTooltip = opts.hideTooltip ?? DEFAULT_HIDE_TOOLTIP;
	const showTooltip = opts.showTooltip ?? DEFAULT_SHOW_TOOLTIP;
	const resetTooltip = opts.resetTooltip ?? DEFAULT_RESET_TOOLTIP;

	let isMasked = true;
	let currentValue = opts.value;

	opts.setting
		.setName(opts.name)
		.setDesc(opts.desc)
		.addText(text => {
			text.inputEl.type = 'password';
			text.setValue(currentValue).onChange(wrapAsync(async (val) => {
				currentValue = val;
				await opts.onChange(val);
			}));
			if (opts.placeholder) text.setPlaceholder(opts.placeholder);
			if (opts.maxLength !== undefined) text.inputEl.maxLength = opts.maxLength;
			if (opts.disabled) text.setDisabled(true);
			text.inputEl.addClass('lumina-secret-field');
		})
		.addExtraButton(btn => {
			btn.setIcon('eye')
				.setTooltip(showTooltip)
				.onClick(() => {
					const inputEl = btn.extraSettingsEl.parentElement?.querySelector<HTMLInputElement>('.lumina-secret-field');
					if (!inputEl) return;
					isMasked = !isMasked;
					inputEl.type = isMasked ? 'password' : 'text';
					btn.setIcon(isMasked ? 'eye' : 'eye-off');
					btn.setTooltip(isMasked ? showTooltip : hideTooltip);
				});
		})
		.addExtraButton(btn => {
			btn.setIcon('reset')
				.setTooltip(resetTooltip)
				.onClick(async () => {
					const inputEl = btn.extraSettingsEl.parentElement?.querySelector<HTMLInputElement>('.lumina-secret-field');
					if (inputEl) {
						inputEl.value = defaultValue;
						currentValue = defaultValue;
						await opts.onChange(defaultValue);
					}
				});
		});
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 등록된 Provider의 연결 상태와 사용 가능한 모델 수를 문자열로 반환합니다.
 * 사용처: DebugPanel.svelte
 */
export function getConnectionStatus(provider: LLMProviderConfig): string {
	if (!provider.isVerified) return _t('connections.noConnection');
	const count = provider.availableModels?.length ?? 0;
	if (count <= 0) {
		return _t('connections.availableModelsCount', { models: count.toString() });
	}
	const category = PROVIDER_CATEGORIES[provider.type];
	if (category === 'local') {
		return _t('connections.localModelsDisabled');
	}
	const providerLabel = PROVIDER_LABELS[provider.type] ?? provider.type;
	return _t('connections.connectedCountLabel', { provider: providerLabel, count: count.toString() });
}

/**
 * Provider 연결/해제 버튼을 누른 후 UI 갱신을 위한 리프레시 처리를 통합한 핸들러입니다.
 * - refreshSettingTab()이 제공되면 버튼 텍스트와 함께 UI를 즉시 갱신합니다.
 * - refreshSettingTab()이 없으면 (간헐적이지만) Notice로 결과를 안내합니다.
 */
export async function refreshAfterConnectionToggle(
	provider: LLMProviderConfig,
	refreshSettingTab?: () => void,
): Promise<void> {
	if (refreshSettingTab) {
		refreshSettingTab();
	} else {
		const providerLabel = PROVIDER_LABELS[provider.type] ?? provider.type;
		if (provider.isVerified) {
			new Notice(_t('connection.disconnected', { name: providerLabel }));
		} else {
			new Notice(_t('connection.connected', { name: providerLabel }));
		}
	}
}

/**
 * MCP 서버 연결/해제 토글 후 UI 갱신을 처리합니다.
 * @param isCurrentlyConnected - 현재 연결 상태
 * @param serverName - 서버명
 * @param refreshSettingTab - UI 갱신 함수
 */
export function refreshAfterMcpConnectionToggle(
	isCurrentlyConnected: boolean,
	serverName: string,
	refreshSettingTab: () => void,
): void {
	showDisconnectedNotice();
	setTimeout(() => {
		refreshSettingTab();
		if (isCurrentlyConnected) {
			showConnectedNotice();
		}
	}, 800);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Error Display
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Desc + Notice 오류 표시용 헬퍼입니다.
 * 콜백에서 오류 발생 시 사용합니다.
 */
export function showSettingError(setting: Setting, errorMessage: string): void {
	const normalizedMessage = normalizeError(errorMessage).message;
	const errorNotice = createFragment(el => {
		el.createSpan({ text: '❌ ' });
		el.createSpan({ text: normalizedMessage });
	});
	setting.setDesc(errorNotice);
	new Notice(normalizedMessage);
}

/**
 * API 키 등 Secret 필드 오류 표시용 헬퍼입니다.
 * 기존 Desc를 복원할 수 있도록 원본 설명을 인자로 받습니다.
 */
export async function showSecretFieldError(
	setting: Setting,
	errorMessage: string,
	delayMs: number = 5000,
): Promise<void> {
	const normalizedMessage = normalizeError(errorMessage).message;
	const errorNotice = createFragment(el => {
		el.createSpan({ text: '❌ ' });
		el.createSpan({ text: normalizedMessage });
	});
	setting.setDesc(errorNotice);
	new Notice(normalizedMessage);
	await sleep(delayMs);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Slider + Number Input Combo
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Fuzzy Model Suggest Modal
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Model Selector (FuzzyModal / Dropdown)
// ═══════════════════════════════════════════════════════════════════════════════

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