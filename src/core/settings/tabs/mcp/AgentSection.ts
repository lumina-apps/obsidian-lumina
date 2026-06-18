import { Notice, Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import { createFeatureCard, createMultilineDesc } from '../../../../shared/utils/settingHelpers';
import type { McpSettings } from '../../../../shared/types/settings.types';

const AGENT_DEFAULT_MAX_STEPS = 15;

export function renderAgentSection(tab: LuminaSettingTab, el: HTMLElement, s: McpSettings): void {
	tab.sectionHeading(el, t('settings.mcp.agentMode.name'));

	const agentCard = createFeatureCard(el, tab.plugin.settings.chat.agentEnabled);

	const agentModeDesc = createMultilineDesc(t('settings.mcp.agentMode.desc'));

	new Setting(agentCard)
		.setName(t('settings.mcp.agentMode.name'))
		.setDesc(agentModeDesc)
		.addToggle(toggle => {
			toggle.setValue(tab.plugin.settings.chat.agentEnabled).onChange(async (val) => {
				if (val) {
					const isConfigured = tab.plugin.settings.connections.providers.some(p => p.isVerified);
					if (!isConfigured) {
						new Notice(t('uiMessages.agentModeLlmRequired'));
						toggle.setValue(false);
						return;
					}

					tab.plugin.settings.chat.agentEnabled = true;
					if (!tab.plugin.settings.mcp.serverEnabled) {
						tab.plugin.settings.mcp.serverEnabled = true;
						if (!tab.plugin.settings.mcp.serverAuthToken) {
							tab.plugin.settings.mcp.serverAuthToken = crypto.randomUUID();
						}
						new Notice(t('uiMessages.agentModeLocalServerStarting'));
						if (tab.plugin.mcpManager) {
							await tab.plugin.mcpManager.syncServers();
						}
					} else {
						new Notice(t('uiMessages.agentModeEnabled'));
					}
				} else {
					tab.plugin.settings.chat.agentEnabled = false;
					new Notice(t('uiMessages.agentModeDisabled'));
				}
				await tab.saveAndSync();
				tab.refreshDisplay(); // UI 즉시 갱신
			});
		});

	new Setting(agentCard)
		.setName(t('settings.mcp.agentMode.respectRagExclusions'))
		.setDesc(t('settings.mcp.agentMode.respectRagExclusionsDesc'))
		.addToggle(toggle => {
			toggle.setValue(tab.plugin.settings.mcp.agentRespectRagExclusions).onChange(async (val) => {
				tab.plugin.settings.mcp.agentRespectRagExclusions = val;
				await tab.saveAndSync();
			});
		});

	new Setting(agentCard)
		.setName(t('settings.mcp.agentMode.maxSteps'))
		.setDesc(t('settings.mcp.agentMode.maxStepsDesc'))
		.addText(text => {
			text.inputEl.type = 'number';
			const currentValue = tab.plugin.settings.chat.agentMaxSteps || AGENT_DEFAULT_MAX_STEPS;
			text.setValue(currentValue.toString()).onChange(async (val) => {
				const num = parseInt(val, 10);
				if (!isNaN(num) && num > 0) {
					tab.plugin.settings.chat.agentMaxSteps = num;
					await tab.saveAndSync();
				}
			});
		});
}