import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import { getActiveProject } from '../../../store/projectStore';
import { buildChatModelOptions, toProviderModelValue, parseProviderModelValue } from '../../../../shared/utils/modelUtils';

export function renderDefaultChatModelSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const activeProject = getActiveProject();
	
	// Create options using utility
	const chatModelOptions = buildChatModelOptions(tab.plugin.settings.connections.providers);

	const currentModelValue = (activeProject.defaultProviderId && activeProject.defaultModelId)
		? toProviderModelValue(activeProject.defaultProviderId, activeProject.defaultModelId)
		: '';

	const isModelMissing = currentModelValue !== '' && !chatModelOptions.some(opt => opt.value === currentModelValue);

	new Setting(el)
		.setName(t('projects.settings.defaultModel') || '기본 채팅 모델')
		.setDesc(t('projects.settings.defaultModelDesc') || '이 프로젝트에서 새 채팅을 시작할 때 사용할 기본 모델입니다.')
		.addDropdown(dropdown => {
			dropdown.addOption('', t('projects.settings.defaultModelAuto') || '자동 선택 (첫 번째 사용 가능한 모델)');
			
			if (isModelMissing) {
				dropdown.addOption(currentModelValue, `${t('projects.settings.deletedModel') || '[삭제됨] 모델'} (${activeProject.defaultModelId})`);
			}
			
			chatModelOptions.forEach(opt => {
				dropdown.addOption(opt.value, opt.label);
			});

			dropdown.setValue(currentModelValue);
			dropdown.onChange(async (val) => {
				if (val === '') {
					activeProject.defaultProviderId = '';
					activeProject.defaultModelId = '';
				} else {
					const parsed = parseProviderModelValue(val);
					if (parsed) {
						activeProject.defaultProviderId = parsed.providerId;
						activeProject.defaultModelId = parsed.modelId;
					}
				}
				
				// Sync to global settings
				const projIndex = tab.plugin.settings.projects.list.findIndex(p => p.id === activeProject.id);
				if (projIndex !== -1) {
					tab.plugin.settings.projects.list[projIndex] = activeProject;
					await tab.saveAndSync();
				}
			});

			dropdown.selectEl.style.maxWidth = '230px';
			dropdown.selectEl.style.textOverflow = 'ellipsis';
		});
}
