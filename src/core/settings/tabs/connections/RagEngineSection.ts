/**
 * RagEngineSection.ts
 *
 * RAG 엔진(임베딩) 섹션 렌더링.
 * ConnectionsTab에서 분리.
 */

import { Notice, Platform, Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import { setIndexingStatus } from '../../../store/ragStore';
import { initEmbeddingWorker } from '../../../../features/rag/ragInitializer';
import { debugLogger } from '../../../../shared/debugLogger';
import {
	buildEmbeddingModelOptions,
	parseProviderModelValue,
	toProviderModelValue,
	normalizeError,
} from '../../../../shared/utils/settingHelpers';
import { PROVIDER_CATEGORIES } from '../../../../shared/types/settings.types';

export function renderRagEngineSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

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
					initEmbeddingWorker(tab.plugin).catch((err: unknown) =>
						debugLogger.logError('rag', normalizeError(err, `RAG 초기화 실패: ${String(err)}`))
					);
				} else if (!val) {
					// 비활성화: 워커 및 인덱서 정리
					if (tab.plugin.indexer) {
						tab.plugin.indexer.destroy();
						tab.plugin.indexer = null;
					}
					if (tab.plugin.embeddingWorker) {
						tab.plugin.embeddingWorker.terminate();
						tab.plugin.embeddingWorker = null;
					}
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
		renderEmbeddingModelSelector(tab, el);
	} else if (tab.showAdvanced && !s.ragEnabled) {
		// RAG가 꺼진 상태에서 고급 설정 활성화 시 안내 메시지 표시
		tab.infoBox(el, t('settings.connections.ragEngine.ragDisabledForEmbedding'), 'warning');
	}
}

function renderEmbeddingModelSelector(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.connections;

	tab.advancedLabel(el);
	const customDesc = activeDocument.createDocumentFragment();
	customDesc.createEl('div', { text: t('settings.connections.customEmbedding.desc') });
	customDesc.createEl('div', {
		text: t('settings.connections.customEmbedding.guide'),
		cls: 'lumina-settings__desc-guide'
	});

	// 임베딩 모델 옵션 생성
	const autoOption = { value: 'auto', label: t('settings.connections.customEmbedding.auto') };
	const providerOptions = buildEmbeddingModelOptions(s.providers);
	const embeddingOptions = [autoOption, ...providerOptions];

	const embeddingSetting = new Setting(el)
		.setName(t('settings.connections.customEmbedding.name'))
		.setDesc(customDesc);

	const currentEmbeddingValue = s.embedding.mode === 'auto'
		? 'auto'
		: (s.embedding.providerId && s.embedding.modelId ? toProviderModelValue(s.embedding.providerId, s.embedding.modelId) : '');
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
			const parsed = parseProviderModelValue(val);
			if (parsed) {
				const provider = s.providers.find(p => p.id === parsed.providerId);
				if (provider && PROVIDER_CATEGORIES[provider.type] === 'local') {
					new Notice(t('settings.connections.customEmbedding.localWarn'));
				}
				s.embedding = { mode: 'custom', providerId: parsed.providerId, modelId: parsed.modelId };
			}
		}
		await tab.saveAndSync();

		if (s.ragEnabled && !Platform.isMobile) {
			initEmbeddingWorker(tab.plugin).catch((err: unknown) =>
				debugLogger.logError('rag', normalizeError(err, `임베딩 모델 변경 후 초기화 실패: ${err}`))
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
		() => s.embedding.mode === 'auto' ? 'auto' : (s.embedding.providerId && s.embedding.modelId ? toProviderModelValue(s.embedding.providerId, s.embedding.modelId) : ''),
	);

	if (Platform.isMobile) {
		tab.infoBox(el, t('settings.connections.customEmbedding.mobileWarn'), 'warning');
	}
}