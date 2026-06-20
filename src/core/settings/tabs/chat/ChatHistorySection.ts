import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { wrapAsync } from '../../../../shared/utils/settingHelpers';
import { t } from '../../../../shared/locales/helpers';

export function renderChatHistorySection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.chat;

	tab.sectionHeading(el, t('settings.chat.history.name'));

	new Setting(el)
		.setName(t('settings.chat.history.name'))
		.setDesc(t('settings.chat.history.desc'))
		.addToggle(toggle => {
			toggle.setValue(s.autoSaveHistory).onChange(wrapAsync(async (val) => {
				s.autoSaveHistory = val;
				await tab.saveAndSync();
				tab.refreshDisplay();
			}));
		});

	if (s.autoSaveHistory) {
		new Setting(el)
			.setName(t('settings.chat.history.savePath'))
			.setDesc(t('settings.chat.history.savePathDesc'))
			.addText(text => {
				let composing = false;
				const inputEl = text.inputEl;
				inputEl.addEventListener('compositionstart', () => { composing = true; });
				inputEl.addEventListener('compositionend', () => {
					composing = false;
					s.historyPath = inputEl.value;
					void tab.saveAndSync();
				});
				text.setPlaceholder(t('settings.chat.history.pathPlaceholder'))
					.setValue(s.historyPath).onChange(async (val) => {
						if (composing) return;
						s.historyPath = val;
						await tab.saveAndSync();
					});
			});
	}
}