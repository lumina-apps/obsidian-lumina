import { Notice, Platform, Setting } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { wrapAsync, isEmbeddingModel } from '../settingTab';
import type { LLMProviderConfig, ProviderType } from '../../../shared/types/settings.types';
import { PROVIDER_LABELS, PROVIDER_CATEGORIES, PROVIDER_BASE_URLS } from '../../../shared/types/settings.types';
import { createProvider } from '../../llm-providers/index';
import { translatePluginLocales, loadSystemLocaleCache, deleteSystemLocaleCache } from '../../../shared/locales/translator';
import { ConfirmModal, AgentBetaModal } from '../../../shared/utils/modal';
import { setLanguage, t } from '../../../shared/locales/helpers';
import { debugLogger } from '../../../shared/debugLogger';
import { setIndexingStatus } from '../../store/ragStore';

export function renderConnectionsTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

	// ── 언어 설정 ──────────────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.connections.language.name'));

	new Setting(el)
		.setName(t('settings.connections.language.name'))
		.setDesc(t('settings.connections.language.desc'))
		.addDropdown(drop => {
			drop
				.addOption('en', t('settings.connections.language.option.en'))
				.addOption('ko', t('settings.connections.language.option.ko'))
				.addOption('ja', t('settings.connections.language.option.ja'))
				.addOption('zh', t('settings.connections.language.option.zh'))
				.addOption('zh-tw', t('settings.connections.language.option.zh-tw'))
				.addOption('es', t('settings.connections.language.option.es'))
				.addOption('pt', t('settings.connections.language.option.pt'))
				.addOption('de', t('settings.connections.language.option.de'))
				.addOption('fr', t('settings.connections.language.option.fr'))
				.addOption('ru', t('settings.connections.language.option.ru'))
				.addOption('it', t('settings.connections.language.option.it'))
				.addOption('system', `${t('settings.connections.language.option.system')} (${t('settings.connections.language.current', { lang: tab.getSystemLocale() })})`)
				.setValue(s.language)
				.onChange(async (val) => {
					if (val === 'system') {
						const cacheExists = await loadSystemLocaleCache(tab.app);
						if (!cacheExists) {
							if (s.providers.length === 0) {
								new Notice(t('settings.connections.language.llmRequired'));
								drop.setValue(s.language); // 롤백
								return;
							}
							// LLM 번역 및 캐시 적용 실행 (내부에서 모달로 진행 여부 확인)
							await translatePluginLocales(tab.app, tab.plugin.settings);
						} else {
							setLanguage('system');
						}
					} else {
						setLanguage(val); // 언어 변경 즉시 반영
					}
					s.language = val as typeof s.language;
					tab.plugin.migrateQuickActions();
					await tab.saveAndSync();
					tab.refreshDisplay(); // 언어 변경에 따른 UI 리렌더링
				});
		})
		.addButton(btn => {
			btn
				.setButtonText(t('settings.connections.language.deleteCache'))
				.setTooltip(t('settings.connections.language.deleteCacheTooltip'))
				.onClick(() => {
					new ConfirmModal(
						tab.app,
						t('settings.connections.language.deleteCacheTitle'),
						t('settings.connections.language.deleteCacheConfirm'),
						() => {
							void deleteSystemLocaleCache(tab.app);
						}
					).open();
				});
		});

	// ── LLM 프로바이더 ────────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.connections.apiKey.name'));

	if (Platform.isMobile) {
		tab.infoBox(el, t('settings.connections.apiKey.mobileLocalWarning'), 'warning');
	}

	// 등록된 프로바이더 카드 렌더링
	for (const provider of s.providers) {
		renderProviderCard(tab, el, provider);
	}

	// + 새 LLM 연결 추가 버튼
	const addConnSetting = new Setting(el);
	addConnSetting.settingEl.addClass('lumina-setting-cta');
	addConnSetting
		.addButton(btn => {
			btn
				.setButtonText(t('settings.connections.apiKey.addConnection'))
				.setCta()
				.onClick(wrapAsync(async () => {
					const newProvider: LLMProviderConfig = {
						id: crypto.randomUUID(),
						type: 'openai',
						credential: '',
						availableModels: [],
						isVerified: false,
					};
					s.providers.push(newProvider);
					await tab.saveAndSync();
					tab.refreshDisplay();
				}));
		});

	// ── RAG 엔진 (임베딩) ─────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.connections.ragEngine.name'));

	const descEl = activeDocument.createDocumentFragment();
	descEl.createEl('div', {
		text: t('settings.connections.ragEngine.desc'),
		attr: { style: 'margin-bottom: 6px;' }
	});

	descEl.createEl('div', {
		text: t('settings.connections.ragEngine.privacyNotice'),
		cls: 'lumina-settings__desc-guide',
		attr: { style: 'color: var(--text-success); font-weight: 500;' }
	});

	const isMobileLocked = Platform.isMobile && s.embedding.mode === 'auto';
	if (Platform.isMobile) {
		tab.infoBox(
			el,
			t('settings.connections.ragEngine.mobileWarning'),
			'warning',
		);
	}

	const ragCard = el.createDiv({ cls: `lumina-feature-card${s.ragEnabled ? ' is-active' : ''}` });

	new Setting(ragCard)
		.setName(t('settings.connections.ragEngine.name'))
		.setDesc(descEl)
		.addToggle(toggle => {
			toggle.setValue(s.ragEnabled).onChange(async (val) => {
				s.ragEnabled = val;
				await tab.saveAndSync();
				if (val && !Platform.isMobile) {
					// 워커 초기화는 백그라운드에서 실행 (설정 시 UI 반복 방지)
					tab.plugin.initEmbeddingWorker().catch((err: Error) =>
						debugLogger.logError('rag', err instanceof Error ? err : new Error(`RAG 초기화 실패: ${err}`))
					);
				} else if (!val) {
					// 비활성화: 워커 및 인덱서 정리
					if (tab.plugin.embeddingWorker) {
						tab.plugin.embeddingWorker.terminate();
					}
					tab.plugin.embeddingWorker = null;
					tab.plugin.indexer = null;
					setIndexingStatus('idle');
				}
				tab.refreshDisplay();
			});
			if (isMobileLocked) {
				toggle.setDisabled(true);
				// 강제 끄기 (혹시 켜져있는 상태로 동기화되었을 수 있으므로)
				if (s.ragEnabled) {
					s.ragEnabled = false;
					void tab.saveAndSync();
				}
			}
		});

	if (!tab.showAdvanced) {
		el.createDiv({
			text: t('settings.connections.ragEngine.customGuide'),
			attr: { style: 'color: var(--text-muted); font-size: 0.85em; margin-top: 4px; margin-bottom: 12px; padding-left: 2px;' }
		});
	}

	// 고급 설정 활성화 + RAG 켜짐 → 임베딩 모델 선택 UI 표시
	if (tab.showAdvanced && s.ragEnabled) {
		tab.advancedLabel(el);
		const customDesc = activeDocument.createDocumentFragment();
		customDesc.createEl('div', { text: t('settings.connections.customEmbedding.desc') });
		customDesc.createEl('div', {
			text: t('settings.connections.customEmbedding.guide'),
			cls: 'lumina-settings__desc-guide'
		});

		// 임베딩 모델 옵션 생성
		const embeddingOptions: { value: string; label: string }[] = [];
		embeddingOptions.push({
			value: 'auto',
			label: t('settings.connections.customEmbedding.auto'),
		});

		for (const p of s.providers) {
			if (!p.isVerified) continue;
			if (p.type === 'anthropic') continue;
			const isLocal = PROVIDER_CATEGORIES[p.type] === 'local' || p.type === 'custom';
			for (const model of p.availableModels) {
				if (!isLocal && !isEmbeddingModel(p.type, model)) continue;
				const label = isLocal
					? `[${PROVIDER_LABELS[p.type]}] ${model} ⚠️`
					: `[${PROVIDER_LABELS[p.type]}] ${model}`;
				embeddingOptions.push({
					value: `${p.id}::${model}`,
					label,
				});
			}
		}

		const embeddingSetting = new Setting(el)
			.setName(t('settings.connections.customEmbedding.name'))
			.setDesc(customDesc);

		const currentEmbeddingValue = s.embedding.mode === 'auto'
			? 'auto'
			: (s.embedding.providerId && s.embedding.modelId ? `${s.embedding.providerId}::${s.embedding.modelId}` : '');
		const currentEmbeddingLabel = s.embedding.mode === 'auto'
			? t('settings.connections.customEmbedding.auto')
			: (embeddingOptions.find(opt => opt.value === currentEmbeddingValue)?.label || currentEmbeddingValue || t('settings.connections.apiKey.selectModel'));

		const adjustedEmbeddingOptions = s.embedding.mode !== 'auto' && currentEmbeddingValue === ''
			? [{ value: '', label: t('settings.connections.apiKey.selectModel') }, ...embeddingOptions]
			: embeddingOptions;

		const onEmbeddingChange = async (val: string) => {
			if (val === 'auto') {
				s.embedding = { mode: 'auto', providerId: '', modelId: '' };
			} else if (val === '') {
				s.embedding = { mode: 'custom', providerId: '', modelId: '' };
			} else {
				const sepIdx = val.indexOf('::');
				const pid = val.slice(0, sepIdx);
				const mid = val.slice(sepIdx + 2);
				const provider = s.providers.find(p => p.id === pid);
				if (provider && PROVIDER_CATEGORIES[provider.type] === 'local') {
					new Notice(t('settings.connections.customEmbedding.localWarn'));
				}
				s.embedding = { mode: 'custom', providerId: pid, modelId: mid };
			}
			await tab.saveAndSync();

			if (s.ragEnabled && !Platform.isMobile) {
				tab.plugin.initEmbeddingWorker().catch(err =>
					debugLogger.logError('rag', err instanceof Error ? err : new Error(`임베딩 모델 변경 후 초기화 실패: ${err}`))
				);
			}
		};

		tab.addModelSelector(
			embeddingSetting,
			adjustedEmbeddingOptions,
			currentEmbeddingValue,
			currentEmbeddingLabel,
			async (val) => {
				await onEmbeddingChange(val);
			},
			() => s.embedding.mode === 'auto' ? 'auto' : (s.embedding.providerId && s.embedding.modelId ? `${s.embedding.providerId}::${s.embedding.modelId}` : ''),
		);

		if (Platform.isMobile) {
			tab.infoBox(el, t('settings.connections.customEmbedding.mobileWarn'), 'warning');
		}
	} else if (tab.showAdvanced && !s.ragEnabled) {
		// RAG가 꺼진 상태에서 고급 설정 활성화 시 안내 메시지 표시
		tab.infoBox(el, t('settings.connections.ragEngine.ragDisabledForEmbedding'), 'warning');
	}

	// ── 기본 채팅 모델 ────────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.connections.defaultChatModel.name'));

	const verifiedProviders = s.providers.filter(p => p.isVerified && p.availableModels.length > 0);

	const chatModelOptions: { value: string; label: string }[] = [];
	for (const p of verifiedProviders) {
		const isLocal = PROVIDER_CATEGORIES[p.type] === 'local' || p.type === 'custom';
		for (const model of p.availableModels) {
			if (!isLocal && isEmbeddingModel(p.type, model)) continue;
			chatModelOptions.push({
				value: `${p.id}::${model}`,
				label: `[${PROVIDER_LABELS[p.type]}] ${model}`,
			});
		}
	}

	if (verifiedProviders.length === 0) {
		tab.infoBox(el, t('settings.connections.defaultChatModel.noConnections'));
	} else {
		const defaultChatSetting = new Setting(el)
			.setName(t('settings.connections.defaultChatModel.sidebarDefault'))
			.setDesc(t('settings.connections.defaultChatModel.desc'));

		const currentChatValue = s.defaultProviderId && s.defaultModelId
			? `${s.defaultProviderId}::${s.defaultModelId}`
			: '';
		const currentChatLabel = currentChatValue
			? (chatModelOptions.find(opt => opt.value === currentChatValue)?.label || currentChatValue)
			: t('settings.connections.apiKey.selectModel');

		const adjustedChatModelOptions = currentChatValue === ''
			? [{ value: '', label: t('settings.connections.apiKey.selectModel') }, ...chatModelOptions]
			: chatModelOptions;

		tab.addModelSelector(
			defaultChatSetting,
			adjustedChatModelOptions,
			currentChatValue,
			currentChatLabel,
			async (val) => {
				if (val === '') {
					s.defaultProviderId = '';
					s.defaultModelId = '';
				} else {
					const [pid, mid] = val.split('::');
					s.defaultProviderId = pid;
					s.defaultModelId = mid;
				}
				await tab.saveAndSync();
			},
			() => s.defaultProviderId && s.defaultModelId ? `${s.defaultProviderId}::${s.defaultModelId}` : '',
		);
	}

	// ── 퀵 액션 전용 모델 ──────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.connections.quickActionProvider.name'));
	tab.infoBox(el, t('settings.connections.quickActionProvider.desc'), 'warning');

	const qaModelSetting = new Setting(el)
		.setName(t('settings.connections.quickActionModel.name'))
		.setDesc(t('settings.connections.quickActionModel.desc'));

	const currentQaValue = s.quickActionProviderId && s.quickActionModelId
		? `${s.quickActionProviderId}::${s.quickActionModelId}`
		: '';
	const noneSelectedLabel = t('settings.connections.quickActionModel.noneSelected');
	const currentQaLabel = currentQaValue === '' ? noneSelectedLabel : (chatModelOptions.find(opt => opt.value === currentQaValue)?.label || currentQaValue);

	const qaOptionsWithNone = [{ value: '', label: noneSelectedLabel }, ...chatModelOptions];

	tab.addModelSelector(
		qaModelSetting,
		qaOptionsWithNone,
		currentQaValue,
		currentQaLabel,
		async (val) => {
			if (val === '') {
				s.quickActionProviderId = '';
				s.quickActionModelId = '';
			} else {
				const [pid, mid] = val.split('::');
				s.quickActionProviderId = pid;
				s.quickActionModelId = mid;
				tab.warnIfReasoningModel(mid);
			}
			await tab.saveAndSync();
		},
		() => s.quickActionProviderId && s.quickActionModelId ? `${s.quickActionProviderId}::${s.quickActionModelId}` : '',
	);
}

export function renderProviderCard(tab: LuminaSettingTab, el: HTMLElement, provider: LLMProviderConfig): void {
	const category = PROVIDER_CATEGORIES[provider.type];
	const requiresBaseUrl = category === 'local' || provider.type === 'custom';
	const requiresApiKey = category !== 'local';

	const card = el.createDiv({ cls: `lumina-provider-card${provider.isVerified ? ' is-verified' : ''}` });

	const typeSetting = new Setting(card)
		.setName('Provider')
		.setDesc(provider.isVerified ? `✅ ${t('settings.connections.apiKey.connected')}` : t('settings.connections.apiKey.notConnected'))
		.addDropdown(drop => {
			for (const [val, label] of Object.entries(PROVIDER_LABELS)) {
				if (Platform.isMobile && PROVIDER_CATEGORIES[val as ProviderType] === 'local') continue;
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

				provider.isVerified = false;
				provider.availableModels = [];
				await tab.saveAndSync();
				tab.refreshDisplay();
			});
		});
	typeSetting.settingEl.addClass('lumina-provider-card__setting-type');

	if (requiresBaseUrl) {
		const urlSetting = new Setting(card)
			.setName(t('settings.connections.apiKey.endpointUrl'))
			.setDesc(t('settings.connections.apiKey.endpointPlaceholder'))
			.addText(text => {
				text
					.setPlaceholder('http://localhost:11434')
					.setValue(provider.baseUrl || '');
				text.onChange(async (val) => {
					provider.baseUrl = val;
					provider.isVerified = false;
					provider.availableModels = [];
					await tab.saveAndSync();
				});
			});
		urlSetting.settingEl.addClass('lumina-provider-card__setting-url');
	}

	if (requiresApiKey || provider.type === 'custom') {
		const credentialSetting = new Setting(card)
			.setName(t('settings.connections.apiKey.apiKey'))
			.setDesc(t('settings.connections.apiKey.hiddenDesc'))
			.addText(text => {
				text
					.setPlaceholder('sk-...')
					.setValue(provider.credential);
				text.inputEl.type = 'password';
				text.onChange(async (val) => {
					provider.credential = val;
					provider.isVerified = false;
					provider.availableModels = [];
					await tab.saveAndSync();
				});
			});
		credentialSetting.settingEl.addClass('lumina-provider-card__setting-credential');
	}

	const actionsSetting = new Setting(card)
		.addButton(btn => {
			btn.setButtonText(t('settings.connections.apiKey.testConnection')).onClick(async () => {
				btn.setButtonText(t('settings.connections.apiKey.testing')).setDisabled(true);
				const wasVerified = provider.isVerified;
				await testProvider(provider);
				await tab.saveAndSync();
				tab.refreshDisplay();
				// LLM 연결 성공 & 이전에 미연결 상태였고 & 아직 에이전트가 꺼져있으면 → 에이전트 베타 팝업
				if (provider.isVerified && !wasVerified && !tab.plugin.settings.chat.agentEnabled) {
					window.setTimeout(() => {
						new AgentBetaModal(
							tab.app,
							t('uiMessages.agentBetaActivateTitle'),
							t('uiMessages.agentBetaActivateDesc'),
							t('uiMessages.agentBetaActivateConfirm'),
							t('uiMessages.agentBetaActivateSkip'),
							async (enabled) => {
								if (!enabled) return;
								// 에이전트 활성화 + 내장 서버 자동 켜기
								tab.plugin.settings.chat.agentEnabled = true;
								if (!tab.plugin.settings.mcp.serverEnabled) {
									tab.plugin.settings.mcp.serverEnabled = true;
									if (!tab.plugin.settings.mcp.serverAuthToken) {
										tab.plugin.settings.mcp.serverAuthToken = crypto.randomUUID();
									}
									if (tab.plugin.mcpManager) {
										await tab.plugin.mcpManager.syncServers();
									}
								}
								await tab.saveAndSync();
								tab.refreshDisplay();
								new Notice(t('uiMessages.agentBetaEnabled'));
							},
						).open();
					}, 300);
				}
			});
		})
		.addExtraButton(btn => {
			btn.setIcon('trash').setTooltip(t('settings.connections.apiKey.deleteConnection')).onClick(async () => {
				tab.plugin.settings.connections.providers =
					tab.plugin.settings.connections.providers.filter(p => p.id !== provider.id);
				await tab.saveAndSync();
				tab.refreshDisplay();
			});
		});
	actionsSetting.settingEl.addClass('lumina-provider-card__setting-actions');
}

export async function testProvider(provider: LLMProviderConfig): Promise<void> {
	try {
		const p = createProvider(provider);
		const models = await p.listModels();
		if (models.length === 0) throw new Error(t('settings.connections.apiKey.noModels'));
		provider.isVerified = true;
		provider.availableModels = models;
		new Notice(`✅ ${PROVIDER_LABELS[provider.type]} ${t('settings.connections.apiKey.success')} (${models.length} ${t('settings.connections.apiKey.selectModel')})`);
	} catch (e) {
		provider.isVerified = false;
		provider.availableModels = [];
		new Notice(`❌ ${t('settings.connections.apiKey.fail')}${(e as Error).message}`);
	}
}
