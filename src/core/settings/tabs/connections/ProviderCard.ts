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
import { debugLogger } from '../../../../shared/debugLogger';
import { debounce } from '../../../../shared/utils/debounce';

export function renderProviderCard(tab: LuminaSettingTab, el: HTMLElement, provider: LLMProviderConfig): void {
	const category = PROVIDER_CATEGORIES[provider.type];
	const isCli = category === 'cli';
	const requiresBaseUrl = !isCli && (category === 'local' || provider.type === 'custom');
	const requiresApiKey = !isCli && category !== 'local';

	const debouncedSave = debounce(() => {
		tab.saveAndSync().catch((err: unknown) => {
			debugLogger.logError('settings', err instanceof Error ? err : new Error(String(err)));
		});
	}, 400);

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

				for (const project of tab.plugin.settings.projects.list) {
					if (project.defaultProviderId === provider.id) {
						project.defaultModelId = '';
					}
				}

				// 임베딩 미지원 타입(Anthropic, CLI 등)으로 변경된 경우 embedding 설정 초기화
				if (tab.plugin.settings.connections.embedding.providerId === provider.id) {
					if (provider.type === 'anthropic' || isCliProvider(provider.type)) {
						tab.plugin.settings.connections.embedding = { mode: 'auto', providerId: '', modelId: '' };
					} else {
						tab.plugin.settings.connections.embedding.modelId = '';
					}
				}

				// 퀵 액션/태스크/리랭커 전용 모델 정리
				if (tab.plugin.settings.connections.quickActionProviderId === provider.id) {
					if (isCliProvider(provider.type)) {
						tab.plugin.settings.connections.quickActionProviderId = '';
					}
					tab.plugin.settings.connections.quickActionModelId = '';
				}
				if (tab.plugin.settings.connections.taskProviderId === provider.id) {
					if (isCliProvider(provider.type)) {
						tab.plugin.settings.connections.taskProviderId = '';
					}
					tab.plugin.settings.connections.taskModelId = '';
				}
				if (tab.plugin.settings.connections.rerankerProviderId === provider.id) {
					if (isCliProvider(provider.type)) {
						tab.plugin.settings.connections.rerankerProviderId = '';
					}
					tab.plugin.settings.connections.rerankerModelId = '';
				}

				// 즐겨찾기 모델에서 해당 프로바이더 제거
				tab.plugin.settings.connections.favoriteModels =
					tab.plugin.settings.connections.favoriteModels.filter(f => f.providerId !== provider.id);

				debouncedSave.cancel();
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
					.onChange((val) => {
						provider.binaryPath = val.trim();
						provider.isVerified = false;
						debouncedSave.invoke();
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
					provider.baseUrl = inputEl.value.trim();
					provider.isVerified = false;
					debouncedSave.invoke();
				});
				text
					.setPlaceholder('http://localhost:11434')
					.setValue(provider.baseUrl || '');
				text.onChange((val) => {
					if (composing) return;
					provider.baseUrl = val.trim();
					provider.isVerified = false;
					debouncedSave.invoke();
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
					provider.credential = inputEl.value.trim();
					provider.isVerified = false;
					debouncedSave.invoke();
				});
				text
					.setPlaceholder('sk-...')
					.setValue(provider.credential);
				text.inputEl.type = 'password';
				text.onChange((val) => {
					if (composing) return;
					provider.credential = val.trim();
					provider.isVerified = false;
					debouncedSave.invoke();
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
				try {
					debouncedSave.cancel();
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
											void tab.plugin.mcpManager.syncServers().catch((err: unknown) => {
												debugLogger.logError('mcp', err instanceof Error ? err : new Error(`MCP sync failed: ${err}`));
											});
										}
									}
									void tab.saveAndSync().then(() => {
										tab.refreshDisplay();
										new Notice(t('uiMessages.agentBetaEnabled'));
									}).catch((err: unknown) => {
										debugLogger.logError('settings', err instanceof Error ? err : new Error(`Save failed: ${err}`));
									});
								},
							).open();
						}, 300);
					}
				} finally {
					btn.setButtonText(t('settings.connections.apiKey.testConnection')).setDisabled(false);
				}
			});
		})
		.addExtraButton(btn => {
			rightGroup.appendChild(btn.extraSettingsEl);
			btn.setIcon('trash').setTooltip(t('settings.connections.apiKey.deleteConnection')).onClick(async () => {
				debouncedSave.cancel();
				const deletedId = provider.id;
				tab.plugin.settings.connections.providers =
					tab.plugin.settings.connections.providers.filter(p => p.id !== deletedId);

				// Secret Storage에서 API 키 안전하게 제거
				if (tab.app.secretStorage) {
					try {
						tab.app.secretStorage.setSecret(`lumina-provider-${deletedId}`, '');
					} catch (e) {
						debugLogger.logWarn('settings', `Failed to delete secret for ${deletedId}: ${e}`);
					}
				}

				// 삭제된 프로바이더를 참조하던 설정 정리
				if (tab.plugin.settings.connections.embedding.providerId === deletedId) {
					tab.plugin.settings.connections.embedding = { mode: 'auto', providerId: '', modelId: '' };
				}
				if (tab.plugin.settings.connections.quickActionProviderId === deletedId) {
					tab.plugin.settings.connections.quickActionProviderId = '';
					tab.plugin.settings.connections.quickActionModelId = '';
				}
				if (tab.plugin.settings.connections.taskProviderId === deletedId) {
					tab.plugin.settings.connections.taskProviderId = '';
					tab.plugin.settings.connections.taskModelId = '';
				}
				if (tab.plugin.settings.connections.rerankerProviderId === deletedId) {
					tab.plugin.settings.connections.rerankerProviderId = '';
					tab.plugin.settings.connections.rerankerModelId = '';
				}

				// favoriteModels에서 삭제된 프로바이더 제거
				tab.plugin.settings.connections.favoriteModels =
					tab.plugin.settings.connections.favoriteModels.filter(f => f.providerId !== deletedId);

				// 프로젝트 기본 설정에서 삭제된 프로바이더 참조 초기화
				for (const project of tab.plugin.settings.projects.list) {
					if (project.defaultProviderId === deletedId) {
						project.defaultProviderId = '';
						project.defaultModelId = '';
					}
				}

				await tab.saveAndSync();
				tab.refreshDisplay();
			});
		});
}

export async function testProvider(provider: LLMProviderConfig): Promise<void> {
	try {
		provider.credential = provider.credential?.trim() ?? '';
		if (provider.baseUrl) {
			provider.baseUrl = provider.baseUrl.trim();
		}
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
		// 일시적 네트워크 장애로 기존 모델 목록이 소실되지 않도록 보존 (기존 모델이 없을 때만 빈 배열 유지)
		if (!provider.availableModels || provider.availableModels.length === 0) {
			provider.availableModels = [];
		}
		new Notice(`❌ ${t('settings.connections.apiKey.fail')}${normalizeError(e).message}`);
	}
}