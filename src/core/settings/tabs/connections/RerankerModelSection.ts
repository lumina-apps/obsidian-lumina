/**
 * RerankerModelSection.ts
 *
 * 리랭커 모델 (RAG 파이프라인에서 검색 결과 리랭크 시 사용) 선택 섹션 렌더링.
 */

import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import {
	buildChatModelOptions,
	parseProviderModelValue,
	toProviderModelValue,
} from '../../../../shared/utils/settingHelpers';

export function renderRerankerModelSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

	const rerankerModelSetting = new Setting(el)
		.setName(t('settings.connections.rerankerModel.name') || '리랭커 모델 (선택)')
		.setDesc(t('settings.connections.rerankerModel.desc') || 'RAG 파이프라인에서 1차 검색 결과를 재정렬할 때 사용할 모델을 선택합니다. 선택 시 자동으로 리랭크 기능이 활성화됩니다.');

	const chatModelOptions = buildChatModelOptions(s.providers);

	const currentRerankerValue = s.rerankerProviderId && s.rerankerModelId
		? toProviderModelValue(s.rerankerProviderId, s.rerankerModelId)
		: '';
	const noneSelectedLabel = t('settings.connections.rerankerModel.noneSelected') || '선택 안 함 (비활성화)';
	const currentRerankerLabel = currentRerankerValue === '' 
        ? noneSelectedLabel 
        : (chatModelOptions.find(opt => opt.value === currentRerankerValue)?.label || currentRerankerValue);

	const rerankerOptionsWithNone = [{ value: '', label: noneSelectedLabel }, ...chatModelOptions];

	tab.addModelSelector(
		rerankerModelSetting,
		rerankerOptionsWithNone,
		currentRerankerValue,
		currentRerankerLabel,
		async (val) => {
			if (val === '') {
				s.rerankerProviderId = '';
				s.rerankerModelId = '';
			} else {
				const parsed = parseProviderModelValue(val);
				if (parsed) {
					s.rerankerProviderId = parsed.providerId;
					s.rerankerModelId = parsed.modelId;
				}
			}
			await tab.saveAndSync();
		},
		() => s.rerankerProviderId && s.rerankerModelId ? toProviderModelValue(s.rerankerProviderId, s.rerankerModelId) : '',
	);
}
