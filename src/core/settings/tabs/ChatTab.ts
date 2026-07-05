import type { LuminaSettingTab } from '../settingTab';
import { renderSystemPromptSection } from './chat/SystemPromptSection';
import { renderChatHistorySection } from './chat/ChatHistorySection';
import { renderSendModeSection } from './chat/SendModeSection';
import { renderQuickActionSection } from './chat/QuickActionSection';
import { renderAdvancedSection } from './chat/AdvancedSection';

import { renderDefaultSystemPromptSection } from './chat/DefaultSystemPromptSection';

export function renderChatTab(tab: LuminaSettingTab, el: HTMLElement): void {
	renderSystemPromptSection(tab, el);
	
	// 프로젝트별 기본 프롬프트 설정 (Active Project 기준)
	renderDefaultSystemPromptSection(tab, el);

	renderChatHistorySection(tab, el);
	renderSendModeSection(tab, el);
	renderQuickActionSection(tab, el);

	if (tab.showAdvanced) {
		renderAdvancedSection(tab, el);
	}
}