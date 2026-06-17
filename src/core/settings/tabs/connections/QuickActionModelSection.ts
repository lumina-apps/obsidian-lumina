/**
 * QuickActionModelSection.ts
 *
 * 퀵 액션 전용 모델 선택 섹션 렌더링.
 * ConnectionsTab에서 분리.
 */

import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import {
	buildChatModelOptions,
	parseProviderModelValue,
	toProviderModelValue,
} from '../../../../shared/utils/settingHelpers';

export function renderQuickActionModelSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

	tab.sectionHeading(el, t('settings.connections.quickActionProvider.name'));
	tab.infoBox(el, t('settings.connections.quickActionProvider.desc'), 'warning');

	const chatModelOptions = buildChatModelOptions(s.providers);

	const qaModelSetting = new Setting(el)
		.setName(t('settings.connections.quickActionModel.name'))
		.setDesc(t('settings.connections.quickActionModel.desc'));

	const currentQaValue = s.quickActionProviderId && s.quickActionModelId
		? toProviderModelValue(s.quickActionProviderId, s.quickActionModelId)
		: '';
	const noneSelectedLabel = t('settings.connections.quickActionModel.noneSelected');
	const currentQaLabel = currentQaValue === '' ? noneSelectedLabel : (chatModelOptions.find(opt => opt.value === currentQaValue)?.label || currentQaValue);

	const qaOptionsWithNone = [{ value: '', label: noneSelectedLabel }, ...chatModelOptions];

	tab.addModelSelector(
		qaModelSetting,
		qaOptionsWithNone,
		currentQaValue,
		currentQaLabel,
		async (val) => {
			if (val === '') {
				s.quickActionProviderId = '';
				s.quickActionModelId = '';
			} else {
				const parsed = parseProviderModelValue(val);
				if (parsed) {
					s.quickActionProviderId = parsed.providerId;
					s.quickActionModelId = parsed.modelId;
					tab.warnIfReasoningModel(parsed.modelId);
				}
			}
			await tab.saveAndSync();
		},
		() => s.quickActionProviderId && s.quickActionModelId ? toProviderModelValue(s.quickActionProviderId, s.quickActionModelId) : '',
	);
}