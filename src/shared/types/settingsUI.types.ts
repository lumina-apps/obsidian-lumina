/** 설정 UI 빌더 함수 옵션 인터페이스 정의 */

import type { Setting } from 'obsidian';

/** 설명 + 버튼 설정 행 */
export interface DescButtonOptions {
	setting: Setting;
	name: string;
	desc: string;
	buttonText: string;
	onClick: (btn: HTMLButtonElement) => void | Promise<void>;
	badge?: { text: string; tooltip?: string };
	disabled?: boolean;
	btnCssClass?: string;
}

/** Toggle 설정 행 */
export interface ToggleOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: boolean;
	onChange: (val: boolean) => void | Promise<void>;
	disabled?: boolean;
}

/** Text 입력 설정 행 */
export interface TextInputOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: string;
	placeholder?: string;
	onChange: (val: string) => void | Promise<void>;
	cssClass?: string;
	type?: 'text' | 'password' | 'number';
	disabled?: boolean;
}

/** Dropdown 설정 행 */
export interface DropdownOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: string;
	options: Record<string, string>;
	onChange: (val: string) => void | Promise<void>;
	disabled?: boolean;
}

/** Slider 설정 행 */
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

/** 시크릿 필드 설정 행 */
export interface SecretFieldOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: string;
	placeholder?: string;
	onChange: (val: string) => void | Promise<void>;
	defaultValue?: string;
	hideTooltip?: string;
	showTooltip?: string;
	resetTooltip?: string;
	maxLength?: number;
	disabled?: boolean;
}

/** FuzzyModelSuggestModal 모델 제안 아이템 */
export interface ModelSuggestItem {
	value: string;
	label: string;
}
