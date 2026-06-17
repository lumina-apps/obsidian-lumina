/** 기본 채팅 모델 선택 섹션 */

import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import {
	buildChatModelOptions,
	parseProviderModelValue,
	toProviderModelValue,
} from '../../../../shared/utils/settingHelpers';

export function renderDefaultChatModelSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

	tab.sectionHeading(el, t('settings.connections.defaultChatModel.name'));

	const chatModelOptions = buildChatModelOptions(s.providers);

	if (chatModelOptions.length === 0) {
		tab.infoBox(el, t('settings.connections.defaultChatModel.noConnections'));
		return;
	}

	const defaultChatSetting = new Setting(el)
		.setName(t('settings.connections.defaultChatModel.sidebarDefault'))
		.setDesc(t('settings.connections.defaultChatModel.desc'));

	const currentChatValue = s.defaultProviderId && s.defaultModelId
		? toProviderModelValue(s.defaultProviderId, s.defaultModelId)
		: '';
	const currentChatLabel = currentChatValue
		? (chatModelOptions.find(opt => opt.value === currentChatValue)?.label || currentChatValue)
		: t('settings.connections.apiKey.selectModel');

	const adjustedChatModelOptions = currentChatValue === ''
		? [{ value: '', label: t('settings.connections.apiKey.selectModel') }, ...chatModelOptions]
		: chatModelOptions;

	tab.addModelSelector(
		defaultChatSetting,
		adjustedChatModelOptions,
		currentChatValue,
		currentChatLabel,
		async (val) => {
			if (val === '') {
				s.defaultProviderId = '';
				s.defaultModelId = '';
			} else {
				const parsed = parseProviderModelValue(val);
				if (parsed) {
					s.defaultProviderId = parsed.providerId;
					s.defaultModelId = parsed.modelId;
				}
			}
			await tab.saveAndSync();
		},
		() => s.defaultProviderId && s.defaultModelId ? toProviderModelValue(s.defaultProviderId, s.defaultModelId) : '',
	);
}