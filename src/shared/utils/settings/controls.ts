import { Notice, Setting } from 'obsidian';
import { debugLogger } from '../../debugLogger';
import { normalizeError } from '../errorUtils';
import { wrapAsync } from '../asyncUtils';
import { t } from '../../locales/helpers';

import type { 
	DescButtonOptions, 
	ToggleOptions, 
	TextInputOptions, 
	DropdownOptions, 
	SliderRangeOptions,
	SecretFieldOptions
} from '../../types/settingsUI.types';

const _t = t as (key: string, params?: Record<string, string | number>) => string;

const DEFAULT_HIDE_TOOLTIP = 'Hide value';
const DEFAULT_SHOW_TOOLTIP = 'Show value';
const DEFAULT_RESET_TOOLTIP = 'Reset to default';

/** 공통 설정 옵션 적용 (중복 제거용 내부 헬퍼) */
function setupSettingBase(opts: { setting: Setting, name: string | DocumentFragment, desc: string | DocumentFragment, disabled?: boolean }) {
	opts.setting.setName(opts.name).setDesc(opts.desc);
	if (opts.disabled) {
		opts.setting.setDisabled(true);
	}
}

/** 설명 + 버튼 설정 행 */
export function addDescButton(opts: DescButtonOptions): void {
	setupSettingBase(opts);
	opts.setting.addButton(btn => {
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
		if (opts.disabled) btn.setDisabled(true); // 버튼 자체도 disabled
		if (opts.btnCssClass) btn.buttonEl.addClass(opts.btnCssClass);
	});
}

/** Toggle 설정 행 */
export function addToggle(opts: ToggleOptions): void {
	setupSettingBase(opts);
	opts.setting.addToggle(toggle => {
		toggle.setValue(opts.value).onChange(wrapAsync(async (val) => {
			await opts.onChange(val);
		}));
		if (opts.disabled) toggle.setDisabled(true);
	});
}

/** Text 입력 설정 행 */
export function addTextInput(opts: TextInputOptions): void {
	setupSettingBase(opts);
	opts.setting.addText(text => {
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
	setupSettingBase(opts);
	opts.setting.addDropdown(drop => {
		drop.addOptions(opts.options);
		drop.setValue(opts.value).onChange(wrapAsync(async (val) => {
			await opts.onChange(val);
		}));
		if (opts.disabled) drop.setDisabled(true);
	});
}

/** Slider 설정 행 */
export function addSliderRange(opts: SliderRangeOptions): void {
	setupSettingBase(opts);
	opts.setting.addSlider(slider => {
		slider
			.setLimits(opts.min, opts.max, opts.step)
			.setValue(opts.value)
			.onChange(wrapAsync(async (val) => {
				await opts.onChange(val);
			}));
	});
}

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

/** Secret 필드 설정 행 (Show/Hide + Reset 버튼 포함) */
export function addSecretField(opts: SecretFieldOptions): void {
	setupSettingBase(opts);

	const defaultValue = opts.defaultValue ?? '';
	const hideTooltip = opts.hideTooltip ?? DEFAULT_HIDE_TOOLTIP;
	const showTooltip = opts.showTooltip ?? DEFAULT_SHOW_TOOLTIP;
	const resetTooltip = opts.resetTooltip ?? DEFAULT_RESET_TOOLTIP;

	let isMasked = true;
	let currentValue = opts.value;

	opts.setting
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
