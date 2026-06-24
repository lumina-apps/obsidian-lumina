import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import { WEB_SEARCH_PROVIDER_LABELS } from '../../../../shared/types/settings.types';
import type { WebSearchProviderType } from '../../../../shared/types/settings.types';
import { addSliderWithInput } from '../../../../shared/utils/settingHelpers';

export function renderWebSearchTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const { plugin } = tab;
	const { webSearch } = plugin.settings;

	tab.sectionHeading(el, t('settings.webSearch.title' as any));

	const descEl = el.createEl('p', { cls: 'setting-item-description' });
	descEl.setText(t('settings.webSearch.desc' as any));

	new Setting(el)
		.setName(t('settings.webSearch.enable.name' as any))
		.setDesc(t('settings.webSearch.enable.desc' as any))
		.addToggle((toggle) =>
			toggle.setValue(webSearch.enabled).onChange(async (value) => {
				webSearch.enabled = value;
				await tab.saveAndSync(true);
			}),
		);

	if (!webSearch.enabled) return;

	tab.infoBox(el, t('settings.webSearch.privacyWarning' as any), 'warning');

	new Setting(el)
		.setName(t('settings.webSearch.provider.name' as any))
		.setDesc(t('settings.webSearch.provider.desc' as any))
		.addDropdown((dropdown) => {
			for (const [type, label] of Object.entries(WEB_SEARCH_PROVIDER_LABELS)) {
				dropdown.addOption(type, label);
			}
			dropdown.setValue(webSearch.activeProviderId);
			dropdown.onChange(async (value: string) => {
				webSearch.activeProviderId = value as WebSearchProviderType;
				await tab.saveAndSync(true);
			});
		});

	const activeConfig = webSearch.providers.find((p) => p.type === webSearch.activeProviderId);

	if (activeConfig) {
		if (webSearch.activeProviderId === 'searxng') {
			new Setting(el)
				.setName(t('settings.webSearch.baseUrl.name' as any))
				.setDesc(t('settings.webSearch.baseUrl.desc' as any))
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
				.setName(t('settings.webSearch.apiKey.name' as any))
				.setDesc(t('settings.webSearch.apiKey.desc' as any))
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
					.setName(t('settings.webSearch.googleSearchEngineId.name' as any))
					.setDesc(t('settings.webSearch.googleSearchEngineId.desc' as any))
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
			.setName(t('settings.webSearch.maxResults.name' as any))
			.setDesc(t('settings.webSearch.maxResults.desc' as any)),
		{ min: 1, max: 10, step: 1, value: webSearch.maxResults },
		async (val: number) => {
			webSearch.maxResults = val;
			await tab.saveAndSync();
		},
	);

	if (tab.showAdvanced) {
		tab.advancedLabel(el);
		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.webSearch.maxContentLength.name' as any))
				.setDesc(t('settings.webSearch.maxContentLength.desc' as any)),
			{ min: 500, max: 10000, step: 500, value: webSearch.maxContentLength },
			async (val: number) => {
				webSearch.maxContentLength = val;
				await tab.saveAndSync();
			},
		);
	}
}
