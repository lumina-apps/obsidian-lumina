/**
 * settingsUI.types.ts
 *
 * 설정 UI 빌더 함수에서 사용하는 옵션 인터페이스 정의.
 * settingsUIHelpers.ts, fuzzyModelSuggestModal.ts 등에서 공유됩니다.
 */

import type { Setting } from 'obsidian';

/** 설명 + 버튼이 있는 설정 행 옵션 */
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

/** Toggle 설정 행 옵션 */
export interface ToggleOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: boolean;
	onChange: (val: boolean) => void | Promise<void>;
	disabled?: boolean;
}

/** Text 입력 설정 행 옵션 */
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

/** Dropdown 설정 행 옵션 */
export interface DropdownOptions {
	setting: Setting;
	name: string;
	desc: string;
	value: string;
	options: Record<string, string>;
	onChange: (val: string) => void | Promise<void>;
	disabled?: boolean;
}

/** Slider 설정 행 옵션 */
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

/** 시크릿 필드 설정 행 옵션 */
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

/** FuzzyModelSuggestModal에서 사용하는 모델 제안 아이템 */
export interface ModelSuggestItem {
	value: string;
	label: string;
}