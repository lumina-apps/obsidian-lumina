import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import type { McpServerConfig, McpSettings } from '../../../../shared/types/settings.types';
import { renderMcpServerCard } from './McpServerCard';

export function renderExternalServersSection(tab: LuminaSettingTab, el: HTMLElement, s: McpSettings): void {
	tab.sectionHeading(el, t('settings.mcp.externalServer.sectionTitle'));
	tab.infoBox(el, t('settings.mcp.desc'), 'info');

	// MCP 서버 카드 렌더링
	for (const server of s.servers) {
		renderMcpServerCard(tab, el, server);
	}

	// + 새 MCP 서버 추가 버튼
	const addServerSetting = new Setting(el);
	addServerSetting.settingEl.addClass('lumina-setting-cta');
	addServerSetting
		.addButton(btn => {
			btn
				.setButtonText(t('settings.mcp.addServer'))
				.setCta()
				.onClick(async () => {
					const newServer: McpServerConfig = {
						id: crypto.randomUUID(),
						name: 'New Server',
						transport: 'sse',
						url: '',
						enabled: false,
						status: 'disconnected',
					};
					s.servers.push(newServer);
					await tab.saveAndSync();
					tab.refreshDisplay();
				});
		});
}