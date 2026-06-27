/** 언어 설정 섹션 */

import { Notice, Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { translatePluginLocales, loadSystemLocaleCache, deleteSystemLocaleCache } from '../../../../shared/locales/translator';
import { setLanguage, t } from '../../../../shared/locales/helpers';
import { ConfirmModal } from '../../../../shared/utils/modal';
import { migrateQuickActions } from '../../migrations';
import type { PluginLanguage } from '../../../../shared/types/settings.types';

export function renderLanguageSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

	tab.sectionHeading(el, t('settings.connections.language.name'));

	new Setting(el)
		.setName(t('settings.connections.language.name'))
		.setDesc(t('settings.connections.language.desc'))
		.addDropdown(drop => {
			drop
				.addOption('en', t('settings.connections.language.option.en'))
				.addOption('ko', t('settings.connections.language.option.ko'))
				.addOption('ja', t('settings.connections.language.option.ja'))
				.addOption('zh', t('settings.connections.language.option.zh'))
				.addOption('zh-tw', t('settings.connections.language.option.zh-tw'))
				.addOption('es', t('settings.connections.language.option.es'))
				.addOption('pt', t('settings.connections.language.option.pt'))
				.addOption('de', t('settings.connections.language.option.de'))
				.addOption('fr', t('settings.connections.language.option.fr'))
				.addOption('ru', t('settings.connections.language.option.ru'))
				.addOption('it', t('settings.connections.language.option.it'))
				.addOption('system', `${t('settings.connections.language.option.system')} (${t('settings.connections.language.current', { lang: tab.getSystemLocale() })})`)
				.setValue(s.language)
				.onChange(async (val) => {
					if (val === 'system') {
						const cacheExists = await loadSystemLocaleCache(tab.app);
						if (!cacheExists) {
							if (s.providers.length === 0) {
								new Notice(t('settings.connections.language.llmRequired'));
								drop.setValue(s.language); // 롤백
								return;
							}
							// LLM 번역 및 캐시 적용 실행 (내부에서 모달로 진행 여부 확인)
							await translatePluginLocales(tab.app, tab.plugin.settings);
						} else {
							await setLanguage('system');
						}
					} else {
						await setLanguage(val); // 언어 변경 즉시 반영
					}
					s.language = val as PluginLanguage;
					migrateQuickActions(tab.plugin);
					await tab.saveAndSync();
					tab.plugin.refreshLocales();
					tab.refreshDisplay(); // 언어 변경에 따른 UI 리렌더링
				});
		})
		.addButton(btn => {
			btn
				.setButtonText(t('settings.connections.language.deleteCache'))
				.setTooltip(t('settings.connections.language.deleteCacheTooltip'))
				.onClick(() => {
					new ConfirmModal(
						tab.app,
						t('settings.connections.language.deleteCacheTitle'),
						t('settings.connections.language.deleteCacheConfirm'),
						() => {
							void deleteSystemLocaleCache(tab.app);
						}
					).open();
				});
		});
}