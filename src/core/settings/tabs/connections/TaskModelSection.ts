/**
 * TaskModelSection.ts
 *
 * Task 전용 모델 (요약, 제목 생성 등 백그라운드용) 선택 섹션 렌더링.
 */

import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import {
	buildChatModelOptions,
	parseProviderModelValue,
	toProviderModelValue,
} from '../../../../shared/utils/settingHelpers';

export function renderTaskModelSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

	const taskModelSetting = new Setting(el)
		.setName(t('settings.connections.taskModel.name'))
		.setDesc(t('settings.connections.taskModel.desc'));

	const chatModelOptions = buildChatModelOptions(s.providers);

	const currentTaskValue = s.taskProviderId && s.taskModelId
		? toProviderModelValue(s.taskProviderId, s.taskModelId)
		: '';
	const noneSelectedLabel = t('settings.connections.taskModel.noneSelected');
	const currentTaskLabel = currentTaskValue === '' 
        ? noneSelectedLabel 
        : (chatModelOptions.find(opt => opt.value === currentTaskValue)?.label || currentTaskValue);

	const taskOptionsWithNone = [{ value: '', label: noneSelectedLabel }, ...chatModelOptions];

	tab.addModelSelector(
		taskModelSetting,
		taskOptionsWithNone,
		currentTaskValue,
		currentTaskLabel,
		async (val) => {
			if (val === '') {
				s.taskProviderId = '';
				s.taskModelId = '';
			} else {
				const parsed = parseProviderModelValue(val);
				if (parsed) {
					s.taskProviderId = parsed.providerId;
					s.taskModelId = parsed.modelId;
				}
			}
			await tab.saveAndSync();
		},
		() => s.taskProviderId && s.taskModelId ? toProviderModelValue(s.taskProviderId, s.taskModelId) : '',
	);
}
