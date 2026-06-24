import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import { WEB_SEARCH_PROVIDER_LABELS } from '../../../../shared/types/settings.types';
import type { WebSearchProviderType } from '../../../../shared/types/settings.types';
import { addSliderWithInput } from '../../../../shared/utils/settingHelpers';

export function renderWebSearchTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const { plugin } = tab;
	const { webSearch } = plugin.settings;

	tab.sectionHeading(el, t('settings.webSearch.title'));

	new Setting(el)
		.setName(t('settings.webSearch.enable.name'))
		.setDesc(t('settings.webSearch.enable.desc'))
		.addToggle((toggle) =>
			toggle.setValue(webSearch.enabled).onChange((value) => {
				webSearch.enabled = value;
				tab.display(); // 즉시 UI 새로고침
				void tab.saveAndSync(false); // 백그라운드 저장
			}),
		);

	if (!webSearch.enabled) return;

	tab.infoBox(el, t('settings.webSearch.privacyWarning'), 'warning');

	new Setting(el)
		.setName(t('settings.webSearch.provider.name'))
		.setDesc(t('settings.webSearch.provider.desc'))
		.addDropdown((dropdown) => {
			for (const [type, label] of Object.entries(WEB_SEARCH_PROVIDER_LABELS)) {
				dropdown.addOption(type, label);
			}
			dropdown.setValue(webSearch.activeProviderId);
			dropdown.onChange((value: string) => {
				webSearch.activeProviderId = value as WebSearchProviderType;
				tab.display(); // 즉시 UI 새로고침
				void tab.saveAndSync(false); // 백그라운드 저장
			});
		});

	const activeConfig = webSearch.providers.find((p) => p.type === webSearch.activeProviderId);

	if (activeConfig) {
		if (webSearch.activeProviderId === 'searxng') {
			new Setting(el)
				.setName(t('settings.webSearch.baseUrl.name'))
				.setDesc(t('settings.webSearch.baseUrl.desc'))
				.addText((text) =>
					text
						.setPlaceholder('http://localhost:8080')
						.setValue(activeConfig.baseUrl || '')
						.onChange(async (value) => {
							activeConfig.baseUrl = value;
							await tab.saveAndSync(false);
						}),
				);
		} else {
			new Setting(el)
				.setName(t('settings.webSearch.apiKey.name'))
				.setDesc(t('settings.webSearch.apiKey.desc'))
				.addText((text) => {
					text.inputEl.type = 'password';
					text
						.setPlaceholder('Enter API Key')
						.setValue(activeConfig.apiKey || '')
						.onChange(async (value) => {
							activeConfig.apiKey = value;
							await tab.saveAndSync(false);
						});
				});

			if (webSearch.activeProviderId === 'google') {
				new Setting(el)
					.setName(t('settings.webSearch.googleSearchEngineId.name'))
					.setDesc(t('settings.webSearch.googleSearchEngineId.desc'))
					.addText((text) => {
						text.inputEl.type = 'password';
						text
							.setPlaceholder('Enter CX ID')
							.setValue(activeConfig.googleSearchEngineId || '')
							.onChange(async (value) => {
								activeConfig.googleSearchEngineId = value;
								await tab.saveAndSync(false);
							});
					});
			}
		}
	}

	addSliderWithInput(
		new Setting(el)
			.setName(t('settings.webSearch.maxResults.name'))
			.setDesc(t('settings.webSearch.maxResults.desc')),
		{ min: 1, max: 10, step: 1, value: webSearch.maxResults },
		(val: number) => {
			webSearch.maxResults = val;
			void tab.saveAndSync();
		},
	);

	if (tab.showAdvanced) {
		tab.advancedLabel(el);
		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.webSearch.maxContentLength.name'))
				.setDesc(t('settings.webSearch.maxContentLength.desc')),
			{ min: 500, max: 10000, step: 500, value: webSearch.maxContentLength },
			(val: number) => {
				webSearch.maxContentLength = val;
				void tab.saveAndSync();
			},
		);
	}
}
