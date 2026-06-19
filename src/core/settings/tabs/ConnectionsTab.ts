/** ConnectionsTab — connections 탭 진입점. 하위 섹션 모듈에 렌더링 위임 */

import { Platform, Setting } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { wrapAsync } from '../../../shared/utils/settingHelpers';
import { t } from '../../../shared/locales/helpers';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import { renderLanguageSection } from './connections/LanguageSection';
import { renderProviderCard } from './connections/ProviderCard';
import { renderRagEngineSection } from './connections/RagEngineSection';
import { renderDefaultChatModelSection } from './connections/DefaultChatModelSection';
import { renderQuickActionModelSection } from './connections/QuickActionModelSection';
import { renderTaskModelSection } from './connections/TaskModelSection';
import { renderRerankerModelSection } from './connections/RerankerModelSection';

export function renderConnectionsTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

	// ── 언어 설정 ──────────────────────────────────────────────────────────
	renderLanguageSection(tab, el);

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
	renderRagEngineSection(tab, el);

	// ── 기본 채팅 모델 ────────────────────────────────────────────────────
	renderDefaultChatModelSection(tab, el);

	// ── 퀵 액션 전용 모델 ──────────────────────────────────────────────────
	renderQuickActionModelSection(tab, el);

	// ── Task 전용 모델 (고급 설정) ─────────────────────────────────────────────
	if (tab.showAdvanced) {
		tab.advancedLabel(el);
		renderTaskModelSection(tab, el);
		renderRerankerModelSection(tab, el);
	}
}