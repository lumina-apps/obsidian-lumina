import { Setting } from 'obsidian';
import { t } from '../../locales/helpers';

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
