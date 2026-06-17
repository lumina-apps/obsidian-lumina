/**
 * settingsUIHelpers.ts
 *
 * 설정 UI 렌더링에 사용되는 순수 헬퍼 함수 모음.
 * LuminaSettingTab 클래스의 멤버 메서드로 존재하던 것들을 독립 함수로 분리.
 */

import { Notice, Setting } from 'obsidian';
import { t } from '../locales/helpers';
import type { PluginLanguage } from '../types/settings.types';
import { REASONING_MODEL_NOTICE_DURATION } from './settingHelpers';

// ─── Section & Label Helpers ──────────────────────────────────────────────────

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

// ─── Locale Helpers ───────────────────────────────────────────────────────────

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

// ─── Model Warnings ───────────────────────────────────────────────────────────

/** 퀵 액션 모델이 추론형인지 확인 후 경고 표시 */
export function warnIfReasoningModel(modelId: string): void {
	const lower = modelId.toLowerCase();
	if (lower.includes('r1') || lower.includes('qwq') || lower.includes('reasoning') || lower.includes('thinking')) {
		new Notice('⚠️ 경고: 추론형 모델(Reasoning Model)이 감지되었습니다! 퀵 액션은 속도가 생명이므로 이 모델을 사용하면 응답이 매우 지연되거나 무한 루프에 빠질 수 있습니다. 일반 Instruct 모델 사용을 강력히 권장합니다.', REASONING_MODEL_NOTICE_DURATION);
	}
}