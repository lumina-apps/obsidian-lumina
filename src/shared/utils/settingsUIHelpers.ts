/**
 * settingsUIHelpers.ts
 *
 * 설정 UI 렌더링에 사용되는 순수 헬퍼 함수 모음.
 * LuminaSettingTab 클래스의 멤버 메서드로 존재하던 것들을 독립 함수로 분리.
 *
 * 모듈 구조:
 *   - Section & Label helpers        (본 파일)
 *   - Locale helpers                 (본 파일)
 *   - Model warnings                 (본 파일)
 *   - UI 빌더 (addDescButton 등)     (본 파일)
 *   - SecretField                    (본 파일)
 *   - Error display                  (본 파일)
 *   - Slider + Number input 콤보     (본 파일)
 *   - Model selector + FuzzyModal    → fuzzyModelSuggestModal.ts
 *   - Connection Notice/Provider     → connectionNoticeUtils.ts
 *   - UI 옵션 인터페이스             → ../types/settingsUI.types.ts
 */

import { Notice, Setting } from 'obsidian';
import { debugLogger } from '../debugLogger';
import { normalizeError } from './errorUtils';
import { wrapAsync } from './asyncUtils';
import { t } from '../locales/helpers';
import type { PluginLanguage } from '../types/settings.types';

// ─── 타입 re-export ───────────────────────────────────────────────────────────

export type {
	DescButtonOptions,
	ToggleOptions,
	TextInputOptions,
	DropdownOptions,
	SliderRangeOptions,
	SecretFieldOptions,
	ModelSuggestItem,
} from '../types/settingsUI.types';

// ─── FuzzyModal + ModelSelector re-export ─────────────────────────────────────

export { FUZZY_MODAL_THRESHOLD, FuzzyModelSuggestModal, addModelSelector } from './fuzzyModelSuggestModal';

// ─── Connection Notice re-export ──────────────────────────────────────────────

export {
	showConnectionSuccess,
	showSyncFailNotice,
	showDisconnectedNotice,
	showConnectedNotice,
	getConnectionStatus,
	refreshAfterConnectionToggle,
	refreshAfterMcpConnectionToggle,
} from './connectionNoticeUtils';

// ─── t with loose key typing for keys not yet in TranslationKeys ──────────────

const _t = t as (key: string, params?: Record<string, string | number>) => string;

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** MCP 서버 토글 후 UI 리프레시 대기 시간 (ms) */
export const MCP_REFRESH_DELAY = 1500;
/** 추론형 모델 경고 Notice 표시 시간 (ms) */
export const REASONING_MODEL_NOTICE_DURATION = 10000;

// ─── SecretField defaults ─────────────────────────────────────────────────────

const DEFAULT_HIDE_TOOLTIP = 'Hide value';
const DEFAULT_SHOW_TOOLTIP = 'Show value';
const DEFAULT_RESET_TOOLTIP = 'Reset to default';

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
		new Notice(t('settings.connections.quickActionModel.reasoningWarning'), REASONING_MODEL_NOTICE_DURATION);
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Controls - Basic
// ═══════════════════════════════════════════════════════════════════════════════

import type { DescButtonOptions, ToggleOptions, TextInputOptions, DropdownOptions, SliderRangeOptions } from '../types/settingsUI.types';

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
			slider
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

import type { SecretFieldOptions } from '../types/settingsUI.types';

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
// Error Display
// ═══════════════════════════════════════════════════════════════════════════════

/** 공통: ❌ + 메시지 오류 Fragment 생성 */
function createErrorFragment(message: string): DocumentFragment {
	return createFragment(el => {
		el.createSpan({ text: '❌ ' });
		el.createSpan({ text: message });
	});
}

/**
 * Desc + Notice 오류 표시용 헬퍼입니다.
 * 콜백에서 오류 발생 시 사용합니다.
 */
export function showSettingError(setting: Setting, errorMessage: string): void {
	const normalizedMessage = normalizeError(errorMessage).message;
	setting.setDesc(createErrorFragment(normalizedMessage));
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
	setting.setDesc(createErrorFragment(normalizedMessage));
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