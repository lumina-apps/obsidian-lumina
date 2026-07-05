import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import { getActiveProject } from '../../../store/projectStore';

export function renderDefaultSystemPromptSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const activeProject = getActiveProject();
	const systemPrompts = tab.plugin.settings.chat.systemPrompts;
	
	const currentPromptId = activeProject.systemPromptId || '';
	const isPromptMissing = currentPromptId !== '' && !systemPrompts.some(p => p.id === currentPromptId);
	
	new Setting(el)
		.setName(t('projects.settings.systemPrompt') || '기본 시스템 프롬프트')
		.setDesc(t('projects.settings.systemPromptDesc') || '이 프로젝트에서 새 채팅을 시작할 때 사용할 기본 시스템 프롬프트입니다. (프로젝트 설정에서도 변경 가능)')
		.addDropdown(dropdown => {
			dropdown.addOption('', t('projects.settings.systemPromptAuto') || '자동 선택 (첫 번째 시스템 프롬프트)');
			
			if (isPromptMissing) {
				dropdown.addOption(currentPromptId, t('projects.settings.deletedPrompt') || '[삭제됨] 프롬프트');
			}

			systemPrompts.forEach(p => {
				dropdown.addOption(p.id, p.name);
			});

			dropdown.setValue(currentPromptId);
			dropdown.onChange(async (value: string) => {
				activeProject.systemPromptId = value === '' ? '' : value;
				
				// Sync to global settings
				const projIndex = tab.plugin.settings.projects.list.findIndex((p: any) => p.id === activeProject.id);
				if (projIndex !== -1) {
					tab.plugin.settings.projects.list[projIndex] = activeProject;
					await tab.saveAndSync();
				}
			});

			dropdown.selectEl.style.maxWidth = '230px';
			dropdown.selectEl.style.textOverflow = 'ellipsis';
		});
}
