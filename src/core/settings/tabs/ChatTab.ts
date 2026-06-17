import type { LuminaSettingTab } from '../settingTab';
import { renderSystemPromptSection } from './chat/SystemPromptSection';
import { renderChatHistorySection } from './chat/ChatHistorySection';
import { renderSendModeSection } from './chat/SendModeSection';
import { renderQuickActionSection } from './chat/QuickActionSection';
import { renderAdvancedSection } from './chat/AdvancedSection';

export function renderChatTab(tab: LuminaSettingTab, el: HTMLElement): void {
	renderSystemPromptSection(tab, el);
	renderChatHistorySection(tab, el);
	renderSendModeSection(tab, el);
	renderQuickActionSection(tab, el);

	if (tab.showAdvanced) {
		renderAdvancedSection(tab, el);
	}
}