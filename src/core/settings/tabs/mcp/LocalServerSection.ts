import { Notice, Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import type { TranslationKeys } from '../../../../shared/locales/locale.types';
import {
	createFeatureCard,
	createImePasswordBinding,
} from '../../../../shared/utils/settingHelpers';
import type { McpSettings } from '../../../../shared/types/settings.types';

export function renderLocalServerSection(tab: LuminaSettingTab, el: HTMLElement, s: McpSettings): void {
	tab.sectionHeading(el, t('settings.mcp.localServer.sectionTitle'));

	const serverCard = createFeatureCard(el, s.serverEnabled);

	new Setting(serverCard)
		.setName(t('settings.mcp.localServer.enable.name'))
		.setDesc(t('settings.mcp.localServer.desc'))
		.addToggle(toggle => {
			toggle.setValue(s.serverEnabled).onChange(async (val) => {
				s.serverEnabled = val;
				if (val && !s.serverAuthToken) {
					s.serverAuthToken = crypto.randomUUID();
				}
				if (!val && tab.plugin.settings.chat.agentEnabled) {
					tab.plugin.settings.chat.agentEnabled = false;
					new Notice(t('uiMessages.agentModeLocalServerStoppedDisabled'));
				}
				await tab.saveAndSync(true);
				tab.refreshDisplay();
			});
		});

	if (!s.serverEnabled) return;

	// ─── Port ───
	new Setting(serverCard)
		.setName(t('settings.mcp.localServer.port.name'))
		.setDesc(t('settings.mcp.localServer.port.desc'))
		.addText(text => {
			text.inputEl.type = 'number';
			text.setValue(s.serverPort.toString()).onChange(async (val) => {
				const num = parseInt(val, 10);
				if (!isNaN(num)) {
					s.serverPort = num;
					await tab.saveAndSync();
				}
			});
		});

	// ─── Auth Token ───
	const tokenSetting = new Setting(serverCard)
		.setName(t('settings.mcp.localServer.token.name'))
		.setDesc(t('settings.mcp.localServer.token.desc'))
		.setClass('lumina-setting-token');

	tokenSetting.addText(text => {
		createImePasswordBinding(text, s.serverAuthToken, '', async (val) => {
			s.serverAuthToken = val;
			await tab.saveAndSync();
		});
	});

	tokenSetting.addButton(btn => {
		btn.setButtonText(t('common.copy'))
			.onClick(() => {
				void navigator.clipboard.writeText(s.serverAuthToken);
				new Notice(t('uiMessages.mcpTokenCopied'));
			});
	});

	tokenSetting.addButton(btn => {
		btn.setButtonText(t('settings.mcp.localServer.token.regenerate'))
			.onClick(async () => {
				s.serverAuthToken = crypto.randomUUID();
				await tab.saveAndSync();
				tab.refreshDisplay();
			});
	});

	new Setting(serverCard)
		.setName(t('settings.mcp.localServer.enableShellCommands.name'))
		.setDesc(t('settings.mcp.localServer.enableShellCommands.desc'))
		.addToggle(toggle => {
			toggle.setValue(s.serverEnableShellCommands ?? false).onChange(async (val) => {
				s.serverEnableShellCommands = val;
				await tab.saveAndSync(false, false); 
				
				// 실시간으로 툴 목록 업데이트
				const localClient = tab.plugin.mcpManager?.clients.get('__lumina_local__');
				if (localClient) {
					await localClient.refreshTools().catch(console.error);
				}
			});
		});

	tab.infoBox(serverCard, t('settings.mcp.localServer.guide', { port: s.serverPort }), 'info');

	if (tab.showAdvanced) {
		renderLocalServerAdvancedSettings(tab, el, s);
	}
}

function renderLocalServerAdvancedSettings(tab: LuminaSettingTab, parentEl: HTMLElement, s: McpSettings): void {
	tab.advancedLabel(parentEl);

	const advancedFields: Array<{
		nameKey: string;
		descKey: string;
		get: () => number;
		set: (val: number) => void;
	}> = [
		{
			nameKey: 'settings.mcp.localServer.maxRead.name',
			descKey: 'settings.mcp.localServer.maxRead.desc',
			get: () => s.serverMaxReadChars,
			set: (v) => { s.serverMaxReadChars = v; },
		},
		{
			nameKey: 'settings.mcp.localServer.searchSnippet.name',
			descKey: 'settings.mcp.localServer.searchSnippet.desc',
			get: () => s.serverSearchSnippetLength,
			set: (v) => { s.serverSearchSnippetLength = v; },
		},
		{
			nameKey: 'settings.mcp.localServer.searchMaxResults.name',
			descKey: 'settings.mcp.localServer.searchMaxResults.desc',
			get: () => s.serverSearchMaxResults,
			set: (v) => { s.serverSearchMaxResults = v; },
		},
		{
			nameKey: 'settings.mcp.localServer.maxAppend.name',
			descKey: 'settings.mcp.localServer.maxAppend.desc',
			get: () => s.serverMaxAppendChars,
			set: (v) => { s.serverMaxAppendChars = v; },
		},
	];

	for (const field of advancedFields) {
		new Setting(parentEl)
			.setName(t(field.nameKey as TranslationKeys))
			.setDesc(t(field.descKey as TranslationKeys))
			.addText(text => {
				text.inputEl.type = 'number';
				text.setValue(field.get().toString()).onChange(async (val) => {
					const num = parseInt(val, 10);
					if (!isNaN(num)) {
						field.set(num);
						await tab.saveAndSync();
					}
				});
			});
	}
}