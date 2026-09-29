/**
 * LuminaSettingTab — 플러그인 설정 탭
 *
 * 탭 네비게이션 + 라우팅을 담당하는 얇은 오케스트레이터.
 * 실제 렌더링은 tabs/ 디렉토리의 각 탭 렌더러에 위임하고,
 * 공통 유틸리티는 shared/utils/ 하위 모듈에서 import하여 사용합니다.
 */

import { App, PluginSettingTab, setTooltip, setIcon, type SettingDefinition } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import type LuminaPlugin from '../../main';
import { syncSettingsStore } from '../store/settingsStore';
import { t } from '../../shared/locales/helpers';
import {
	MCP_REFRESH_DELAY,
	normalizeError,
	sectionHeading,
	advancedLabel,
	infoBox,
	getSystemLocale,
	getLangSuffix,
	warnIfReasoningModel,
	addModelSelector,
} from '../../shared/utils/settingHelpers';

// Tab renderers
import { renderConnectionsTab } from './tabs/ConnectionsTab';
import { renderChatTab } from './tabs/ChatTab';
import { renderRagTab } from './tabs/RagTab';
import { renderMcpTab } from './tabs/McpTab';
import { renderMiscTab } from './tabs/MiscTab';
import { renderWebSearchTab } from './tabs/web-search/WebSearchTab';
import { renderDonationFooter } from './tabs/Footer';
import {
	expandQueryTerms,
	getActiveTranslationIndex,
	isSettingItemMatchBilingual,
} from './settingSearchUtils';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-exports (backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

export {
	wrapAsync,
	addSliderWithInput,
	isEmbeddingModel,
	addModelSelector,
	FUZZY_MODAL_THRESHOLD,
	MCP_REFRESH_DELAY,
} from '../../shared/utils/settingHelpers';
export const REASONING_MODEL_NOTICE_DURATION = 15000;

export type TabId = 'connections' | 'chat' | 'rag' | 'mcp' | 'webSearch' | 'misc';

// ═══════════════════════════════════════════════════════════════════════════════
// Class
// ═══════════════════════════════════════════════════════════════════════════════

export class LuminaSettingTab extends PluginSettingTab {
	public plugin: LuminaPlugin;
	public activeTab: TabId = 'connections';
	public showAdvanced = false;
	public searchQuery = '';
	public unsubscribeRagState?: () => void;

	constructor(app: App, plugin: LuminaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// ── Tab definition ─────────────────────────────────────────────────────

	private getTabs(): { id: TabId; label: string; badge?: string }[] {
		return [
			{ id: 'connections', label: t('settings.connections.title') },
			{ id: 'chat', label: t('settings.chat.title') },
			{ id: 'rag', label: t('settings.rag.title') },
			{ id: 'mcp', label: t('settings.mcp.title') },
			{ id: 'webSearch', label: t('settings.webSearch.title') },
			{ id: 'misc', label: t('settings.misc.title') },
		];
	}

	// ── Scroll container detection & preservation ─────────────────────────

	private getScrollContainer(): HTMLElement {
		if (this.containerEl && this.containerEl.scrollTop > 0) {
			return this.containerEl;
		}
		let parent = this.containerEl?.parentElement;
		while (parent && parent !== document.body) {
			if (parent.scrollTop > 0) {
				return parent;
			}
			parent = parent.parentElement;
		}
		let el: HTMLElement | null = this.containerEl;
		while (el && el !== document.body) {
			try {
				const style = window.getComputedStyle(el);
				if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
					return el;
				}
			} catch {
				// jsdom or detached element fallback
			}
			el = el.parentElement;
		}
		return this.containerEl;
	}

	// ── Display lifecycle ──────────────────────────────────────────────────

	/**
	 * 설정 탭 화면을 갱신합니다.
	 * @param preserveScroll - true면 현재 스크롤 위치를 유지합니다 (기본값: true).
	 *                         탭 네비게이션으로 다른 탭으로 이동할 때만 false로 설정합니다.
	 */
	refreshDisplay(preserveScroll: boolean = true): void {
		const { containerEl } = this;
		const scrollContainer = preserveScroll ? this.getScrollContainer() : null;
		const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

		containerEl.empty();
		containerEl.addClass('lumina-settings');

		this.renderSearchBar(containerEl);
		this.renderTabNav(containerEl);

		const body = containerEl.createDiv({ cls: 'lumina-settings__body' });
		if (this.searchQuery) {
			this.renderAllTabsFiltered(body);
		} else {
			this.renderTab(body);
		}

		this.renderDonationFooter(body);

		if (preserveScroll && scrollContainer && savedScrollTop > 0) {
			scrollContainer.scrollTop = savedScrollTop;
			if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
				window.requestAnimationFrame(() => {
					scrollContainer.scrollTop = savedScrollTop;
				});
			}
		} else if (!preserveScroll) {
			const activeScrollContainer = this.getScrollContainer();
			if (activeScrollContainer) {
				activeScrollContainer.scrollTop = 0;
			}
		}
	}

	display(): void {
		this.refreshDisplay();
	}

	hide(): void {
		if (this.unsubscribeRagState) {
			this.unsubscribeRagState();
			this.unsubscribeRagState = undefined;
		}
		super.hide();
	}

	// ── Search & Filter ────────────────────────────────────────────────────

	private renderSearchBar(el: HTMLElement): void {
		const searchContainer = el.createDiv({ cls: 'lumina-settings__search' });

		const searchIcon = searchContainer.createSpan({ cls: 'lumina-settings__search-icon' });
		setIcon(searchIcon, 'search');

		const input = searchContainer.createEl('input', {
			cls: 'lumina-settings__search-input',
			attr: {
				type: 'text',
				placeholder: t('settings.search.placeholder'),
				spellcheck: 'false',
				autocomplete: 'off',
			},
		});
		input.value = this.searchQuery;

		const clearBtn = searchContainer.createEl('button', {
			cls: `lumina-settings__search-clear${this.searchQuery ? '' : ' is-hidden'}`,
			attr: {
				type: 'button',
				'aria-label': t('settings.search.clear'),
			},
		});
		setIcon(clearBtn, 'x');

		let debounceTimer: number | null = null;

		const executeSearch = (rawQuery: string) => {
			const trimmed = rawQuery.trim();
			const isSearching = Boolean(trimmed);
			this.searchQuery = trimmed;

			clearBtn.classList.toggle('is-hidden', !isSearching);

			const nav = this.containerEl.querySelector<HTMLElement>('.lumina-settings__nav');
			if (nav) {
				nav.classList.toggle('lumina-settings__nav--search-active', isSearching);
			}

			const body = this.containerEl.querySelector<HTMLElement>('.lumina-settings__body');
			if (body) {
				body.empty();
				if (isSearching) {
					this.renderAllTabsFiltered(body);
				} else {
					this.renderTab(body);
				}
				this.renderDonationFooter(body);
			}
		};

		input.addEventListener('input', () => {
			if (debounceTimer !== null) {
				window.clearTimeout(debounceTimer);
			}
			debounceTimer = window.setTimeout(() => {
				executeSearch(input.value);
			}, 150);
		});

		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape' && (this.searchQuery || input.value)) {
				e.stopPropagation();
				e.preventDefault();
				input.value = '';
				if (debounceTimer !== null) {
					window.clearTimeout(debounceTimer);
					debounceTimer = null;
				}
				executeSearch('');
			}
		});

		clearBtn.addEventListener('click', () => {
			input.value = '';
			input.focus();
			if (debounceTimer !== null) {
				window.clearTimeout(debounceTimer);
				debounceTimer = null;
			}
			executeSearch('');
		});
	}

	private renderAllTabsFiltered(el: HTMLElement): void {
		const rawQuery = this.searchQuery;
		const queryTerms = expandQueryTerms(rawQuery);
		const translationMap = getActiveTranslationIndex();

		const originalShowAdvanced = this.showAdvanced;
		// Enable advanced settings so all options are searchable
		this.showAdvanced = true;

		const tabDefs: { id: TabId; label: string; render: (tab: LuminaSettingTab, targetEl: HTMLElement) => void }[] = [
			{ id: 'connections', label: t('settings.connections.title'), render: renderConnectionsTab },
			{ id: 'chat', label: t('settings.chat.title'), render: renderChatTab },
			{ id: 'rag', label: t('settings.rag.title'), render: (tab, targetEl) => { renderRagTab(tab, targetEl); } },
			{ id: 'mcp', label: t('settings.mcp.title'), render: renderMcpTab },
			{ id: 'webSearch', label: t('settings.webSearch.title'), render: renderWebSearchTab },
			{ id: 'misc', label: t('settings.misc.title'), render: renderMiscTab },
		];

		let hasAnyMatches = false;

		for (const tabDef of tabDefs) {
			const tabSection = el.createDiv({ cls: 'lumina-settings__search-section' });

			tabSection.createDiv({
				cls: 'lumina-settings__search-tab-header',
				text: tabDef.label.replace(/\n/g, ' '),
			});

			const tabContent = tabSection.createDiv({ cls: 'lumina-settings__search-tab-content' });
			try {
				tabDef.render(this, tabContent);
			} catch (err: unknown) {
				debugLogger.logError('settings', err instanceof Error ? err : new Error(String(err)));
			}

			// Hide info boxes and advanced labels in search view
			tabContent.querySelectorAll<HTMLElement>('.lumina-settings__info-box, .lumina-settings__advanced-label')
				.forEach(item => { item.style.display = 'none'; });

			// Filter settings by section & item
			let tabMatchCount = 0;
			const allSettingItems = Array.from(tabContent.querySelectorAll<HTMLElement>('.setting-item'));

			interface SectionGroup {
				heading: HTMLElement | null;
				items: HTMLElement[];
			}
			const groups: SectionGroup[] = [];
			let currentGroup: SectionGroup = { heading: null, items: [] };
			groups.push(currentGroup);

			for (const item of allSettingItems) {
				const isHeading = item.classList.contains('setting-item-heading') ||
					item.classList.contains('lumina-settings__section-heading') ||
					Boolean(item.querySelector('.setting-item-heading'));
				if (isHeading) {
					currentGroup = { heading: item, items: [] };
					groups.push(currentGroup);
				} else {
					currentGroup.items.push(item);
				}
			}

			for (const group of groups) {
				let groupMatchCount = 0;
				for (const item of group.items) {
					if (this.isSettingItemMatch(item, queryTerms, translationMap)) {
						item.style.display = '';
						groupMatchCount++;
						tabMatchCount++;
					} else {
						item.style.display = 'none';
					}
				}

				if (group.heading) {
					const headingText = (group.heading.textContent ?? '').toLowerCase().trim();
					const enHeading = translationMap.get(headingText) ?? '';
					const headingMatches = queryTerms.some(term =>
						headingText.includes(term) || (enHeading && enHeading.includes(term))
					);

					if (groupMatchCount > 0 || headingMatches) {
						group.heading.style.display = '';
						if (headingMatches && groupMatchCount === 0) {
							// If the heading itself matched, reveal its items
							for (const item of group.items) {
								item.style.display = '';
								tabMatchCount++;
							}
						}
					} else {
						group.heading.style.display = 'none';
					}
				}
			}

			// Filter cards (e.g. ProviderCard, FeatureCard, PromptCard)
			const cards = tabContent.querySelectorAll<HTMLElement>(
				'.lumina-provider-card, .lumina-feature-card, .lumina-prompt-card'
			);
			for (const card of Array.from(cards)) {
				const cardItems = Array.from(card.querySelectorAll<HTMLElement>('.setting-item'));
				const hasVisibleItem = cardItems.length === 0 || cardItems.some(i => i.style.display !== 'none');
				card.style.display = hasVisibleItem ? '' : 'none';
			}

			if (tabMatchCount === 0) {
				tabSection.style.display = 'none';
			} else {
				tabSection.style.display = '';
				hasAnyMatches = true;
			}
		}

		this.showAdvanced = originalShowAdvanced;

		if (!hasAnyMatches) {
			const emptyEl = el.createDiv({ cls: 'lumina-settings__search-empty' });
			emptyEl.setText(t('settings.search.noResults', { query: this.searchQuery }));
		}
	}

	private isSettingItemMatch(
		item: HTMLElement,
		queryTerms: string[],
		translationMap: Map<string, string>
	): boolean {
		const name = item.querySelector('.setting-item-name')?.textContent ?? '';
		const desc = item.querySelector('.setting-item-description')?.textContent ?? '';

		const inputs = Array.from(item.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'));
		const inputValues = inputs.map(i => i.value).join(' ');

		return isSettingItemMatchBilingual(
			name,
			desc,
			`${inputValues} ${item.textContent ?? ''}`,
			queryTerms,
			translationMap
		);
	}

	// ── Settings persistence ───────────────────────────────────────────────

	/**
	 * 설정 저장 + settingsStore 동기화를 한 번에 처리합니다.
	 * @param needsRefresh - true면 MCP_REFRESH_DELAY 후 UI 전체 새로고침 (스크롤 위치 복원 포함)
	 * @param syncMcp - true면 mcpManager.syncServers() 호출.
	 *                  텍스트 입력 onChange처럼 포커스를 유지해야 하는 경우에는
	 *                  반드시 false(기본값)로 유지할 것.
	 */
	public async saveAndSync(needsRefresh: boolean = false, syncMcp: boolean = false): Promise<void> {
		await this.plugin.saveSettings();
		syncSettingsStore(this.plugin.settings);
		if (syncMcp && this.plugin.mcpManager) {
			await this.plugin.mcpManager.syncServers().catch((e: unknown) =>
				debugLogger.logError('mcp', normalizeError(e, String(e)))
			);
		}
		if (needsRefresh) {
			window.setTimeout(() => {
				this.refreshDisplay(true);
			}, MCP_REFRESH_DELAY);
		}
	}

	// ── Navigation ─────────────────────────────────────────────────────────

	private renderTabNav(el: HTMLElement): void {
		const nav = el.createDiv({
			cls: `lumina-settings__nav${this.searchQuery ? ' lumina-settings__nav--search-active' : ''}`,
		});
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
				this.refreshDisplay(false);
			});
		}

		nav.createDiv({ cls: 'lumina-settings__nav-separator' });

		const advBtn = nav.createEl('button', {
			cls: `lumina-settings__nav-btn lumina-settings__nav-btn--advanced ${this.showAdvanced ? 'is-active' : ''}`,
		});
		setTooltip(advBtn, t('settings.showAdvanced'), { delay: 0 });

		const advLabelSpan = advBtn.createSpan({ cls: 'lumina-settings__nav-label' });
		advLabelSpan.createSpan({ text: '⚙️', cls: 'lumina-settings__nav-icon' });
		advLabelSpan.createSpan({ text: t('settings.showAdvanced'), cls: 'lumina-settings__nav-text' });

		advBtn.addEventListener('click', () => {
			this.showAdvanced = !this.showAdvanced;
			this.refreshDisplay(true);
		});
	}

	// ── Tab router ─────────────────────────────────────────────────────────

	private renderTab(el: HTMLElement): void {
		switch (this.activeTab) {
			case 'connections': return renderConnectionsTab(this, el);
			case 'chat': return renderChatTab(this, el);
			case 'rag': void renderRagTab(this, el); break;
			case 'mcp': return renderMcpTab(this, el);
			case 'webSearch': return renderWebSearchTab(this, el);
			case 'misc': return renderMiscTab(this, el);
		}
	}

	// ── Footer ─────────────────────────────────────────────────────────────

	private renderDonationFooter(el: HTMLElement): void {
		const langSuffix = this.getLangSuffix();
		renderDonationFooter(el, langSuffix);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// Public helpers (delegation wrappers — backward compatible)
	// ═══════════════════════════════════════════════════════════════════════════

	public sectionHeading(el: HTMLElement, text: string): void {
		sectionHeading(el, text);
	}

	public advancedLabel(el: HTMLElement): void {
		advancedLabel(el);
	}

	public infoBox(el: HTMLElement, text: string, type: 'info' | 'warning' = 'info'): void {
		infoBox(el, text, type);
	}

	public getSystemLocale(): string {
		return getSystemLocale();
	}

	public getLangSuffix(): string {
		return getLangSuffix(this.plugin.settings.connections.language);
	}

	public warnIfReasoningModel(modelId: string): void {
		warnIfReasoningModel(modelId);
	}

	public addModelSelector(
		setting: import('obsidian').Setting,
		options: { value: string; label: string }[],
		currentValue: string,
		currentLabel: string,
		onChange: (val: string) => Promise<void>,
		getDynamicValue: () => string,
	): void {
		addModelSelector(setting, options, currentValue, currentLabel, onChange, getDynamicValue, this.app);
	}

	// Declarative settings API support (required for Obsidian 1.13.0+ settings search)
	getSettingDefinitions(): SettingDefinition[] {
		return [];
	}
}
