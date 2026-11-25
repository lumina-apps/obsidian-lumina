import { describe, it, expect, vi } from 'vitest';
import type { Setting, SliderComponent, TextComponent } from 'obsidian';
import { addSliderWithInput } from './controls';

describe('addSliderWithInput', () => {
	function createFakeSetting() {
		const controlEl = document.createElement('div');
		const sliderEl = document.createElement('input');
		sliderEl.type = 'range';
		const inputEl = document.createElement('input');
		controlEl.appendChild(sliderEl);
		controlEl.appendChild(inputEl);

		let sliderOnChange: ((val: number) => void) | undefined;
		let textOnChange: ((val: string) => void) | undefined;

		const sliderComp = {
			sliderEl,
			setLimits: vi.fn().mockImplementation((min: number, max: number, step: number) => {
				sliderEl.min = String(min);
				sliderEl.max = String(max);
				sliderEl.step = String(step);
				return sliderComp;
			}),
			setValue: vi.fn().mockImplementation((val: number) => {
				sliderEl.value = String(val);
				return sliderComp;
			}),
			onChange: vi.fn().mockImplementation((cb: (val: number) => void) => {
				sliderOnChange = cb;
				return sliderComp;
			}),
		} as unknown as SliderComponent;

		const textComp = {
			inputEl,
			onChange: vi.fn().mockImplementation((cb: (val: string) => void) => {
				textOnChange = cb;
				return textComp;
			}),
		} as unknown as TextComponent;

		const setting = {
			addSlider(cb: (s: SliderComponent) => void) {
				cb(sliderComp);
				return setting;
			},
			addText(cb: (t: TextComponent) => void) {
				cb(textComp);
				return setting;
			},
		} as unknown as Setting;

		return {
			setting,
			sliderEl,
			inputEl,
			sliderComp,
			triggerSliderChange: (val: number) => sliderOnChange?.(val),
			triggerTextChange: (raw: string) => textOnChange?.(raw),
		};
	}

	it('숫자 입력 시 유효 범위 내 값이면 슬라이더와 onChange가 함께 갱신된다', () => {
		const onChange = vi.fn();
		const fake = createFakeSetting();

		addSliderWithInput(fake.setting, { min: 0, max: 100, step: 5, value: 20 }, onChange);

		fake.triggerTextChange('65');

		expect(fake.sliderComp.setValue).toHaveBeenCalledWith(65);
		expect(fake.sliderEl.value).toBe('65');
		expect(onChange).toHaveBeenCalledWith(65);
	});

	it('범위를 벗어나거나 NaN인 입력은 슬라이더와 onChange를 갱신하지 않는다', () => {
		const onChange = vi.fn();
		const fake = createFakeSetting();

		addSliderWithInput(fake.setting, { min: 10, max: 50, step: 1, value: 20 }, onChange);
		vi.mocked(fake.sliderComp.setValue).mockClear();

		fake.triggerTextChange('5');
		fake.triggerTextChange('99');
		fake.triggerTextChange('abc');

		expect(fake.sliderComp.setValue).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
	});

	it('슬라이더 변경 시 숫자 입력칸과 onChange가 함께 갱신된다', () => {
		const onChange = vi.fn();
		const fake = createFakeSetting();

		addSliderWithInput(fake.setting, { min: 0, max: 10, step: 1, value: 3 }, onChange);

		fake.triggerSliderChange(8);

		expect(fake.inputEl.value).toBe('8');
		expect(onChange).toHaveBeenCalledWith(8);
	});
});
