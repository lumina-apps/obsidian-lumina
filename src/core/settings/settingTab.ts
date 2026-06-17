/**
 * LuminaSettingTab — 플러그인 설정 탭
 *
 * 탭 네비게이션 + 라우팅을 담당하는 얇은 오케스트레이터.
 * 실제 렌더링은 tabs/ 디렉토리의 각 탭 렌더러에 위임하고,
 * 공통 유틸리티는 shared/utils/ 하위 모듈에서 import하여 사용합니다.
 */

import { App, PluginSettingTab, setTooltip } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import type LuminaPlugin from '../../main';
import { syncSettingsStore } from '../store/settingsStore';
import { t } from '../../shared/locales/helpers';
import { MCP_REFRESH_DELAY, normalizeError } from '../../shared/utils/settingHelpers';
import {
	sectionHeading,
	advancedLabel,
	infoBox,
	getSystemLocale,
	getLangSuffix,
	warnIfReasoningModel,
} from '../../shared/utils/settingsUIHelpers';
import { addModelSelector } from '../../shared/utils/settingHelpers';

// Tab renderers
import { renderConnectionsTab } from './tabs/ConnectionsTab';
import { renderChatTab } from './tabs/ChatTab';
import { renderRagTab } from './tabs/RagTab';
import { renderMcpTab } from './tabs/McpTab';
import { renderMiscTab } from './tabs/MiscTab';
import { renderDonationFooter } from './tabs/Footer';

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
	REASONING_MODEL_NOTICE_DURATION,
} from '../../shared/utils/settingHelpers';

export type TabId = 'connections' | 'chat' | 'rag' | 'mcp' | 'misc';

// ═══════════════════════════════════════════════════════════════════════════════
// Class
// ═══════════════════════════════════════════════════════════════════════════════

export class LuminaSettingTab extends PluginSettingTab {
	public plugin: LuminaPlugin;
	public activeTab: TabId = 'connections';
	public showAdvanced = false;
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
			{ id: 'mcp', label: t('settings.mcp.title'), badge: t('settings.mcp.experimental') },
			{ id: 'misc', label: t('settings.misc.title') },
		];
	}

	// ── Display lifecycle ──────────────────────────────────────────────────

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

	hide(): void {
		if (this.unsubscribeRagState) {
			this.unsubscribeRagState();
			this.unsubscribeRagState = undefined;
		}
		super.hide();
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
			const scrollContainer = this.containerEl.querySelector('.lumina-settings__body') || this.containerEl;
			const scrollTop = scrollContainer.scrollTop;
			window.setTimeout(() => {
				this.refreshDisplay();
				window.requestAnimationFrame(() => {
					const newContainer = this.containerEl.querySelector('.lumina-settings__body') || this.containerEl;
					newContainer.scrollTop = scrollTop;
				});
			}, MCP_REFRESH_DELAY);
		}
	}

	// ── Navigation ─────────────────────────────────────────────────────────

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
			this.refreshDisplay();
		});
	}

	// ── Tab router ─────────────────────────────────────────────────────────

	private renderTab(el: HTMLElement): void {
		switch (this.activeTab) {
			case 'connections': return renderConnectionsTab(this, el);
			case 'chat': return renderChatTab(this, el);
			case 'rag': return renderRagTab(this, el);
			case 'mcp': return renderMcpTab(this, el);
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
}