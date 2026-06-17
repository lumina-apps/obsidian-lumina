import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';

export function renderSendModeSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.chat;

	tab.sectionHeading(el, t('settings.chat.sendMode.name'));

	new Setting(el)
		.setName(t('settings.chat.sendMode.name'))
		.addDropdown(drop => {
			drop
				.addOption('enter', t('settings.chat.sendMode.enter'))
				.addOption('ctrl_enter', t('settings.chat.sendMode.ctrlEnter'))
				.setValue(s.sendKey)
				.onChange(async (val) => {
					s.sendKey = val as typeof s.sendKey;
					await tab.saveAndSync();
				});
		});
}