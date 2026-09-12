import { Notice, Platform, Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import type { LLMProviderConfig, ProviderType } from '../../../../shared/types/settings.types';
import {
	PROVIDER_LABELS,
	PROVIDER_CATEGORIES,
	PROVIDER_BASE_URLS,
	DEFAULT_CLI_BINARIES,
	isCliProvider,
} from '../../../../shared/types/settings.types';
import { createProvider } from '../../../llm-providers/index';
import { CliAgentProvider } from '../../../llm-providers/cli/cli-agent.provider';
import { AgentBetaModal } from '../../../../shared/utils/modal';
import { t } from '../../../../shared/locales/helpers';
import { normalizeError } from '../../../../shared/utils/settingHelpers';

export function renderProviderCard(tab: LuminaSettingTab, el: HTMLElement, provider: LLMProviderConfig): void {
	const category = PROVIDER_CATEGORIES[provider.type];
	const isCli = category === 'cli';
	const requiresBaseUrl = !isCli && (category === 'local' || provider.type === 'custom');
	const requiresApiKey = !isCli && category !== 'local';

	const card = el.createDiv({ cls: `lumina-provider-card${provider.isVerified ? ' is-verified' : ''}` });

	const typeSetting = new Setting(card)
		.setName('Provider')
		.setDesc(provider.isVerified ? `✅ ${t('settings.connections.apiKey.connected')}` : t('settings.connections.apiKey.notConnected'))
		.addDropdown(drop => {
			for (const [val, label] of Object.entries(PROVIDER_LABELS)) {
				if (Platform.isMobile && (PROVIDER_CATEGORIES[val as ProviderType] === 'local' || PROVIDER_CATEGORIES[val as ProviderType] === 'cli')) continue;
				drop.addOption(val, label);
			}
			drop.setValue(provider.type).onChange(async (val) => {
				provider.type = val as ProviderType;

				const isNewLocal = PROVIDER_CATEGORIES[provider.type] === 'local';
				if (isNewLocal && PROVIDER_BASE_URLS[provider.type]) {
					provider.baseUrl = PROVIDER_BASE_URLS[provider.type];
				} else if (provider.type !== 'custom') {
					provider.baseUrl = undefined;
				}

				if (isCliProvider(provider.type)) {
					provider.binaryPath = DEFAULT_CLI_BINARIES[provider.type] || '';
				}

				provider.isVerified = false;
				provider.availableModels = [];
				await tab.saveAndSync();
				tab.refreshDisplay();
			});
		});
	typeSetting.settingEl.addClass('lumina-provider-card__setting-type');

	if (isCli) {
		// CLI 바이너리 경로
		const binarySetting = new Setting(card)
			.setName(t('settings.cli.binaryPathName') || 'Binary Path')
			.setDesc(t('settings.cli.binaryPathDesc') || 'Path to CLI binary (e.g. claude, codex)')
			.addText(text => {
				text
					.setPlaceholder(DEFAULT_CLI_BINARIES[provider.type] || '')
					.setValue(provider.binaryPath || '')
					.onChange(async (val) => {
						provider.binaryPath = val.trim();
						provider.isVerified = false;
						provider.availableModels = [];
						await tab.saveAndSync();
					});
			});
		binarySetting.settingEl.addClass('lumina-provider-card__setting-binary');
	}

	if (requiresBaseUrl) {
		const urlSetting = new Setting(card)
			.setName(t('settings.connections.apiKey.endpointUrl'))
			.setDesc(t('settings.connections.apiKey.endpointPlaceholder'))
			.addText(text => {
				let composing = false;
				const inputEl = text.inputEl;
				inputEl.addEventListener('compositionstart', () => { composing = true; });
				inputEl.addEventListener('compositionend', () => {
					composing = false;
					provider.baseUrl = inputEl.value;
					provider.isVerified = false;
					provider.availableModels = [];
					void tab.saveAndSync();
				});
				text
					.setPlaceholder('http://localhost:11434')
					.setValue(provider.baseUrl || '');
				text.onChange((val) => {
					if (composing) return;
					provider.baseUrl = val;
					provider.isVerified = false;
					provider.availableModels = [];
					tab.saveAndSync().catch(console.error);
				});
			});
		urlSetting.settingEl.addClass('lumina-provider-card__setting-url');
	}

	if (requiresApiKey || provider.type === 'custom') {
		const credentialSetting = new Setting(card)
			.setName(t('settings.connections.apiKey.apiKey'))
			.setDesc(t('settings.connections.apiKey.hiddenDesc'))
			.addText(text => {
				let composing = false;
				const inputEl = text.inputEl;
				inputEl.addEventListener('compositionstart', () => { composing = true; });
				inputEl.addEventListener('compositionend', () => {
					composing = false;
					provider.credential = inputEl.value;
					provider.isVerified = false;
					provider.availableModels = [];
					void tab.saveAndSync();
				});
				text
					.setPlaceholder('sk-...')
					.setValue(provider.credential);
				text.inputEl.type = 'password';
				text.onChange((val) => {
					if (composing) return;
					provider.credential = val;
					provider.isVerified = false;
					provider.availableModels = [];
					tab.saveAndSync().catch(console.error);
				});
			});
		credentialSetting.settingEl.addClass('lumina-provider-card__setting-credential');
	}

	const actionsSetting = new Setting(card);
	actionsSetting.settingEl.addClass('lumina-provider-card__setting-actions');

	const rightGroup = actionsSetting.controlEl.createDiv({ cls: 'lumina-provider-card__actions-right' });

	actionsSetting
		.addButton(btn => {
			rightGroup.appendChild(btn.buttonEl);
			btn.setButtonText(t('settings.connections.apiKey.testConnection')).onClick(async () => {
				btn.setButtonText(t('settings.connections.apiKey.testing')).setDisabled(true);
				const wasVerified = provider.isVerified;
				await testProvider(provider);
				await tab.saveAndSync();
				tab.refreshDisplay();
				// LLM 연결 성공 & 이전에 미연결 상태였고 & 아직 에이전트가 꺼져있으면 → 에이전트 베타 팝업
				if (provider.isVerified && !wasVerified && !tab.plugin.settings.chat.agentEnabled && !isCli) {
					window.setTimeout(() => {
						new AgentBetaModal(
							tab.app,
							t('uiMessages.agentBetaActivateTitle'),
							t('uiMessages.agentBetaActivateDesc'),
							t('uiMessages.agentBetaActivateConfirm'),
							t('uiMessages.agentBetaActivateSkip'),
							(enabled) => {
								if (!enabled) return;
								tab.plugin.settings.chat.agentEnabled = true;
								if (!tab.plugin.settings.mcp.serverEnabled) {
									tab.plugin.settings.mcp.serverEnabled = true;
									if (!tab.plugin.settings.mcp.serverAuthToken) {
										tab.plugin.settings.mcp.serverAuthToken = crypto.randomUUID();
									}
									if (tab.plugin.mcpManager) {
										void tab.plugin.mcpManager.syncServers();
									}
								}
								void tab.saveAndSync().then(() => {
									tab.refreshDisplay();
									new Notice(t('uiMessages.agentBetaEnabled'));
								});
							},
						).open();
					}, 300);
				}
			});
		})
		.addExtraButton(btn => {
			rightGroup.appendChild(btn.extraSettingsEl);
			btn.setIcon('trash').setTooltip(t('settings.connections.apiKey.deleteConnection')).onClick(async () => {
				tab.plugin.settings.connections.providers =
					tab.plugin.settings.connections.providers.filter(p => p.id !== provider.id);

				// 삭제된 프로바이더를 참조하던 설정 정리
				if (tab.plugin.settings.connections.embedding.providerId === provider.id) {
					tab.plugin.settings.connections.embedding = { mode: 'auto', providerId: '', modelId: '' };
				}
				if (tab.plugin.settings.connections.quickActionProviderId === provider.id) {
					tab.plugin.settings.connections.quickActionProviderId = '';
					tab.plugin.settings.connections.quickActionModelId = '';
				}
				if (tab.plugin.settings.connections.taskProviderId === provider.id) {
					tab.plugin.settings.connections.taskProviderId = '';
					tab.plugin.settings.connections.taskModelId = '';
				}
				if (tab.plugin.settings.connections.rerankerProviderId === provider.id) {
					tab.plugin.settings.connections.rerankerProviderId = '';
					tab.plugin.settings.connections.rerankerModelId = '';
				}

				await tab.saveAndSync();
				tab.refreshDisplay();
			});
		});
}

export async function testProvider(provider: LLMProviderConfig): Promise<void> {
	try {
		const p = createProvider(provider);
		if (p instanceof CliAgentProvider) {
			const check = await p.checkAvailability();
			if (!check.available) {
				throw new Error(check.error || 'Binary not found or unavailable');
			}
			const models = await p.listModels();
			provider.isVerified = true;
			provider.availableModels = models.length > 0 ? models : ['default'];
			new Notice(`✅ ${PROVIDER_LABELS[provider.type]}: ${check.version || 'Connected'} (${provider.availableModels.length} models)`);
			return;
		}

		const models = await p.listModels();
		if (models.length === 0) throw new Error(t('settings.connections.apiKey.noModels'));
		provider.isVerified = true;
		provider.availableModels = models;
		new Notice(`✅ ${PROVIDER_LABELS[provider.type]} ${t('settings.connections.apiKey.success')} (${models.length} ${t('settings.connections.apiKey.selectModel')})`);
	} catch (e) {
		provider.isVerified = false;
		provider.availableModels = [];
		new Notice(`❌ ${t('settings.connections.apiKey.fail')}${normalizeError(e).message}`);
	}
}