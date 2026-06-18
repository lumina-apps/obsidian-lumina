import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import type { McpServerConfig } from '../../../../shared/types/settings.types';
import { createImePasswordBinding, createImeTextBinding } from '../../../../shared/utils/settingHelpers';

export function renderMcpServerCard(tab: LuminaSettingTab, el: HTMLElement, server: McpServerConfig): void {
	const statusClass = server.status === 'connected' ? 'is-verified' : server.status === 'error' ? 'is-error' : '';
	const card = el.createDiv({ cls: `lumina-provider-card mcp-server-card mcp-server-card--${server.status || 'disconnected'} ${statusClass}` });
	// inline grid로 2x2 레이아웃 강제 적용
	card.setCssStyles({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', alignItems: 'start', padding: '12px 16px 8px 16px', overflow: 'visible' });

	// 이름
	const nameSetting = new Setting(card)
		.setName(t('settings.mcp.serverName'))
		.setDesc(t('settings.mcp.serverName'));
	nameSetting.addText(text => {
		createImeTextBinding(text, server.name, async (val) => {
			server.name = val;
			await tab.saveAndSync();
		});
	});
	nameSetting.settingEl.addClass('mcp-server-card__name');
	nameSetting.settingEl.setCssStyles({ gridColumn: '1', gridRow: '1' });

	// 전송 방식 (고정)
	const transportSetting = new Setting(card)
		.setName(t('settings.mcp.transport'))
		.setDesc(t('settings.mcp.transport'))
		.addText(text => {
			text.setValue('SSE (Remote HTTP)').setDisabled(true);
		});
	transportSetting.settingEl.addClass('mcp-server-card__transport');
	transportSetting.settingEl.setCssStyles({ gridColumn: '2', gridRow: '1' });

	// sse URL
	const urlSetting = new Setting(card)
		.setName(t('settings.mcp.externalServer.sseUrl.name'))
		.setDesc(t('settings.mcp.externalServer.sseUrl.desc'));
	urlSetting.addText(text => {
		createImeTextBinding(text, server.url || '', async (val) => {
			server.url = val;
			await tab.saveAndSync();
		});
	});
	urlSetting.settingEl.addClass('mcp-server-card__url');
	urlSetting.settingEl.setCssStyles({ gridColumn: '1', gridRow: '2' });

	// sse Auth Token
	const authSetting = new Setting(card)
		.setName(t('settings.mcp.externalServer.token.name'))
		.setDesc(t('settings.mcp.externalServer.token.desc'));
	authSetting.addText(text => {
		createImePasswordBinding(text, server.authToken || '', 'token', async (val) => {
			server.authToken = val;
			await tab.saveAndSync();
		});
	});
	authSetting.settingEl.addClass('mcp-server-card__token');
	authSetting.settingEl.setCssStyles({ gridColumn: '2', gridRow: '2' });

	// 액션 (토글 + 삭제)
	const actionsSetting = new Setting(card)
		.addToggle(toggle => {
			toggle.setValue(server.enabled)
				.setTooltip(t('settings.mcp.enableDesc'))
				.onChange(async (val) => {
					server.enabled = val;
					await tab.saveAndSync(true, true); // 연결 완료 후 UI 갱신 + MCP 동기화
					// 만약 연결 실패로 인해 내부적으로 false로 강등되었다면 토글 UI를 다시 꺼준다
					if (server.enabled !== val) {
						toggle.setValue(server.enabled);
					}
					tab.refreshDisplay(); // 상태(색상 등) 업데이트를 위해 전체 다시 렌더링
				});
		})
		.addExtraButton(btn => {
			btn.setIcon('trash').setTooltip(t('settings.mcp.deleteServer')).onClick(async () => {
				tab.plugin.settings.mcp.servers = tab.plugin.settings.mcp.servers.filter(s => s.id !== server.id);
				await tab.saveAndSync();
				tab.refreshDisplay();
			});
		});
	actionsSetting.settingEl.addClass('lumina-provider-card__setting-actions');
	actionsSetting.settingEl.addClass('mcp-server-card__actions');
	actionsSetting.settingEl.setCssStyles({ gridColumn: '1 / -1' });
}