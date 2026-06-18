/** 설정 UI 렌더링 헬퍼 함수 모음 */

import { Notice, Setting } from 'obsidian';
import { debugLogger } from '../debugLogger';
import { normalizeError } from './errorUtils';
import { wrapAsync } from './asyncUtils';
import { t } from '../locales/helpers';
import type { PluginLanguage } from '../types/settings.types';


export type {
	DescButtonOptions,
	ToggleOptions,
	TextInputOptions,
	DropdownOptions,
	SliderRangeOptions,
	SecretFieldOptions,
	ModelSuggestItem,
} from '../types/settingsUI.types';


export { FUZZY_MODAL_THRESHOLD, FuzzyModelSuggestModal, addModelSelector } from './fuzzyModelSuggestModal';


export {
	showConnectionSuccess,
	showSyncFailNotice,
	showDisconnectedNotice,
	showConnectedNotice,
	getConnectionStatus,
	refreshAfterConnectionToggle,
	refreshAfterMcpConnectionToggle,
} from './connectionNoticeUtils';


const _t = t as (key: string, params?: Record<string, string | number>) => string;

export const MCP_REFRESH_DELAY = 1500;
export const REASONING_MODEL_NOTICE_DURATION = 10000;

const DEFAULT_HIDE_TOOLTIP = 'Hide value';
const DEFAULT_SHOW_TOOLTIP = 'Show value';
const DEFAULT_RESET_TOOLTIP = 'Reset to default';

/** 섹션 제목 heading 추가 */
export function sectionHeading(el: HTMLElement, text: string): void {
	const headingSetting = new Setting(el).setName(text).setHeading();
	headingSetting.settingEl.addClass('lumina-settings__section-heading');
}

/** 고급 설정 레이블 추가 */
export function advancedLabel(el: HTMLElement): void {
	el.createEl('p', { text: `⚙️ ${t('settings.showAdvanced')}`, cls: 'lumina-settings__advanced-label' });
}

/** 정보/경고 박스 추가 */
export function infoBox(el: HTMLElement, text: string, type: 'info' | 'warning' = 'info'): void {
	const div = el.createDiv({ cls: `lumina-settings__info-box lumina-settings__info-box--${type}` });
	text.split('\n').forEach((line, i) => {
		if (i > 0) div.createEl('br');
		div.appendText(line);
	});
}

/** 브라우저 시스템 로케일 반환 */
export function getSystemLocale(): string {
	return navigator.language ?? 'Unknown';
}

/** README URL 언어 suffix 반환 */
export function getLangSuffix(language: string): string {
	if (language === 'system') {
		const navLang = (window.navigator.language || 'en').toLowerCase();
		if (navLang.startsWith('zh')) {
			return navLang === 'zh-tw' || navLang === 'zh-hk' ? 'ZH_TW' : 'ZH';
		}
		return navLang.split('-')[0].toUpperCase();
	}
	return language.toUpperCase().replace('-', '_');
}

/** 추론형 모델 경고 */
export function warnIfReasoningModel(modelId: string): void {
	const lower = modelId.toLowerCase();
	if (lower.includes('r1') || lower.includes('qwq') || lower.includes('reasoning') || lower.includes('thinking')) {
		new Notice(t('settings.connections.quickActionModel.reasoningWarning'), REASONING_MODEL_NOTICE_DURATION);
	}
}

// ─── UI Controls - Basic ────────────────────────

import type { DescButtonOptions, ToggleOptions, TextInputOptions, DropdownOptions, SliderRangeOptions } from '../types/settingsUI.types';

/** 설명 + 버튼 설정 행 */
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

/** Toggle 설정 행 */
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

/** Text 입력 설정 행 */
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

/** Dropdown 설정 행 */
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

/** Slider 설정 행 */
export function addSliderRange(opts: SliderRangeOptions): void {
	opts.setting
		.setName(opts.name)
		.setDesc(opts.desc)
		.addSlider(slider => {
			slider
				.setLimits(opts.min, opts.max, opts.step)
				.setValue(opts.value)
				.onChange(wrapAsync(async (val) => {
					await opts.onChange(val);
				}));
		});
}

// ─── UI Controls - Special ──────────────────────

import type { SecretFieldOptions } from '../types/settingsUI.types';

/** Secret 필드 설정 행 (Show/Hide + Reset 버튼 포함) */
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

// ─── Error Display ──────────────────────────────

/** ❌ + 메시지 오류 Fragment */
function createErrorFragment(message: string): DocumentFragment {
	return createFragment(el => {
		el.createSpan({ text: '❌ ' });
		el.createSpan({ text: message });
	});
}

/** Desc + Notice 오류 표시 */
export function showSettingError(setting: Setting, errorMessage: string): void {
	const normalizedMessage = normalizeError(errorMessage).message;
	setting.setDesc(createErrorFragment(normalizedMessage));
	new Notice(normalizedMessage);
}

/** Secret 필드 오류 표시 */
export async function showSecretFieldError(
	setting: Setting,
	errorMessage: string,
	delayMs: number = 5000,
): Promise<void> {
	const normalizedMessage = normalizeError(errorMessage).message;
	setting.setDesc(createErrorFragment(normalizedMessage));
	new Notice(normalizedMessage);
	await sleep(delayMs);
}

// ─── Slider + Number Input Combo ────────────────

/** 슬라이더 + 숫자 입력 콤보 */
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