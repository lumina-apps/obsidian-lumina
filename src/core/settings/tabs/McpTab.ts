import { Notice, Setting, type TextComponent } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { t } from '../../../shared/locales/helpers';
import type { McpServerConfig } from '../../../shared/types/settings.types';

const AGENT_DEFAULT_MAX_STEPS = 15;

export function renderMcpTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.mcp;

	// ── 에이전트 (Agent) ───────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.mcp.agentMode.name'));

	const agentCard = el.createDiv({ cls: `lumina-feature-card${tab.plugin.settings.chat.agentEnabled ? ' is-active' : ''}` });

	const agentModeDesc = activeDocument.createDocumentFragment();
	t('settings.mcp.agentMode.desc').split('\n').forEach((line, i) => {
		if (i > 0) agentModeDesc.createEl('br');
		agentModeDesc.appendText(line);
	});

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
				tab.display(); // UI 즉시 갱신
			});
		});

	new Setting(agentCard)
		.setName(t('settings.mcp.agentMode.maxSteps'))
		.setDesc(t('settings.mcp.agentMode.maxStepsDesc'))
		.addText(text => {
			text.inputEl.type = 'number';
			text.setValue((tab.plugin.settings.chat.agentMaxSteps || AGENT_DEFAULT_MAX_STEPS).toString()).onChange(async (val) => {
				const num = parseInt(val, 10);
				if (!isNaN(num) && num > 0) {
					tab.plugin.settings.chat.agentMaxSteps = num;
					await tab.saveAndSync();
				}
			});
		});

	// ─── 내장 MCP 서버 호스팅 ───
	tab.sectionHeading(el, t('settings.mcp.localServer.sectionTitle'));

	const serverDescEl = activeDocument.createDocumentFragment();
	serverDescEl.createEl('div', { text: t('settings.mcp.localServer.desc') });

	const localServerCard = el.createDiv({ cls: `lumina-feature-card${s.serverEnabled ? ' is-active' : ''}` });

	new Setting(localServerCard)
		.setName(t('settings.mcp.localServer.enable.name'))
		.setDesc(serverDescEl)
		.addToggle(toggle => {
			toggle.setValue(s.serverEnabled).onChange(async (val) => {
				s.serverEnabled = val;
				if (val && !s.serverAuthToken) {
					s.serverAuthToken = crypto.randomUUID(); // 최초 활성화 시 토큰 생성
				}
				if (!val && tab.plugin.settings.chat.agentEnabled) {
					tab.plugin.settings.chat.agentEnabled = false;
					new Notice(t('uiMessages.agentModeLocalServerStoppedDisabled'));
				}
				await tab.saveAndSync(true);
				tab.display(); // UI 즉시 갱신
			});
		});

	if (s.serverEnabled) {
		new Setting(localServerCard)
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

		const tokenSetting = new Setting(localServerCard)
			.setName(t('settings.mcp.localServer.token.name'))
			.setDesc(t('settings.mcp.localServer.token.desc'))
			.addText(text => {
				text.setValue(s.serverAuthToken).onChange(async (val) => {
					s.serverAuthToken = val;
					await tab.saveAndSync();
				});
				text.inputEl.type = 'password';
			})
			.addButton(btn => {
				btn.setButtonText(t('common.copy'))
					.onClick(() => {
						void navigator.clipboard.writeText(s.serverAuthToken);
						new Notice(t('uiMessages.mcpTokenCopied'));
					});
			})
			.addButton(btn => {
				btn.setButtonText(t('settings.mcp.localServer.token.regenerate'))
					.onClick(async () => {
						s.serverAuthToken = crypto.randomUUID();
						await tab.saveAndSync();
						tab.display();
					});
			});

		tab.infoBox(localServerCard, t('settings.mcp.localServer.guide', { port: s.serverPort }), 'info');

		if (tab.showAdvanced) {
			tab.advancedLabel(localServerCard);

			new Setting(localServerCard)
				.setName(t('settings.mcp.localServer.maxRead.name'))
				.setDesc(t('settings.mcp.localServer.maxRead.desc'))
				.addText(text => {
					text.inputEl.type = 'number';
					text.setValue(s.serverMaxReadChars.toString()).onChange(async (val) => {
						const num = parseInt(val, 10);
						if (!isNaN(num)) {
							s.serverMaxReadChars = num;
							await tab.saveAndSync();
						}
					});
				});

			new Setting(localServerCard)
				.setName(t('settings.mcp.localServer.searchSnippet.name'))
				.setDesc(t('settings.mcp.localServer.searchSnippet.desc'))
				.addText(text => {
					text.inputEl.type = 'number';
					text.setValue(s.serverSearchSnippetLength.toString()).onChange(async (val) => {
						const num = parseInt(val, 10);
						if (!isNaN(num)) {
							s.serverSearchSnippetLength = num;
							await tab.saveAndSync();
						}
					});
				});

			new Setting(localServerCard)
				.setName(t('settings.mcp.localServer.searchMaxResults.name'))
				.setDesc(t('settings.mcp.localServer.searchMaxResults.desc'))
				.addText(text => {
					text.inputEl.type = 'number';
					text.setValue(s.serverSearchMaxResults.toString()).onChange(async (val) => {
						const num = parseInt(val, 10);
						if (!isNaN(num)) {
							s.serverSearchMaxResults = num;
							await tab.saveAndSync();
						}
					});
				});

			new Setting(localServerCard)
				.setName(t('settings.mcp.localServer.maxAppend.name'))
				.setDesc(t('settings.mcp.localServer.maxAppend.desc'))
				.addText(text => {
					text.inputEl.type = 'number';
					text.setValue(s.serverMaxAppendChars.toString()).onChange(async (val) => {
						const num = parseInt(val, 10);
						if (!isNaN(num)) {
							s.serverMaxAppendChars = num;
							await tab.saveAndSync();
						}
					});
				});
		}
	}

	// ─── 외부 MCP 서버 (클라이언트 연결) ───
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
					tab.display();
				});
		});
}

export function renderMcpServerCard(tab: LuminaSettingTab, el: HTMLElement, server: McpServerConfig): void {
	const statusClass = server.status === 'connected' ? 'is-verified' : server.status === 'error' ? 'is-error' : '';
	const card = el.createDiv({ cls: `lumina-provider-card mcp-server-card mcp-server-card--${server.status || 'disconnected'} ${statusClass}` });
	// inline grid로 2x2 레이아웃 강제 적용
	card.setCssStyles({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', alignItems: 'start', padding: '12px 16px 8px 16px', overflow: 'visible' });

	// 이름
	const nameSetting = new Setting(card)
		.setName(t('settings.mcp.serverName'))
		.setDesc(t('settings.mcp.serverName'))
		.addText(text => {
			text.setValue(server.name).onChange(async (val) => {
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
		.setDesc(t('settings.mcp.externalServer.sseUrl.desc'))
		.addText(text => {
			text.setValue(server.url || '').onChange(async (val) => {
				server.url = val;
				await tab.saveAndSync();
			});
		});
	urlSetting.settingEl.addClass('mcp-server-card__url');
	urlSetting.settingEl.setCssStyles({ gridColumn: '1', gridRow: '2' });

	// sse Auth Token
	let tokenInput: TextComponent;
	const authSetting = new Setting(card)
		.setName(t('settings.mcp.externalServer.token.name'))
		.setDesc(t('settings.mcp.externalServer.token.desc'))
		.addText(text => {
			tokenInput = text;
			text.setValue(server.authToken || '')
				.setPlaceholder('token')
				.onChange(async (val) => {
					server.authToken = val;
					await tab.saveAndSync();
				});
			text.inputEl.type = 'password';
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
					await tab.saveAndSync(true); // 연결 완료 후 UI 갱신
					// 만약 연결 실패로 인해 내부적으로 false로 강등되었다면 토글 UI를 다시 꺼준다
					if (server.enabled !== val) {
						toggle.setValue(server.enabled);
					}
					tab.display(); // 상태(색상 등) 업데이트를 위해 전체 다시 렌더링
				});
		})
		.addExtraButton(btn => {
			btn.setIcon('trash').setTooltip(t('settings.mcp.deleteServer')).onClick(async () => {
				tab.plugin.settings.mcp.servers = tab.plugin.settings.mcp.servers.filter(s => s.id !== server.id);
				await tab.saveAndSync();
				tab.display();
			});
		});
	actionsSetting.settingEl.addClass('lumina-provider-card__setting-actions');
	actionsSetting.settingEl.addClass('mcp-server-card__actions');
	actionsSetting.settingEl.setCssStyles({ gridColumn: '1 / -1' });
}
