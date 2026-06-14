import { App, Notice, PluginSettingTab, Setting, setTooltip } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import type LuminaPlugin from '../../main';
import type { ProviderType } from '../../shared/types/settings.types';
import { PROVIDER_CATEGORIES } from '../../shared/types/settings.types';
import { syncSettingsStore } from '../store/settingsStore';
import { FuzzyModelSuggestModal } from '../../shared/utils/modal';
import { t } from '../../shared/locales/helpers';

// Tab renderers
import { renderConnectionsTab } from './tabs/ConnectionsTab';
import { renderChatTab } from './tabs/ChatTab';
import { renderRagTab } from './tabs/RagTab';
import { renderMcpTab } from './tabs/McpTab';
import { renderMiscTab } from './tabs/MiscTab';

// ─── Constants ────────────────────────────────────────────────────────────────

/** FuzzyModelSuggestModal로 전환할 옵션 개수 임계값 */
const FUZZY_MODAL_THRESHOLD = 30;
/** MCP 서버 토글 후 UI 리프레시 대기 시간 (ms) */
const MCP_REFRESH_DELAY = 1500;
/** 추론형 모델 경고 Notice 표시 시간 (ms) */
const REASONING_MODEL_NOTICE_DURATION = 10000;

export function wrapAsync<T extends unknown[]>(fn: (...args: T) => Promise<unknown>): (...args: T) => void {
	return (...args) => {
		void fn(...args);
	};
}

export type TabId = 'connections' | 'chat' | 'rag' | 'mcp' | 'misc';

/**
 * 프로바이더 타입별로 임베딩 전용 모델인지 판별합니다.
 * 클라우드 프로바이더는 모델명 패턴으로 필터링.
 * 로컬/커스텀은 판별 불가 → 전체 허용 + ⚠️ 표시.
 */
export function isEmbeddingModel(providerType: ProviderType, modelId: string): boolean {
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
export function addSliderWithInput(
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
			slider.sliderEl.setCssStyles({ minWidth: '200px' });
		})
		.addText(text => {
			text.inputEl.type = 'number';
			text.inputEl.className = 'lumina-slider-number';
			text.inputEl.min = String(opts.min);
			text.inputEl.max = String(opts.max);
			text.inputEl.step = String(opts.step);
			text.inputEl.value = String(opts.value);
			text.inputEl.setCssStyles({ width: '60px', textAlign: 'right' });
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
	public plugin: LuminaPlugin;
	public activeTab: TabId = 'connections';
	public showAdvanced = false;
	public unsubscribeRagState?: () => void;

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

	refreshDisplay(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('lumina-settings');

		this.renderTabNav(containerEl);

		const body = containerEl.createDiv({ cls: 'lumina-settings__body' });
		this.renderTab(body);

		this.renderDonationFooter(body);
	}

	display(): void {
		this.refreshDisplay();
	}

	private renderDonationFooter(el: HTMLElement): void {
		const footer = el.createDiv({ cls: 'lumina-settings__footer' });
		footer.setCssStyles({ marginTop: '40px', paddingTop: '15px', paddingBottom: '15px', borderTop: '1px solid var(--background-modifier-border)', textAlign: 'center', fontSize: '0.85em', display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '20px' });

		const label = footer.createSpan({ text: 'Support Lumina:' });
		label.setCssStyles({ color: 'var(--text-muted)', fontWeight: '500', opacity: '0.9' });

		const createLink = (text: string, url: string, isAccent = false) => {
			const a = footer.createEl('a', { text });
			a.href = url;
			a.target = '_blank';
			a.setCssStyles({ color: isAccent ? 'var(--text-accent)' : 'var(--text-muted)', textDecoration: 'none', opacity: isAccent ? '0.9' : '0.75', fontWeight: isAccent ? '400' : 'normal', transition: 'opacity 0.2s' });
			a.addEventListener('mouseenter', () => a.setCssStyles({ opacity: '1' }));
			a.addEventListener('mouseleave', () => a.setCssStyles({ opacity: isAccent ? '0.9' : '0.75' }));
		};

		createLink('☕ Ko-fi', 'https://ko-fi.com/luminaapps');
		createLink('☕ Ctee', 'https://ctee.kr/place/luminaapps');

		const separator = footer.createSpan({ text: '|' });
		separator.setCssStyles({ color: 'var(--background-modifier-border)', fontWeight: '500' });

		const langSuffix = this.getLangSuffix();
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
	/**
	 * 설정 저장 + settingsStore 동기화를 한 번에 처리하는 내부 헬퍼.
	 * @param needsRefresh - true면 MCP_REFRESH_DELAY 후 UI 전체 새로고침 (스크롤 위치 복원 포함)
	 * @param syncMcp - true면 mcpManager.syncServers() 호출. 텍스트 입력 onChange처럼
	 *                  포커스를 유지해야 하는 경우에는 반드시 false(기본값)로 유지할 것.
	 *                  syncServers()는 완료 시 refreshSettingTab()을 호출하여 DOM을 재생성하므로
	 *                  포커스가 사라지는 부작용이 있습니다.
	 */
	public async saveAndSync(needsRefresh: boolean = false, syncMcp: boolean = false): Promise<void> {
		await this.plugin.saveSettings();
		syncSettingsStore(this.plugin.settings);
		if (syncMcp && this.plugin.mcpManager) {
			await this.plugin.mcpManager.syncServers().catch((e: unknown) => debugLogger.logError('mcp', e instanceof Error ? e : String(e)));
		}
		// MCP 서버 토글 변경 시 UI 새로고침 (연결 완료 후 상태 반영)
		// 스크롤 위치 유지를 위해 현재 스크롤 저장 후 복원
		if (needsRefresh) {
			const scrollContainer = this.containerEl.querySelector('.lumina-settings__body') || this.containerEl;
			const scrollTop = scrollContainer.scrollTop;
			window.setTimeout(() => {
				this.refreshDisplay();
				// refreshDisplay() 후 스크롤 위치 복원
				window.requestAnimationFrame(() => {
					const newContainer = this.containerEl.querySelector('.lumina-settings__body') || this.containerEl;
					newContainer.scrollTop = scrollTop;
				});
			}, MCP_REFRESH_DELAY);
		}
	}

	// ── Header & Navigation ───────────────────────────────────────────────────

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
				this.refreshDisplay();
			});
		}

		// 2. 구분선 추가
		nav.createDiv({ cls: 'lumina-settings__nav-separator' });

		// 3. 고급 설정 토글 버튼 추가
		const advBtn = nav.createEl('button', {
			cls: `lumina-settings__nav-btn lumina-settings__nav-btn--advanced ${this.showAdvanced ? 'is-active' : ''}`,
		});
		setTooltip(advBtn, t('settings.showAdvanced'), { delay: 0 });

		const labelSpan = advBtn.createSpan({ cls: 'lumina-settings__nav-label' });
		labelSpan.createSpan({ text: '⚙️', cls: 'lumina-settings__nav-icon' });
		labelSpan.createSpan({ text: t('settings.showAdvanced'), cls: 'lumina-settings__nav-text' });

		advBtn.addEventListener('click', () => {
			this.showAdvanced = !this.showAdvanced;
			this.refreshDisplay();
		});
	}

	// ── Tab Router ────────────────────────────────────────────────────────────

	private renderTab(el: HTMLElement): void {
		switch (this.activeTab) {
			case 'connections': return renderConnectionsTab(this, el);
			case 'chat': return renderChatTab(this, el);
			case 'rag': return renderRagTab(this, el);
			case 'mcp': return renderMcpTab(this, el);
			case 'misc': return renderMiscTab(this, el);
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// Helpers
	// ═══════════════════════════════════════════════════════════════════════════

	public sectionHeading(el: HTMLElement, text: string): void {
		const headingSetting = new Setting(el).setName(text).setHeading();
		headingSetting.settingEl.addClass('lumina-settings__section-heading');
	}

	public advancedLabel(el: HTMLElement): void {
		el.createEl('p', { text: `⚙️ ${t('settings.showAdvanced')}`, cls: 'lumina-settings__advanced-label' });
	}

	public infoBox(el: HTMLElement, text: string, type: 'info' | 'warning' = 'info'): void {
		const div = el.createDiv({ cls: `lumina-settings__info-box lumina-settings__info-box--${type}` });
		text.split('\n').forEach((line, i) => {
			if (i > 0) div.createEl('br');
			div.appendText(line);
		});
	}

	public getSystemLocale(): string {
		return navigator.language ?? 'Unknown';
	}

	/** README URL에 사용할 언어 suffix를 반환합니다. */
	public getLangSuffix(): string {
		const lang = this.plugin.settings.connections.language;
		if (lang === 'system') {
			const navLang = (window.navigator.language || 'en').toLowerCase();
			if (navLang.startsWith('zh')) {
				return navLang === 'zh-tw' || navLang === 'zh-hk' ? 'ZH_TW' : 'ZH';
			}
			return navLang.split('-')[0].toUpperCase();
		}
		return lang.toUpperCase().replace('-', '_');
	}

	/** 퀵 액션 모델이 추론형인지 확인 후 경고 표시 */
	public warnIfReasoningModel(modelId: string): void {
		const lower = modelId.toLowerCase();
		if (lower.includes('r1') || lower.includes('qwq') || lower.includes('reasoning') || lower.includes('thinking')) {
			new Notice('⚠️ 경고: 추론형 모델(Reasoning Model)이 감지되었습니다! 퀵 액션은 속도가 생명이므로 이 모델을 사용하면 응답이 매우 지연되거나 무한 루프에 빠질 수 있습니다. 일반 Instruct 모델 사용을 강력히 권장합니다.', REASONING_MODEL_NOTICE_DURATION);
		}
	}

	/**
	 * 모델 선택 UI를 옵션 개수에 따라 FuzzyModal 또는 Dropdown으로 자동 렌더링합니다.
	 * @param setting - 대상 Setting 인스턴스
	 * @param options - 선택 옵션 배열
	 * @param currentValue - 현재 선택된 값
	 * @param currentLabel - 현재 표시될 라벨
	 * @param onChange - 값 변경 시 호출 (value: string)
	 * @param getDynamicValue - FuzzyModal open 시점에 동적으로 현재 값을 가져오는 함수
	 */
	public addModelSelector(
		setting: Setting,
		options: { value: string; label: string }[],
		currentValue: string,
		currentLabel: string,
		onChange: (val: string) => Promise<void>,
		getDynamicValue: () => string,
	): void {
		if (options.length >= FUZZY_MODAL_THRESHOLD) {
			setting.addButton(btn => {
				btn.setButtonText(currentLabel)
					.onClick(() => {
						new FuzzyModelSuggestModal(
							this.app,
							options,
							wrapAsync(async (item) => {
								await onChange(item.value);
								btn.setButtonText(item.label);
							}),
							getDynamicValue(),
						).open();
					});
			});
		} else {
			setting.addDropdown(drop => {
				for (const opt of options) {
					drop.addOption(opt.value, opt.label);
				}
				drop.setValue(currentValue)
					.onChange(wrapAsync(async (val) => {
						await onChange(val);
					}));
			});
		}
	}
}
