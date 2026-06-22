/**
 * QuickSettings 프리셋 상수
 *
 * 온도(creativity)와 최대 토큰(length) 버튼 그룹에 사용되는
 * 값, 활성화 임계값, i18n 키를 한 곳에서 관리합니다.
 */

export interface PresetOption {
	/** 설정값 */
	value: number;
	/** i18n 접미사 키 (settings.chat.quickSettings.{i18nKey}) */
	i18nKey: string;
}

export const TEMPERATURE_PRESETS: readonly PresetOption[] = [
	{ value: 0.2, i18nKey: "precise" },
	{ value: 0.7, i18nKey: "balanced" },
	{ value: 1.0, i18nKey: "creative" },
] as const;

export const TOKEN_PRESETS: readonly PresetOption[] = [
	{ value: 1000, i18nKey: "short" },
	{ value: 4000, i18nKey: "medium" },
	{ value: 8000, i18nKey: "long" },
] as const;