import { App, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import type LuminaPlugin from '../../main';
import type { LLMProviderConfig, ProviderType } from '../../shared/types/settings.types';
import { PROVIDER_LABELS, PROVIDER_CATEGORIES, PROVIDER_BASE_URLS } from '../../shared/types/settings.types';
import { createProvider } from '../llm-providers/index';
import { syncSettingsStore } from '../store/settingsStore';
import { DEFAULT_SETTINGS } from './defaultSettings';
import { translatePluginLocales, loadSystemLocaleCache, deleteSystemLocaleCache } from '../../shared/locales/translator';
import { ConfirmModal, FuzzyModelSuggestModal } from '../../shared/utils/modal';
import { setLanguage, t } from '../../shared/locales/helpers';
import { get } from 'svelte/store';
import { indexingState, setIndexingStatus, resetIndexing } from '../store/ragStore';

// ─── Tab IDs ─────────────────────────────────────────────────────────────────

type TabId = 'connections' | 'chat' | 'rag' | 'mcp' | 'misc';

/**
 * 프로바이더 타입별로 임베딩 전용 모델인지 판별합니다.
 * 클라우드 프로바이더는 모델명 패턴으로 필터링.
 * 로컬/커스텀은 판별 불가 → 전체 허용 + ⚠️ 표시.
 */
function isEmbeddingModel(providerType: ProviderType, modelId: string): boolean {
	const category = PROVIDER_CATEGORIES[providerType];
	if (category === 'local' || providerType === 'custom') return true;

	switch (providerType) {
		case 'anthropic':
		case 'xai':
		case 'groq':
			return false; // 임베딩 모델 없음
		default:
			return modelId.toLowerCase().includes('embedding');
	}
}

/** 슬라이더 + 숫자 입력 콤보를 Settings에 추가하는 헬퍼 */
function addSliderWithInput(
	setting: Setting,
	opts: { min: number; max: number; step: number; value: number },
	onChange: (val: number) => void,
): void {
	const state = { val: opts.value };
	setting
		.addSlider(slider => {
			slider
				.setLimits(opts.min, opts.max, opts.step)
				.setValue(opts.value)
				.onChange(val => {
					state.val = val;
					// 숫자 인풋 동기화
					const inp = slider.sliderEl.parentElement?.querySelector<HTMLInputElement>('.lumina-slider-number');
					if (inp) inp.value = String(val);
					onChange(val);
				});
			slider.sliderEl.style.minWidth = '200px';
		})
		.addText(text => {
			text.inputEl.type = 'number';
			text.inputEl.className = 'lumina-slider-number';
			text.inputEl.min = String(opts.min);
			text.inputEl.max = String(opts.max);
			text.inputEl.step = String(opts.step);
			text.inputEl.value = String(opts.value);
			text.inputEl.style.width = '60px';
			text.inputEl.style.textAlign = 'right';
			text.onChange(raw => {
				const n = parseFloat(raw);
				if (!isNaN(n) && n >= opts.min && n <= opts.max) {
					onChange(n);
				}
			});
		});
}

// ─── SettingTab ───────────────────────────────────────────────────────────────

export class LuminaSettingTab extends PluginSettingTab {
	private plugin: LuminaPlugin;
	private activeTab: TabId = 'connections';
	private showAdvanced = false;
	private unsubscribeRagState?: () => void;

	constructor(app: App, plugin: LuminaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private getTabs(): { id: TabId; label: string; badge?: string }[] {
		return [
			{ id: 'connections', label: t('settings.connections.title') },
			{ id: 'chat', label: t('settings.chat.title') },
			{ id: 'rag', label: t('settings.rag.title') },
			{ id: 'mcp', label: t('settings.mcp.title'), badge: t('settings.mcp.experimental') },
			{ id: 'misc', label: t('settings.misc.title') },
		];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('lumina-settings');

		this.renderHeader(containerEl);
		this.renderTabNav(containerEl);

		const body = containerEl.createDiv({ cls: 'lumina-settings__body' });
		this.renderTab(body);

		this.renderDonationFooter(body);
	}

	private renderDonationFooter(el: HTMLElement): void {
		const footer = el.createDiv({ cls: 'lumina-settings__footer' });
		footer.style.marginTop = '40px';
		footer.style.paddingTop = '15px';
		footer.style.paddingBottom = '15px';
		footer.style.borderTop = '1px solid var(--background-modifier-border)';
		footer.style.textAlign = 'center';
		footer.style.fontSize = '0.85em';
		footer.style.display = 'flex';
		footer.style.justifyContent = 'center';
		footer.style.alignItems = 'center';
		footer.style.flexWrap = 'wrap';
		footer.style.gap = '20px';

		const label = footer.createSpan({ text: 'Support Lumina:' });
		label.style.color = 'var(--text-muted)';
		label.style.fontWeight = '500';
		label.style.opacity = '0.9';

		const createLink = (text: string, url: string, isAccent = false) => {
			const a = footer.createEl('a', { text });
			a.href = url;
			a.target = '_blank';
			a.style.color = isAccent ? 'var(--text-accent)' : 'var(--text-muted)';
			a.style.textDecoration = 'none';
			a.style.opacity = isAccent ? '0.9' : '0.75';
			a.style.fontWeight = isAccent ? '400' : 'normal';
			a.style.transition = 'opacity 0.2s';
			a.addEventListener('mouseenter', () => a.style.opacity = '1');
			a.addEventListener('mouseleave', () => a.style.opacity = isAccent ? '0.9' : '0.75');
		};

		createLink('💖 GitHub Sponsors', 'https://github.com/sponsors/lumina-apps');
		createLink('☕ Ko-fi', 'https://ko-fi.com/luminaapps');
		createLink('☕ Ctee', 'https://ctee.kr/place/luminaapps');

		const separator = footer.createSpan({ text: '|' });
		separator.style.color = 'var(--background-modifier-border)';
		separator.style.fontWeight = '500';

		const getLangSuffix = (): string => {
			const lang = this.plugin.settings.connections.language;
			if (lang === 'system') {
				const navLang = (window.navigator.language || 'en').toLowerCase();
				if (navLang.startsWith('zh')) {
					return navLang === 'zh-tw' || navLang === 'zh-hk' ? 'ZH_TW' : 'ZH';
				}
				return navLang.split('-')[0].toUpperCase();
			}
			return lang.toUpperCase().replace('-', '_');
		};

		const langSuffix = getLangSuffix();
		const readmeUrl = langSuffix === 'EN'
			? 'https://github.com/lumina-apps/obsidian-lumina'
			: `https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_${langSuffix}.md`;

		createLink('📖 GitHub README', readmeUrl, true);
	}

	hide(): void {
		if (this.unsubscribeRagState) {
			this.unsubscribeRagState();
			this.unsubscribeRagState = undefined;
		}
		super.hide();
	}

	/**
	 * 설정 저장 + settingsStore 동기화를 한 번에 처리하는 내부 헬퍼.
	 * 모든 onChange 핸들러에서 this.plugin.saveSettings() 대신 이 메서드 사용.
	 */
	private async saveAndSync(needsRefresh: boolean = false): Promise<void> {
		await this.plugin.saveSettings();
		syncSettingsStore(this.plugin.settings);
		if (this.plugin.mcpManager) {
			await this.plugin.mcpManager.syncServers().catch(e => debugLogger.logError('mcp', e));
		}
		// MCP 서버 토글 변경 시 UI 새로고침 (연결 완료 후 상태 반영)
		// 스크롤 위치 유지를 위해 현재 스크롤 저장 후 복원
		if (needsRefresh) {
			const scrollContainer = this.containerEl.querySelector('.lumina-settings__body') || this.containerEl;
			const scrollTop = scrollContainer.scrollTop;
			setTimeout(() => {
				this.display();
				// display() 후 스크롤 위치 복원
				requestAnimationFrame(() => {
					const newContainer = this.containerEl.querySelector('.lumina-settings__body') || this.containerEl;
					newContainer.scrollTop = scrollTop;
				});
			}, 1500);
		}
	}

	// ── Header ────────────────────────────────────────────────────────────────

	private renderHeader(el: HTMLElement): void {
		const header = el.createDiv({ cls: 'lumina-settings__header' });
		header.createEl('h2', { text: '✦ Lumina', cls: 'lumina-settings__title' });

		// 고급 설정 토글
		const toggle = header.createDiv({ cls: 'lumina-settings__advanced-toggle' });
		toggle.createEl('span', { text: t('settings.showAdvanced') });
		const btn = toggle.createEl('button', {
			cls: `lumina-toggle-btn ${this.showAdvanced ? 'is-active' : ''}`,
			text: '',
		});
		btn.addEventListener('click', () => {
			this.showAdvanced = !this.showAdvanced;
			this.display();
		});
	}

	// ── Tab Navigation ────────────────────────────────────────────────────────

	private renderTabNav(el: HTMLElement): void {
		const nav = el.createDiv({ cls: 'lumina-settings__nav' });
		for (const tab of this.getTabs()) {
			const btn = nav.createEl('button', {
				cls: `lumina-settings__nav-btn ${this.activeTab === tab.id ? 'is-active' : ''}`,
			});

			const labelSpan = btn.createSpan({ cls: 'lumina-settings__nav-label' });
			const lines = tab.label.split('\n');
			for (let i = 0; i < lines.length; i++) {
				labelSpan.appendText(lines[i]);
				if (i < lines.length - 1) {
					labelSpan.createEl('br');
				}
			}
			if (tab.badge) {
				btn.createSpan({ text: tab.badge, cls: 'lumina-settings__nav-badge' });
			}

			btn.addEventListener('click', () => {
				this.activeTab = tab.id;
				this.display();
			});
		}
	}

	// ── Tab Router ────────────────────────────────────────────────────────────

	private renderTab(el: HTMLElement): void {
		switch (this.activeTab) {
			case 'connections': return this.renderConnectionsTab(el);
			case 'chat': return this.renderChatTab(el);
			case 'rag': return this.renderRagTab(el);
			case 'mcp': return this.renderMcpTab(el);
			case 'misc': return this.renderMiscTab(el);
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// TAB 1: Connections & Models
	// ═══════════════════════════════════════════════════════════════════════════

	private renderConnectionsTab(el: HTMLElement): void {
		const s = this.plugin.settings.connections;

		// ── 언어 설정 ──────────────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.connections.language.name'));

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
					.addOption('system', `${t('settings.connections.language.option.system')} (${t('settings.connections.language.current', { lang: this.getSystemLocale() })})`)
					.setValue(s.language)
					.onChange(async (val) => {
						if (val === 'system') {
							const cacheExists = await loadSystemLocaleCache(this.app);
							if (!cacheExists) {
								if (s.providers.length === 0) {
									new Notice(t('settings.connections.language.llmRequired'));
									drop.setValue(s.language); // 롤백
									return;
								}
								// LLM 번역 및 캐시 적용 실행 (내부에서 모달로 진행 여부 확인)
								await translatePluginLocales(this.app, this.plugin.settings);
							} else {
								setLanguage('system');
							}
						} else {
							setLanguage(val); // 언어 변경 즉시 반영
						}
						s.language = val as typeof s.language;
						this.plugin.migrateQuickActions();
						await this.saveAndSync();
						this.display(); // 언어 변경에 따른 UI 리렌더링
					});
			})
			.addButton(btn => {
				btn
					.setButtonText(t('settings.connections.language.deleteCache'))
					.setTooltip(t('settings.connections.language.deleteCacheTooltip'))
					.onClick(() => {
						new ConfirmModal(
							this.app,
							t('settings.connections.language.deleteCacheTitle'),
							t('settings.connections.language.deleteCacheConfirm'),
							async () => {
								await deleteSystemLocaleCache(this.app);
							}
						).open();
					});
			});

		// ── LLM 프로바이더 ────────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.connections.apiKey.name'));

		if (Platform.isMobile) {
			this.infoBox(el, t('settings.connections.apiKey.mobileLocalWarning'), 'warning');
		}

		// 등록된 프로바이더 카드 렌더링
		for (const provider of s.providers) {
			this.renderProviderCard(el, provider);
		}

		// + 새 LLM 연결 추가 버튼
		new Setting(el)
			.addButton(btn => {
				btn
					.setButtonText(t('settings.connections.apiKey.addConnection'))
					.setCta()
					.onClick(async () => {
						const newProvider: LLMProviderConfig = {
							id: crypto.randomUUID(),
							type: 'openai',
							credential: '',
							availableModels: [],
							isVerified: false,
						};
						s.providers.push(newProvider);
						await this.saveAndSync();
						this.display();
					});
			});

		// ── RAG 엔진 (임베딩) ─────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.connections.ragEngine.name'));

		const descEl = document.createDocumentFragment();
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
			this.infoBox(
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
					await this.saveAndSync();
					if (val && !Platform.isMobile) {
						// 워커 초기화는 백그라운드에서 실행 (설정 시 UI 반복 방지)
						this.plugin.initEmbeddingWorker().catch((err: Error) =>
							debugLogger.logError('rag', err instanceof Error ? err : new Error(`RAG 초기화 실패: ${err}`))
						);
					} else if (!val) {
						// 비활성화: 워커 및 인덱서 정리
						this.plugin.embeddingWorker?.terminate();
						this.plugin.embeddingWorker = null;
						this.plugin.indexer = null;
						setIndexingStatus('idle');
					}
					this.display();
				});
				if (isMobileLocked) {
					toggle.setDisabled(true);
					// 강제 끄기 (혹시 켜져있는 상태로 동기화되었을 수 있으므로)
					if (s.ragEnabled) {
						s.ragEnabled = false;
						this.saveAndSync();
					}
				}
			});

		if (!this.showAdvanced) {
			el.createDiv({
				text: t('settings.connections.ragEngine.customGuide'),
				attr: { style: 'color: var(--text-muted); font-size: 0.85em; margin-top: 4px; margin-bottom: 12px; padding-left: 2px;' }
			});
		}

		// 고급 설정 활성화 + RAG 켜짐 → 임베딩 모델 선택 UI 표시
		if (this.showAdvanced && s.ragEnabled) {
			this.advancedLabel(el);
			const customDesc = document.createDocumentFragment();
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

			const currentEmbeddingValue = s.embedding.mode === 'auto' ? 'auto' : `${s.embedding.providerId}::${s.embedding.modelId}`;
			const currentEmbeddingLabel = embeddingOptions.find(opt => opt.value === currentEmbeddingValue)?.label || currentEmbeddingValue;

			const onEmbeddingChange = async (val: string) => {
				if (val === 'auto') {
					s.embedding = { mode: 'auto', providerId: '', modelId: '' };
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
				await this.saveAndSync();

				if (s.ragEnabled && !Platform.isMobile) {
					this.plugin.initEmbeddingWorker().catch(err =>
						debugLogger.logError('rag', err instanceof Error ? err : new Error(`임베딩 모델 변경 후 초기화 실패: ${err}`))
					);
				}
			};

			if (embeddingOptions.length >= 30) {
				embeddingSetting.addButton(btn => {
					btn.setButtonText(currentEmbeddingLabel)
						.onClick(() => {
							const dynamicCurrentEmbeddingValue = s.embedding.mode === 'auto' ? 'auto' : `${s.embedding.providerId}::${s.embedding.modelId}`;
							const defaultEmbeddingValue = dynamicCurrentEmbeddingValue !== 'auto' ? dynamicCurrentEmbeddingValue : '';
							new FuzzyModelSuggestModal(this.app, embeddingOptions, async (item) => {
								await onEmbeddingChange(item.value);
								btn.setButtonText(item.label);
							}, defaultEmbeddingValue).open();
						});
				});
			} else {
				embeddingSetting.addDropdown(drop => {
					for (const opt of embeddingOptions) {
						drop.addOption(opt.value, opt.label);
					}
					drop.setValue(currentEmbeddingValue)
						.onChange(async (val) => {
							await onEmbeddingChange(val);
						});
				});
			}

			if (Platform.isMobile) {
				this.infoBox(el, t('settings.connections.customEmbedding.mobileWarn'), 'warning');
			}
		} else if (this.showAdvanced && !s.ragEnabled) {
			// RAG가 꺼진 상태에서 고급 설정 활성화 시 안내 메시지 표시
			this.infoBox(el, t('settings.connections.ragEngine.ragDisabledForEmbedding'), 'warning');
		}

		// ── 기본 채팅 모델 ────────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.connections.defaultChatModel.name'));

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
			this.infoBox(el, t('settings.connections.defaultChatModel.noConnections'));
		} else {

			const defaultChatSetting = new Setting(el)
				.setName(t('settings.connections.defaultChatModel.sidebarDefault'))
				.setDesc(t('settings.connections.defaultChatModel.desc'));

			const currentChatValue = `${s.defaultProviderId}::${s.defaultModelId}`;
			const currentChatLabel = chatModelOptions.find(opt => opt.value === currentChatValue)?.label || currentChatValue || t('settings.connections.apiKey.selectModel');

			if (chatModelOptions.length >= 30) {
				defaultChatSetting.addButton(btn => {
					btn.setButtonText(currentChatLabel)
						.onClick(() => {
							const dynamicChatValue = `${s.defaultProviderId}::${s.defaultModelId}`;
							new FuzzyModelSuggestModal(this.app, chatModelOptions, async (item) => {
								const [pid, mid] = item.value.split('::');
								s.defaultProviderId = pid;
								s.defaultModelId = mid;
								await this.saveAndSync();
								btn.setButtonText(item.label);
							}, dynamicChatValue).open();
						});
				});
			} else {
				defaultChatSetting.addDropdown(drop => {
					for (const opt of chatModelOptions) {
						drop.addOption(opt.value, opt.label);
					}
					drop.setValue(currentChatValue)
						.onChange(async (val) => {
							const [pid, mid] = val.split('::');
							s.defaultProviderId = pid;
							s.defaultModelId = mid;
							await this.saveAndSync();
						});
				});
			}
		}

		// ── 퀵 액션 전용 모델 ──────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.connections.quickActionProvider.name'));
		this.infoBox(el, t('settings.connections.quickActionProvider.desc'), 'warning');

		const qaModelSetting = new Setting(el)
			.setName(t('settings.connections.quickActionModel.name'))
			.setDesc(t('settings.connections.quickActionModel.desc'));

		const currentQaValue = s.quickActionProviderId && s.quickActionModelId
			? `${s.quickActionProviderId}::${s.quickActionModelId}`
			: '';
		const noneSelectedLabel = t('settings.connections.quickActionModel.noneSelected');
		const currentQaLabel = currentQaValue === '' ? noneSelectedLabel : (chatModelOptions.find(opt => opt.value === currentQaValue)?.label || currentQaValue);

		const checkReasoningModel = (mid: string) => {
			const lower = mid.toLowerCase();
			if (lower.includes('r1') || lower.includes('qwq') || lower.includes('reasoning') || lower.includes('thinking')) {
				new Notice('⚠️ 경고: 추론형 모델(Reasoning Model)이 감지되었습니다! 퀵 액션은 속도가 생명이므로 이 모델을 사용하면 응답이 매우 지연되거나 무한 루프에 빠질 수 있습니다. 일반 Instruct 모델 사용을 강력히 권장합니다.', 10000);
			}
		};

		if (chatModelOptions.length >= 30) {
			qaModelSetting.addButton(btn => {
				btn.setButtonText(currentQaLabel)
					.onClick(() => {
						const optionsWithNone = [{ value: '', label: noneSelectedLabel }, ...chatModelOptions];
						const dynamicQaValue = s.quickActionProviderId && s.quickActionModelId ? `${s.quickActionProviderId}::${s.quickActionModelId}` : '';
						new FuzzyModelSuggestModal(this.app, optionsWithNone, async (item) => {
							if (item.value === '') {
								s.quickActionProviderId = '';
								s.quickActionModelId = '';
							} else {
								const [pid, mid] = item.value.split('::');
								s.quickActionProviderId = pid;
								s.quickActionModelId = mid;
								checkReasoningModel(mid);
							}
							await this.saveAndSync();
							btn.setButtonText(item.label);
						}, dynamicQaValue).open();
					});
			});
		} else {
			qaModelSetting.addDropdown(drop => {
				drop.addOption('', noneSelectedLabel);
				for (const opt of chatModelOptions) {
					drop.addOption(opt.value, opt.label);
				}
				drop.setValue(currentQaValue)
					.onChange(async (val) => {
						if (val === '') {
							s.quickActionProviderId = '';
							s.quickActionModelId = '';
						} else {
							const [pid, mid] = val.split('::');
							s.quickActionProviderId = pid;
							s.quickActionModelId = mid;
							checkReasoningModel(mid);
						}
						await this.saveAndSync();
					});
			});
		}
	}

	// ── Provider Card ─────────────────────────────────────────────────────────

	private renderProviderCard(el: HTMLElement, provider: LLMProviderConfig): void {
		const category = PROVIDER_CATEGORIES[provider.type];
		const requiresBaseUrl = category === 'local' || provider.type === 'custom';
		const requiresApiKey = category !== 'local'; // local은 API Key 불필요

		const card = el.createDiv({ cls: `lumina-provider-card${provider.isVerified ? ' is-verified' : ''}` });

		// 프로바이더 타입 선택
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

					// 기본 URL 주입 로직
					const isNewLocal = PROVIDER_CATEGORIES[provider.type] === 'local';
					if (isNewLocal && PROVIDER_BASE_URLS[provider.type]) {
						provider.baseUrl = PROVIDER_BASE_URLS[provider.type];
					} else if (provider.type !== 'custom') {
						provider.baseUrl = undefined; // 클라우드는 고정 URL이므로 제거
					}

					provider.isVerified = false;
					provider.availableModels = [];
					await this.saveAndSync();
					this.display();
				});
			});
		typeSetting.settingEl.addClass('lumina-provider-card__setting-type');

		// Base URL (로컬 및 커스텀)
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
						await this.saveAndSync();
					});
				});
			urlSetting.settingEl.addClass('lumina-provider-card__setting-url');
		}

		// API Key (클라우드, 애그리게이터, 커스텀)
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
						await this.saveAndSync();
					});
				});
			credentialSetting.settingEl.addClass('lumina-provider-card__setting-credential');
		}

		// 저장 및 테스트 버튼 + 삭제 버튼
		const actionsSetting = new Setting(card)
			.addButton(btn => {
				btn.setButtonText(t('settings.connections.apiKey.testConnection')).onClick(async () => {
					btn.setButtonText(t('settings.connections.apiKey.testing')).setDisabled(true);
					await this.testProvider(provider);
					await this.saveAndSync();
					this.display();
				});
			})
			.addExtraButton(btn => {
				btn.setIcon('trash').setTooltip(t('settings.connections.apiKey.deleteConnection')).onClick(async () => {
					this.plugin.settings.connections.providers =
						this.plugin.settings.connections.providers.filter(p => p.id !== provider.id);
					await this.saveAndSync();
					this.display();
				});
			});
		actionsSetting.settingEl.addClass('lumina-provider-card__setting-actions');
	}

	/** LLM 연결 테스트 — createProvider() 로 실제 API 호출 */
	private async testProvider(provider: LLMProviderConfig): Promise<void> {
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

	// ═══════════════════════════════════════════════════════════════════════════
	// TAB 2: Chat & Prompt
	// ═══════════════════════════════════════════════════════════════════════════

	private renderChatTab(el: HTMLElement): void {
		const s = this.plugin.settings.chat;

		// ── 시스템 프롬프트 ───────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.chat.systemPrompt.name'));

		for (const prompt of s.systemPrompts) {
			const isActive = prompt.id === s.activeSystemPromptId;
			const card = el.createEl('details', { cls: 'lumina-prompt-card' });
			if (isActive) {
				card.open = true;
			}

			// Header row
			const header = card.createEl('summary', { cls: 'lumina-prompt-card__header' });

			// Name input
			const nameInput = header.createEl('input', {
				type: 'text',
				value: prompt.name,
				cls: 'lumina-prompt-card__name'
			});
			nameInput.placeholder = t('settings.chat.systemPrompt.name');
			nameInput.addEventListener('click', (e) => e.stopPropagation());
			nameInput.addEventListener('change', async () => {
				prompt.name = nameInput.value;
				await this.saveAndSync();
			});

			// Status badge
			if (isActive) {
				header.createSpan({
					text: t('settings.chat.systemPrompt.active'),
					cls: 'lumina-prompt-card__status'
				});
			}

			// Actions
			const actions = header.createDiv({ cls: 'lumina-prompt-card__actions' });

			// Activate button
			if (!isActive) {
				const actBtn = actions.createEl('button', {
					text: t('settings.chat.systemPrompt.activate'),
					cls: 'lumina-prompt-card__btn-activate'
				});
				actBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					s.activeSystemPromptId = prompt.id;
					await this.saveAndSync();
					this.display();
				});
			}

			// Delete button
			const delBtn = actions.createEl('button', {
				text: '🗑',
				cls: 'lumina-prompt-card__btn-delete'
			});
			delBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				s.systemPrompts = s.systemPrompts.filter(p => p.id !== prompt.id);
				if (s.activeSystemPromptId === prompt.id) {
					s.activeSystemPromptId = s.systemPrompts[0]?.id ?? '';
				}
				await this.saveAndSync();
				this.display();
			});

			// Body content (Textarea)
			const body = card.createDiv({ cls: 'lumina-prompt-card__body' });
			const textarea = body.createEl('textarea', {
				cls: 'lumina-prompt-card__content'
			});
			textarea.value = prompt.content;
			textarea.rows = 3;
			textarea.placeholder = t('settings.chat.systemPrompt.desc');
			textarea.addEventListener('change', async () => {
				prompt.content = textarea.value;
				await this.saveAndSync();
			});
		}

		const addBtnContainer = el.createDiv({ cls: 'lumina-settings-add-prompt-container' });
		addBtnContainer.style.display = 'flex';
		addBtnContainer.style.justifyContent = 'center';
		addBtnContainer.style.margin = '10px 0';

		const addBtn = addBtnContainer.createEl('button', { text: t('settings.chat.systemPrompt.addPrompt') });
		addBtn.addEventListener('click', async () => {
			s.systemPrompts.push({
				id: crypto.randomUUID(),
				name: `${t('settings.chat.systemPrompt.defaultName')} ${s.systemPrompts.length + 1}`,
				content: '',
			});
			await this.saveAndSync();
			this.display();
		});

		// ── 채팅 기록 ─────────────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.chat.history.name'));

		new Setting(el)
			.setName(t('settings.chat.history.name'))
			.setDesc(t('settings.chat.history.desc'))
			.addToggle(toggle => {
				toggle.setValue(s.autoSaveHistory).onChange(async (val) => {
					s.autoSaveHistory = val;
					await this.saveAndSync();
					this.display();
				});
			});

		if (s.autoSaveHistory) {
			new Setting(el)
				.setName(t('settings.chat.history.savePath'))
				.setDesc(t('settings.chat.history.desc'))
				.addText(text => {
					text.setPlaceholder(t('settings.chat.history.pathPlaceholder'))
						.setValue(s.historyPath).onChange(async (val) => {
							s.historyPath = val;
							await this.saveAndSync();
						});
				});
		}

		// ── 입력 방식 ─────────────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.chat.sendMode.name'));

		new Setting(el)
			.setName(t('settings.chat.sendMode.name'))
			.addDropdown(drop => {
				drop
					.addOption('enter', t('settings.chat.sendMode.enter'))
					.addOption('ctrl_enter', t('settings.chat.sendMode.ctrlEnter'))
					.setValue(s.sendKey)
					.onChange(async (val) => {
						s.sendKey = val as typeof s.sendKey;
						await this.saveAndSync();
					});
			});

		// ── 퀵 액션 (단축키 프롬프트) ──────────────────────────────────────────
		this.sectionHeading(el, t('settings.chat.quickActions.name'));
		this.infoBox(el, t('settings.chat.quickActions.desc'), 'info');

		new Setting(el)
			.setName(t('settings.chat.inlineTrigger.name'))
			.setDesc(t('settings.chat.inlineTrigger.desc'))
			.addText(text => {
				text.setPlaceholder('/ai')
					.setValue(s.inlineTrigger || '/ai')
					.onChange(async (val) => {
						s.inlineTrigger = val;
						await this.saveAndSync();
					});
			});

		for (const action of s.quickActions || []) {
			const card = el.createEl('details', { cls: 'lumina-prompt-card' });

			// Header row
			const header = card.createEl('summary', { cls: 'lumina-prompt-card__header' });
			header.setText(`✨ ${action.name || t('settings.chat.quickActions.newAction')}`);
			header.style.cursor = 'pointer';
			header.style.fontWeight = 'bold';
			header.style.userSelect = 'none';

			// Body content
			const body = card.createDiv({ cls: 'lumina-prompt-card__body' });

			// Name Setting
			new Setting(body)
				.setName(t('settings.chat.quickActions.actionName'))
				.addText(text => {
					text.setValue(action.name)
						.onChange(async (val) => {
							action.name = val;
							header.setText(`✨ ${val || t('settings.chat.quickActions.newAction')}`);
							await this.saveAndSync();
							if (this.plugin.registerQuickActions) {
								this.plugin.registerQuickActions();
							}
						});
				});

			// Action Type Dropdown
			new Setting(body)
				.setName(t('settings.chat.quickActions.actionType'))
				.addDropdown(drop => {
					drop.addOption('replace', t('settings.chat.quickActions.typeReplace'))
						.addOption('append', t('settings.chat.quickActions.typeAppend'))
						.addOption('chat', t('settings.chat.quickActions.typeChat'))
						.setValue(action.actionType)
						.onChange(async (val: string) => {
							action.actionType = val as any;
							await this.saveAndSync();
						});
				});

			// Prompt Textarea
			const promptSetting = new Setting(body)
				.setName(t('settings.chat.quickActions.actionPrompt'))
				.addTextArea(text => {
					text.inputEl.addClass('lumina-prompt-card__content');
					text.inputEl.style.width = '100%';
					text.inputEl.style.minWidth = '300px';
					text.inputEl.rows = 4;
					text.setValue(action.prompt).onChange(async (val) => {
						action.prompt = val;
						await this.saveAndSync();
					});
				});

			promptSetting.settingEl.style.setProperty('display', 'flex', 'important');
			promptSetting.settingEl.style.setProperty('align-items', 'flex-start', 'important');

			promptSetting.infoEl.style.setProperty('flex', '0 0 auto', 'important');
			promptSetting.infoEl.style.setProperty('white-space', 'nowrap', 'important');
			promptSetting.infoEl.style.setProperty('margin-right', '20px', 'important');

			promptSetting.controlEl.style.setProperty('flex', '1 1 auto', 'important');
			promptSetting.controlEl.style.setProperty('width', '100%', 'important');
			promptSetting.controlEl.style.setProperty('justify-content', 'flex-end', 'important');
			promptSetting.controlEl.style.setProperty('display', 'flex', 'important');

			// Delete button
			const deleteSetting = new Setting(body)
				.addButton(btn => {
					btn.setButtonText(t('settings.chat.quickActions.deleteAction'))
						.setWarning()
						.onClick(async () => {
							s.quickActions = s.quickActions.filter(a => a.id !== action.id);
							await this.saveAndSync();
							if (this.plugin.registerQuickActions) {
								this.plugin.registerQuickActions();
							}
							this.display();
						});
				});

			// Force center alignment
			deleteSetting.settingEl.style.setProperty('justify-content', 'center', 'important');
			deleteSetting.settingEl.style.setProperty('border-bottom', 'none', 'important');
			deleteSetting.infoEl.style.setProperty('display', 'none', 'important');
			deleteSetting.controlEl.style.setProperty('width', '100%', 'important');
			deleteSetting.controlEl.style.setProperty('justify-content', 'center', 'important');
			deleteSetting.controlEl.style.setProperty('padding', '0', 'important');
		}

		const addActionBtnContainer = el.createDiv({ cls: 'lumina-settings-add-prompt-container' });
		addActionBtnContainer.style.display = 'flex';
		addActionBtnContainer.style.justifyContent = 'center';
		addActionBtnContainer.style.margin = '10px 0';

		const addActionBtn = addActionBtnContainer.createEl('button', { text: t('settings.chat.quickActions.add') });
		addActionBtn.addEventListener('click', async () => {
			if (!s.quickActions) s.quickActions = [];
			s.quickActions.push({
				id: `qa-${crypto.randomUUID()}`,
				name: t('settings.chat.quickActions.newAction'),
				prompt: '',
				actionType: 'replace',
			});
			await this.saveAndSync();
			if (this.plugin.registerQuickActions) {
				this.plugin.registerQuickActions();
			}
			this.display();
		});

		// ── 고급 ─────────────────────────────────────────────────────────────
		if (this.showAdvanced) {
			this.advancedLabel(el);

			new Setting(el)
				.setName(t('settings.chat.memoryLimit.limitType'))
				.setDesc(t('settings.chat.memoryLimit.desc'))
				.addDropdown(drop => {
					drop
						.addOption('turns', t('settings.chat.memoryLimit.turns'))
						.addOption('tokens', t('settings.chat.memoryLimit.tokens'))
						.setValue(s.useTokenLimit ? 'tokens' : 'turns')
						.onChange(async (val) => {
							s.useTokenLimit = val === 'tokens';
							await this.saveAndSync();
							this.display();
						});
				});

			if (!s.useTokenLimit) {
				addSliderWithInput(
					new Setting(el)
						.setName(t('settings.chat.memoryLimit.turnsLabel'))
						.setDesc(t('settings.chat.memoryLimit.turnsDesc')),
					{ min: 1, max: 15, step: 1, value: s.contextWindowTurns },
					async (val) => { s.contextWindowTurns = val; await this.saveAndSync(); }
				);
			} else {
				new Setting(el)
					.setName(t('settings.chat.memoryLimit.maxTokens'))
					.addText(text => {
						text.setValue(String(s.maxContextTokens)).onChange(async (val) => {
							const n = parseInt(val);
							if (!isNaN(n)) { s.maxContextTokens = n; await this.saveAndSync(); }
						});
					});
			}

			addSliderWithInput(
				new Setting(el)
					.setName(t('settings.chat.modelParams.tempLabel'))
					.setDesc(t('settings.chat.modelParams.tempDesc')),
				{ min: 0, max: 2, step: 0.1, value: s.temperature },
				async (val) => { s.temperature = val; await this.saveAndSync(); }
			);

			new Setting(el)
				.setName(t('settings.chat.modelParams.maxOutput'))
				.addText(text => {
					text.setValue(String(s.maxOutputTokens)).onChange(async (val) => {
						const n = parseInt(val);
						if (!isNaN(n)) { s.maxOutputTokens = n; await this.saveAndSync(); }
					});
				});

			new Setting(el)
				.setName(t('settings.chat.streaming.name'))
				.setDesc(t('settings.chat.streaming.desc'))
				.addToggle(toggle => {
					toggle.setValue(s.streaming).onChange(async (val) => {
						s.streaming = val;
						await this.saveAndSync();
					});
				});

			new Setting(el)
				.setName(t('settings.chat.modelParams.responseLang'))
				.setDesc(t('settings.chat.modelParams.responseLangDesc'))
				.addDropdown(drop => {
					drop
						.addOption('auto', t('settings.chat.modelParams.responseLangAuto'))
						.addOption('ko', t('settings.connections.language.option.ko'))
						.addOption('en', t('settings.connections.language.option.en'))
						.addOption('ja', t('settings.connections.language.option.ja'))
						.addOption('zh', '中文')
						.addOption('fr', 'Français')
						.addOption('de', 'Deutsch')
						.addOption('es', 'Español')
						.setValue(s.responseLanguage)
						.onChange(async (val) => {
							s.responseLanguage = val as typeof s.responseLanguage;
							await this.saveAndSync();
						});
				});
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// TAB 3: RAG & Context
	// ═══════════════════════════════════════════════════════════════════════════

	private renderRagTab(el: HTMLElement): void {
		const s = this.plugin.settings.rag;
		const ragEnabled = this.plugin.settings.connections.ragEnabled;

		// 임베딩 모델 위치 안내
		this.infoBox(
			el,
			t('settings.rag.embeddingWarning'),
			'info'
		);

		if (!ragEnabled) {
			this.infoBox(el, t('settings.rag.disabledWarning'), 'warning');
		}

		// ── 데이터 범위 ───────────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.rag.dataScope.name'));

		new Setting(el)
			.setName(t('settings.rag.dataScope.name'))
			.setDesc(t('settings.rag.dataScope.desc'))
			.addDropdown(drop => {
				drop
					.addOption('vault', t('settings.rag.dataScope.vaultWide'))
					.addOption('active-note', t('settings.rag.dataScope.activeNote'))
					.addOption('manual', t('settings.rag.dataScope.manual'))
					.setValue(s.dataScope)
					.onChange(async (val) => {
						s.dataScope = val as typeof s.dataScope;
						await this.saveAndSync();
					});
			});

		new Setting(el)
			.setName(t('settings.rag.includePaths.name'))
			.setDesc(t('settings.rag.includePaths.desc'))
			.addText(text => {
				text
					.setPlaceholder('Projects, Notes')
					.setValue(s.includedPaths.join(', '))
					.onChange(async (val) => {
						s.includedPaths = val.split(',').map(v => v.trim()).filter(Boolean);
						await this.saveAndSync();
					});
			});

		new Setting(el)
			.setName(t('settings.rag.ignorePaths.name'))
			.setDesc(t('settings.rag.ignorePaths.desc'))
			.addText(text => {
				text
					.setPlaceholder('Templates, Attachments/')
					.setValue(s.excludedPaths.join(', '))
					.onChange(async (val) => {
						s.excludedPaths = val.split(',').map(v => v.trim()).filter(Boolean);
						await this.saveAndSync();
					});
			});

		// ── 고급 ─────────────────────────────────────────────────────────────
		if (this.showAdvanced) {
			this.advancedLabel(el);

			addSliderWithInput(
				new Setting(el)
					.setName(t('settings.rag.chunking.name'))
					.setDesc(t('settings.rag.chunking.sizeDesc')),
				{ min: 100, max: 2000, step: 50, value: s.chunkSize },
				async (val) => { s.chunkSize = val; await this.saveAndSync(); },
			);

			addSliderWithInput(
				new Setting(el)
					.setName(t('settings.rag.chunking.overlapLabel'))
					.setDesc(t('settings.rag.chunking.overlapDesc')),
				{ min: 0, max: 500, step: 10, value: s.chunkOverlap },
				async (val) => { s.chunkOverlap = val; await this.saveAndSync(); },
			);

			addSliderWithInput(
				new Setting(el)
					.setName(t('settings.rag.topK.name'))
					.setDesc(t('settings.rag.topK.desc')),
				{ min: 1, max: 20, step: 1, value: s.topK },
				async (val) => { s.topK = val; await this.saveAndSync(); },
			);

			addSliderWithInput(
				new Setting(el)
					.setName(t('settings.rag.minSimilarity.name'))
					.setDesc(t('settings.rag.minSimilarity.desc')),
				{ min: 0, max: 1, step: 0.05, value: s.minSimilarity },
				async (val) => { s.minSimilarity = val; await this.saveAndSync(); },
			);

			new Setting(el)
				.setName(t('settings.rag.syncMode.name'))
				.setDesc(t('settings.rag.syncMode.desc'))
				.addDropdown(drop => {
					drop
						.addOption('watch', t('settings.rag.syncMode.watch'))
						.addOption('on-start', t('settings.rag.syncMode.startup'))
						.addOption('manual', t('settings.rag.syncMode.manual'))
						.setValue(s.syncMode)
						.onChange(async (val) => {
							s.syncMode = val as typeof s.syncMode;
							await this.saveAndSync();
						});
				});

			// ── 인덱싱 상태 표시 (실제 indexer 데이터 연결) ──────────────────
			this.sectionHeading(el, t('settings.rag.status.name'));
			const statusEl = el.createDiv({ cls: 'lumina-rag-status' });

			if (this.unsubscribeRagState) {
				this.unsubscribeRagState();
			}

			this.unsubscribeRagState = indexingState.subscribe(ragState => {
				statusEl.empty();
				const indexedCount = this.plugin.indexer?.indexedFileCount ?? 0;
				statusEl.createEl('p', {
					text: ragState.status === 'ready'
						? t('settings.rag.status.files', { count: String(indexedCount) })
						: `📄 ${t('settings.rag.status.statusLabel')}: ${ragState.status === 'indexing' ? t('settings.rag.status.indexing', { processed: String(ragState.processedFiles), total: String(ragState.totalFiles) }) : ragState.status}`,
				});
			});

			// 수동 재인덱싱 및 초기화 버튼
			const actionSetting = new Setting(el)
				.addButton(btn => {
					btn.setButtonText(t('settings.rag.reindex.button')).setCta().onClick(async () => {
						if (!this.plugin.indexer) {
							new Notice(t('settings.rag.reindex.notActivated'));
							return;
						}
						new Notice(t('settings.rag.reindex.started'), 2000);
						try {
							await this.plugin.indexer.indexVault();
							new Notice(t('settings.rag.reindex.success'), 3000);
							this.display();
						} catch (err) {
							new Notice(`${t('settings.rag.reindex.fail')}${(err as Error).message}`, 5000);
						}
					});
				})
				.addButton(btn => {
					btn.setButtonText(t('settings.rag.reset.button')).setWarning().onClick(async () => {
						if (!this.plugin.indexer) {
							new Notice(t('settings.rag.reindex.notActivated'));
							return;
						}
						if (confirm(t('settings.rag.reset.resetConfirm'))) {
							await this.plugin.indexer.resetIndex();
							new Notice(t('settings.rag.reset.resetSuccess'), 3000);
							this.display();
						}
					});
				});

			actionSetting.settingEl.style.borderTop = 'none';
			actionSetting.settingEl.style.padding = '0';
			actionSetting.settingEl.style.marginTop = '-10px'; // 좀 더 위로 붙이기
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// TAB 4: MCP (Model Context Protocol)
	// ═══════════════════════════════════════════════════════════════════════════

	private renderMcpTab(el: HTMLElement): void {
		const s = this.plugin.settings.mcp;

		// ── 에이전트 (Agent) ───────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.mcp.agentMode.name'));

		const agentCard = el.createDiv({ cls: `lumina-feature-card${this.plugin.settings.chat.agentEnabled ? ' is-active' : ''}` });

		const agentModeDesc = document.createDocumentFragment();
		t('settings.mcp.agentMode.desc').split('\n').forEach((line, i) => {
			if (i > 0) agentModeDesc.createEl('br');
			agentModeDesc.appendText(line);
		});

		new Setting(agentCard)
			.setName(t('settings.mcp.agentMode.name'))
			.setDesc(agentModeDesc)
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.chat.agentEnabled).onChange(async (val) => {
					if (val) {
						const isConfigured = this.plugin.settings.connections.providers.some(p => p.isVerified);
						if (!isConfigured) {
							new Notice(t('uiMessages.agentModeLlmRequired'));
							toggle.setValue(false);
							return;
						}

						this.plugin.settings.chat.agentEnabled = true;
						if (!this.plugin.settings.mcp.serverEnabled) {
							this.plugin.settings.mcp.serverEnabled = true;
							if (!this.plugin.settings.mcp.serverAuthToken) {
								this.plugin.settings.mcp.serverAuthToken = crypto.randomUUID();
							}
							new Notice(t('uiMessages.agentModeLocalServerStarting'));
							if (this.plugin.mcpManager) {
								await this.plugin.mcpManager.syncServers();
							}
						} else {
							new Notice(t('uiMessages.agentModeEnabled'));
						}
					} else {
						this.plugin.settings.chat.agentEnabled = false;
						new Notice(t('uiMessages.agentModeDisabled'));
					}
					await this.saveAndSync();
					this.display(); // UI 즉시 갱신
				});
			});

		new Setting(agentCard)
			.setName(t('settings.mcp.agentMode.maxSteps'))
			.setDesc(t('settings.mcp.agentMode.maxStepsDesc'))
			.addText(text => {
				text.inputEl.type = 'number';
				text.setValue((this.plugin.settings.chat.agentMaxSteps || 15).toString()).onChange(async (val) => {
					const num = parseInt(val, 10);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.chat.agentMaxSteps = num;
						await this.saveAndSync();
					}
				});
			});

		// ─── 내장 MCP 서버 호스팅 ───
		this.sectionHeading(el, t('settings.mcp.localServer.sectionTitle'));

		const serverDescEl = document.createDocumentFragment();
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
					if (!val && this.plugin.settings.chat.agentEnabled) {
						this.plugin.settings.chat.agentEnabled = false;
						new Notice(t('uiMessages.agentModeLocalServerStoppedDisabled'));
					}
					await this.saveAndSync(true);
					this.display(); // UI 즉시 갱신
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
							await this.saveAndSync();
						}
					});
				});

			const tokenSetting = new Setting(localServerCard)
				.setName(t('settings.mcp.localServer.token.name'))
				.setDesc(t('settings.mcp.localServer.token.desc'))
				.addText(text => {
					text.setValue(s.serverAuthToken).onChange(async (val) => {
						s.serverAuthToken = val;
						await this.saveAndSync();
					});
					text.inputEl.type = 'password';
				})
				.addButton(btn => {
					btn.setButtonText(t('common.copy'))
						.onClick(() => {
							navigator.clipboard.writeText(s.serverAuthToken);
							new Notice(t('uiMessages.mcpTokenCopied'));
						});
				})
				.addButton(btn => {
					btn.setButtonText(t('settings.mcp.localServer.token.regenerate'))
						.onClick(async () => {
							s.serverAuthToken = crypto.randomUUID();
							await this.saveAndSync();
							this.display();
						});
				});

			this.infoBox(localServerCard, t('settings.mcp.localServer.guide', { port: s.serverPort }), 'info');

			if (this.showAdvanced) {
				this.advancedLabel(localServerCard);

				new Setting(el)
					.setName(t('settings.mcp.localServer.maxRead.name'))
					.setDesc(t('settings.mcp.localServer.maxRead.desc'))
					.addText(text => {
						text.inputEl.type = 'number';
						text.setValue(s.serverMaxReadChars.toString()).onChange(async (val) => {
							const num = parseInt(val, 10);
							if (!isNaN(num)) {
								s.serverMaxReadChars = num;
								await this.saveAndSync();
							}
						});
					});

				new Setting(el)
					.setName(t('settings.mcp.localServer.searchSnippet.name'))
					.setDesc(t('settings.mcp.localServer.searchSnippet.desc'))
					.addText(text => {
						text.inputEl.type = 'number';
						text.setValue(s.serverSearchSnippetLength.toString()).onChange(async (val) => {
							const num = parseInt(val, 10);
							if (!isNaN(num)) {
								s.serverSearchSnippetLength = num;
								await this.saveAndSync();
							}
						});
					});

				new Setting(el)
					.setName(t('settings.mcp.localServer.searchMaxResults.name'))
					.setDesc(t('settings.mcp.localServer.searchMaxResults.desc'))
					.addText(text => {
						text.inputEl.type = 'number';
						text.setValue(s.serverSearchMaxResults.toString()).onChange(async (val) => {
							const num = parseInt(val, 10);
							if (!isNaN(num)) {
								s.serverSearchMaxResults = num;
								await this.saveAndSync();
							}
						});
					});

				new Setting(el)
					.setName(t('settings.mcp.localServer.maxAppend.name'))
					.setDesc(t('settings.mcp.localServer.maxAppend.desc'))
					.addText(text => {
						text.inputEl.type = 'number';
						text.setValue(s.serverMaxAppendChars.toString()).onChange(async (val) => {
							const num = parseInt(val, 10);
							if (!isNaN(num)) {
								s.serverMaxAppendChars = num;
								await this.saveAndSync();
							}
						});
					});
			}
		}

		// ─── 외부 MCP 서버 (클라이언트 연결) ───
		this.sectionHeading(el, t('settings.mcp.externalServer.sectionTitle'));
		this.infoBox(el, t('settings.mcp.desc'), 'info');

		// MCP 서버 카드 렌더링
		for (const server of s.servers) {
			this.renderMcpServerCard(el, server);
		}

		// + 새 MCP 서버 추가 버튼
		new Setting(el)
			.addButton(btn => {
				btn
					.setButtonText(t('settings.mcp.addServer'))
					.setCta()
					.onClick(async () => {
						const newServer: import('../../shared/types/settings.types').McpServerConfig = {
							id: crypto.randomUUID(),
							name: 'New Server',
							transport: 'stdio',
							command: 'npx',
							args: ['-y', '@modelcontextprotocol/server-everything'],
							env: {},
							enabled: false,
							status: 'disconnected',
						};
						s.servers.push(newServer);
						await this.saveAndSync();
						this.display();
					});
			});
	}

	private renderMcpServerCard(el: HTMLElement, server: import('../../shared/types/settings.types').McpServerConfig): void {
		const statusClass = server.status === 'connected' ? 'is-verified' : server.status === 'error' ? 'is-error' : '';
		const card = el.createDiv({ cls: `lumina-provider-card mcp-server-card mcp-server-card--${server.status || 'disconnected'} ${statusClass}` });
		// inline grid로 2x2 레이아웃 강제 적용
		card.style.display = 'grid';
		card.style.gridTemplateColumns = '1fr 1fr';
		card.style.gap = '4px 16px';
		card.style.alignItems = 'start';
		card.style.padding = '12px 16px 8px 16px';
		card.style.overflow = 'visible';

		// 이름
		const nameSetting = new Setting(card)
			.setName(t('settings.mcp.serverName'))
			.setDesc(t('settings.mcp.serverName'))
			.addText(text => {
				text.setValue(server.name).onChange(async (val) => {
					server.name = val;
					await this.saveAndSync();
				});
			});
		nameSetting.settingEl.addClass('mcp-server-card__name');
		nameSetting.settingEl.style.gridColumn = '1';
		nameSetting.settingEl.style.gridRow = '1';

		// 전송 방식
		const transportSetting = new Setting(card)
			.setName(t('settings.mcp.transport'))
			.setDesc(t('settings.mcp.transport'))
			.addDropdown(drop => {
				drop.addOption('stdio', 'stdio (Local Process)')
					.addOption('sse', 'SSE (Remote HTTP)')
					.setValue(server.transport)
					.onChange(async (val) => {
						server.transport = val as 'stdio' | 'sse';
						await this.saveAndSync();
						this.display(); // UI 리렌더링
					});
			});
		transportSetting.settingEl.addClass('mcp-server-card__transport');
		transportSetting.settingEl.style.gridColumn = '2';
		transportSetting.settingEl.style.gridRow = '1';

		if (server.transport === 'stdio') {
			// stdio Command
			const cmdSetting = new Setting(card)
				.setName(t('settings.mcp.externalServer.command.name'))
				.setDesc(t('settings.mcp.externalServer.command.desc'))
				.addText(text => {
					text.setValue(server.command || '').onChange(async (val) => {
						server.command = val;
						await this.saveAndSync();
					});
				});
			cmdSetting.settingEl.addClass('mcp-server-card__command');
			cmdSetting.settingEl.style.gridColumn = '1';
			cmdSetting.settingEl.style.gridRow = '2';

			// stdio Args
			const argsSetting = new Setting(card)
				.setName(t('settings.mcp.externalServer.args.name'))
				.setDesc(t('settings.mcp.externalServer.args.desc'))
				.addText(text => {
					text.setValue(server.args ? JSON.stringify(server.args) : '[]').onChange(async (val) => {
						try {
							const parsed = JSON.parse(val);
							if (Array.isArray(parsed)) {
								server.args = parsed;
								text.inputEl.style.borderColor = '';
								await this.saveAndSync();
							} else {
								text.inputEl.style.borderColor = 'red';
							}
						} catch (e) {
							text.inputEl.style.borderColor = 'red';
						}
					});
				});
			argsSetting.settingEl.addClass('mcp-server-card__args');
			argsSetting.settingEl.style.gridColumn = '2';
			argsSetting.settingEl.style.gridRow = '2';

			// stdio Env
			const envSetting = new Setting(card)
				.setName(t('settings.mcp.externalServer.env.name'))
				.setDesc(t('settings.mcp.externalServer.env.desc'))
				.addTextArea(text => {
					text.setValue(server.env ? JSON.stringify(server.env, null, 2) : '{}')
						.onChange(async (val) => {
							try {
								const parsed = JSON.parse(val);
								if (typeof parsed === 'object' && !Array.isArray(parsed)) {
									server.env = parsed;
									text.inputEl.style.borderColor = '';
									await this.saveAndSync();
								} else {
									text.inputEl.style.borderColor = 'red';
								}
							} catch (e) {
								text.inputEl.style.borderColor = 'red';
							}
						});
					text.inputEl.rows = 3;
				});
			envSetting.settingEl.addClass('mcp-server-card__env');
			envSetting.settingEl.style.gridColumn = '1 / -1';
			envSetting.settingEl.style.gridRow = '3';
		} else {
			// sse URL
			const urlSetting = new Setting(card)
				.setName(t('settings.mcp.externalServer.sseUrl.name'))
				.setDesc(t('settings.mcp.externalServer.sseUrl.desc'))
				.addText(text => {
					text.setValue(server.url || '').onChange(async (val) => {
						server.url = val;
						await this.saveAndSync();
					});
				});
			urlSetting.settingEl.addClass('mcp-server-card__url');
			urlSetting.settingEl.style.gridColumn = '1';
			urlSetting.settingEl.style.gridRow = '2';

			// sse Auth Token
			const localServerToken = this.plugin.settings.mcp.serverAuthToken;
			let tokenInput: import('obsidian').TextComponent;
			const authSetting = new Setting(card)
				.setName(t('settings.mcp.externalServer.token.name'))
				.setDesc(t('settings.mcp.externalServer.token.desc'))
				.addText(text => {
					tokenInput = text;
					text.setValue(server.authToken || '')
						.setPlaceholder('token')
						.onChange(async (val) => {
							server.authToken = val;
							await this.saveAndSync();
						});
					text.inputEl.type = 'password';
				});


			authSetting.settingEl.addClass('mcp-server-card__token');
			authSetting.settingEl.style.gridColumn = '2';
			authSetting.settingEl.style.gridRow = '2';
		}

		// 액션 (토글 + 삭제)
		const actionsSetting = new Setting(card)
			.addToggle(toggle => {
				toggle.setValue(server.enabled)
					.setTooltip(t('settings.mcp.enableDesc'))
					.onChange(async (val) => {
						server.enabled = val;
						await this.saveAndSync(true); // 연결 완료 후 UI 갱신
						// 만약 연결 실패로 인해 내부적으로 false로 강등되었다면 토글 UI를 다시 꺼준다
						if (server.enabled !== val) {
							toggle.setValue(server.enabled);
						}
						this.display(); // 상태(색상 등) 업데이트를 위해 전체 다시 렌더링
					});
			})
			.addExtraButton(btn => {
				btn.setIcon('trash').setTooltip(t('settings.mcp.deleteServer')).onClick(async () => {
					this.plugin.settings.mcp.servers = this.plugin.settings.mcp.servers.filter(s => s.id !== server.id);
					await this.saveAndSync();
					this.display();
				});
			});
		actionsSetting.settingEl.addClass('lumina-provider-card__setting-actions');
		actionsSetting.settingEl.addClass('mcp-server-card__actions');
		actionsSetting.settingEl.style.gridColumn = '1 / -1';
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// TAB 5: Misc & Extensions
	// ═══════════════════════════════════════════════════════════════════════════

	private renderMiscTab(el: HTMLElement): void {
		const s = this.plugin.settings.misc;

		// ── 일반 ─────────────────────────────────────────────────────────────
		this.sectionHeading(el, t('settings.misc.contextMenu.name'));

		new Setting(el)
			.setName(t('settings.misc.contextMenu.name'))
			.setDesc(t('settings.misc.contextMenu.desc'))
			.addToggle(toggle => {
				toggle.setValue(s.contextMenuEnabled).onChange(async (val) => {
					s.contextMenuEnabled = val;
					await this.saveAndSync();
				});
			});

		new Setting(el)
			.setName(t('settings.misc.ribbonIcon.name'))
			.setDesc(t('settings.misc.ribbonIcon.desc'))
			.addToggle(toggle => {
				toggle.setValue(s.showRibbonIcon).onChange(async (val) => {
					s.showRibbonIcon = val;
					await this.saveAndSync();
					// 재시작 없이 즉시 반영
					this.plugin.updateRibbonIcon();
				});
			});


		// ── 고급 ─────────────────────────────────────────────────────────────
		if (this.showAdvanced) {
			this.advancedLabel(el);

			new Setting(el)
				.setName(t('settings.misc.frontmatter.name'))
				.setDesc(t('settings.misc.frontmatter.desc'))
				.addToggle(toggle => {
					toggle.setValue(s.autoFrontmatter).onChange(async (val) => {
						s.autoFrontmatter = val;
						await this.saveAndSync();

						if (val) {
							this.plugin.registerFrontmatterEvents();
						} else {
							this.plugin.clearFrontmatterEvents();
						}

						this.display();
					});
				});



			new Setting(el)
				.setName(t('settings.misc.debugMode.name'))
				.setDesc(t('settings.misc.debugMode.desc'))
				.addToggle(toggle => {
					toggle.setValue(s.debugMode).onChange(async (val) => {
						s.debugMode = val;
						await this.saveAndSync();
						// 토글에 따라 DevLog 패널 자동 열기/닫기
						if (val) {
							this.plugin.activateDebugView();
						} else {
							this.plugin.closeDebugView();
						}
					});
				});

			// 버전 정보
			this.sectionHeading(el, t('settings.misc.versionInfo.name'));
			const { version } = (this.app as any).plugins.manifests['obsidian-lumina'] ?? { version: '—' };
			new Setting(el)
				.setName(`Lumina v${version}`)
				.setDesc(t('settings.misc.versionInfo.desc'))
				.addButton(btn => {
					btn.setButtonText('GitHub →').onClick(() => {
						window.open('https://github.com/lumina-apps/obsidian-lumina/releases', '_blank');
					});
				});

			// 데이터 초기화
			new Setting(el)
				.setName(t('settings.misc.factoryReset.name'))
				.setDesc(t('settings.misc.factoryReset.desc'))
				.addButton(btn => {
					btn.setButtonText(t('settings.misc.factoryReset.button')).setWarning().onClick(async () => {
						new ConfirmModal(
							this.app,
							t('settings.misc.factoryReset.confirmTitle'),
							t('settings.misc.factoryReset.confirmMsg'),
							async () => {
								// 워커 및 인덱서 정리
								if (this.plugin.embeddingWorker) {
									this.plugin.embeddingWorker.terminate();
									this.plugin.embeddingWorker = null;
								}
								this.plugin.indexer = null;

								// 인덱스 및 다운로드된 모델(storage 폴더) 삭제
								try {
									const storagePath = `${this.app.vault.configDir}/plugins/obsidian-lumina/storage`;
									if (await this.app.vault.adapter.exists(storagePath)) {
										await this.app.vault.adapter.rmdir(storagePath, true);
									}
								} catch (e) {
									debugLogger.logError('system', e instanceof Error ? e : new Error(`스토리지 삭제 실패: ${e}`));
								}

								// 언어 번역 캐시(locales 폴더) 삭제
								try {
									const localesPath = `${this.app.vault.configDir}/plugins/obsidian-lumina/locales`;
									if (await this.app.vault.adapter.exists(localesPath)) {
										await this.app.vault.adapter.rmdir(localesPath, true);
									}
								} catch (e) {
									debugLogger.logError('system', e instanceof Error ? e : new Error(`번역 캐시 삭제 실패: ${e}`));
								}

								// 설정 초기화 (빈 데이터를 저장하여 다음 로드나 loadSettings 시 isFirstRun이 true가 되도록 유도)
								await this.plugin.saveData({});
								await this.plugin.loadSettings();

								// RAG 인덱싱 상태 초기화 및 자동 재인덱싱
								resetIndexing();
								if (this.plugin.settings.connections.ragEnabled) {
									if (Platform.isMobile && this.plugin.settings.connections.embedding.mode === 'auto') {
										new Notice(t('uiMessages.noticeMobileRag'), 10000);
									} else {
										this.plugin.initEmbeddingWorker(false, true).catch(console.error);
									}
								}

								// UI 업데이트 반영
								this.plugin.updateRibbonIcon();
								this.plugin.closeDebugView();

								// 언어 설정 다시 반영 (loadSettings에서 감지된 언어로 즉시 전환)
								if (this.plugin.settings.connections.language === 'system') {
									const success = await loadSystemLocaleCache(this.app);
									if (success) {
										setLanguage('system');
									} else {
										setLanguage('en');
									}
								} else {
									setLanguage(this.plugin.settings.connections.language);
								}

								new Notice(t('settings.misc.factoryReset.success'), 3000);
								this.display();
							}
						).open();
					});
				});
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// Helpers
	// ═══════════════════════════════════════════════════════════════════════════

	private sectionHeading(el: HTMLElement, text: string): void {
		el.createEl('h3', { text, cls: 'lumina-settings__section-heading' });
	}

	private advancedLabel(el: HTMLElement): void {
		el.createEl('p', { text: `⚙️ ${t('settings.showAdvanced')}`, cls: 'lumina-settings__advanced-label' });
	}

	private infoBox(el: HTMLElement, text: string, type: 'info' | 'warning' = 'info'): void {
		const div = el.createDiv({ cls: `lumina-settings__info-box lumina-settings__info-box--${type}` });
		text.split('\n').forEach((line, i) => {
			if (i > 0) div.createEl('br');
			div.appendText(line);
		});
	}

	private getSystemLocale(): string {
		return navigator.language ?? 'Unknown';
	}
}
