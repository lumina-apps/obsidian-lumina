/**
 * VoiceSettingsSection.ts
 *
 * Pro 권한('voice-note')이 활성화된 경우에만 Misc 설정 탭에 렌더링되는
 * Voice-to-Note 설정 섹션입니다. 미인증 시 DOM 자체를 생성하지 않아 설정 검색에서도 숨겨집니다.
 */

import { Platform, Setting } from 'obsidian';
import {
	formatCustomVocabulary,
	getSttCapableProviders,
	getVoiceEligibleLlmProviders,
	getVoicePreferences,
	parseCustomVocabulary,
	updateVoicePreferences,
} from '../../../../features/voice/voicePreferences';
import { t } from '../../../../shared/locales/helpers';
import { PROVIDER_LABELS } from '../../../../shared/types/settings.types';
import type {
	VoiceAudioStorageMode,
	VoiceMobileCaptureMode,
	VoiceRecordMode,
	VoiceSttEngineMode,
	VoiceTemplateId,
} from '../../../../shared/types/voice.types';
import { parseProviderModelValue, toProviderModelValue } from '../../../../shared/utils/modelUtils';
import { notifyProFeatureLocked } from '../../../../shared/utils/proUpgradeModal';
import { canUseFeature, canUseProFeature } from '../../../store/entitlementStore';
import type { LuminaSettingTab } from '../../settingTab';

function appendProBadge(setting: Setting): void {
	setting.nameEl.createSpan({ text: 'PRO', cls: 'lumina-pro-badge-inline' });
}

/**
 * Voice-to-Note 설정 섹션을 컨테이너에 렌더링합니다.
 * 권한이 비활성 상태면 아무 DOM도 생성하지 않고 즉시 반환합니다.
 */
export function renderVoiceSettingsSection(tab: LuminaSettingTab, el: HTMLElement): void {
	if (!canUseFeature('voice-note')) return;

	const isPro = canUseProFeature('voice-note');
	const prefs = getVoicePreferences(tab.plugin.settings);

	tab.sectionHeading(el, t('voiceNote.settings.heading'));

	// 0. 좌측 리본 마이크 아이콘 표시 여부
	new Setting(el)
		.setName(`${t('settings.misc.ribbonIcon.name')} (${t('voiceNote.recorder.title')})`)
		.setDesc(t('voiceNote.cmdToggleRecord'))
		.addToggle((toggle) => {
			toggle.setValue(prefs.showRibbonIcon).onChange(async (val) => {
				await updateVoicePreferences(tab.plugin, { showRibbonIcon: val });
				tab.plugin.updateRibbonIcon?.();
			});
		});

	// 1. 녹음 및 반영 방식
	new Setting(el)
		.setName(t('voiceNote.settings.recordMode.name'))
		.setDesc(t('voiceNote.settings.recordMode.desc'))
		.addDropdown((dd) => {
			dd.addOption('post-process', t('voiceNote.settings.recordMode.postProcess'));
			dd.addOption('live-insert', t('voiceNote.settings.recordMode.liveInsert'));
			dd.setValue(prefs.recordMode).onChange(async (val) => {
				await updateVoicePreferences(tab.plugin, { recordMode: val as VoiceRecordMode });
			});
		});

	// 2. 기본 출력 템플릿
	const templateSetting = new Setting(el)
		.setName(t('voiceNote.settings.defaultTemplate.name'))
		.setDesc(t('voiceNote.settings.defaultTemplate.desc'))
		.addDropdown((dd) => {
			dd.addOption('verbatim', t('voiceNote.settings.defaultTemplate.verbatim'));
			dd.addOption(
				'clean',
				`${t('voiceNote.settings.defaultTemplate.clean')}${!isPro ? ' 🔒 PRO' : ''}`,
			);
			dd.addOption(
				'meeting',
				`${t('voiceNote.settings.defaultTemplate.meeting')}${!isPro ? ' 🔒 PRO' : ''}`,
			);
			dd.setValue(isPro ? prefs.defaultTemplate : 'verbatim').onChange(async (val) => {
				if (!isPro && val !== 'verbatim') {
					dd.setValue('verbatim');
					notifyProFeatureLocked(tab.app, 'voice-note', t('voiceNote.proTemplateNotice'));
					return;
				}
				await updateVoicePreferences(tab.plugin, { defaultTemplate: val as VoiceTemplateId });
			});
		});
	if (!isPro) {
		appendProBadge(templateSetting);
	}

	// 3. 오디오 보관 방식
	new Setting(el)
		.setName(t('voiceNote.settings.audioStorage.name'))
		.setDesc(t('voiceNote.settings.audioStorage.desc'))
		.addDropdown((dd) => {
			dd.addOption('vault', t('voiceNote.settings.audioStorage.vault'));
			dd.addOption('discard', t('voiceNote.settings.audioStorage.discard'));
			dd.setValue(prefs.audioStorageMode).onChange(async (val) => {
				await updateVoicePreferences(tab.plugin, {
					audioStorageMode: val as VoiceAudioStorageMode,
				});
				tab.refreshDisplay(true);
			});
		});

	if (prefs.audioStorageMode === 'vault') {
		new Setting(el)
			.setName(t('voiceNote.settings.audioFolder.name'))
			.setDesc(t('voiceNote.settings.audioFolder.desc'))
			.addText((text) => {
				text
					.setPlaceholder(t('voiceNote.settings.audioFolder.placeholder'))
					.setValue(prefs.audioFolder)
					.onChange(async (val) => {
						await updateVoicePreferences(tab.plugin, {
							audioFolder: val.trim() || 'Attachments/Voice',
						});
					});
			});
	}

	// 3-1. 모바일 녹음 캡처 방식 (자동 / 항상 저장 후 데스크톱에서 변환)
	new Setting(el)
		.setName(t('voiceNote.settings.mobileCaptureMode.name'))
		.setDesc(t('voiceNote.settings.mobileCaptureMode.desc'))
		.addDropdown((dd) => {
			dd.addOption('auto', t('voiceNote.settings.mobileCaptureMode.auto'));
			dd.addOption('defer-to-desktop', t('voiceNote.settings.mobileCaptureMode.deferToDesktop'));
			dd.setValue(prefs.mobileCaptureMode).onChange(async (val) => {
				await updateVoicePreferences(tab.plugin, {
					mobileCaptureMode: val as VoiceMobileCaptureMode,
				});
			});
		});

	// 4. STT 엔진 모드
	new Setting(el)
		.setName(t('voiceNote.settings.sttMode.name'))
		.setDesc(t('voiceNote.settings.sttMode.desc'))
		.addDropdown((dd) => {
			dd.addOption('auto', t('voiceNote.settings.sttMode.auto'));
			dd.addOption('provider', t('voiceNote.settings.sttMode.provider'));
			if (!Platform.isMobile || prefs.sttMode === 'local-whisper') {
				const label = Platform.isMobile
					? `${t('voiceNote.settings.sttMode.localWhisper')} (Desktop)`
					: t('voiceNote.settings.sttMode.localWhisper');
				dd.addOption('local-whisper', label);
			}
			dd.setValue(prefs.sttMode).onChange(async (val) => {
				await updateVoicePreferences(tab.plugin, { sttMode: val as VoiceSttEngineMode });
				tab.refreshDisplay(true);
			});
		});

	if (Platform.isMobile && prefs.sttMode === 'local-whisper') {
		tab.infoBox(el, t('voiceNote.deferred.localWhisperMobileInfo'), 'warning');
	}

	if (prefs.sttMode === 'provider') {
		const capableProviders = getSttCapableProviders(tab.plugin.settings.connections.providers);
		new Setting(el)
			.setName(t('voiceNote.settings.sttProvider.name'))
			.setDesc(t('voiceNote.settings.sttProvider.desc'))
			.addDropdown((dd) => {
				if (capableProviders.length === 0) {
					dd.addOption('', t('voiceNote.settings.sttProvider.noneAvailable'));
					dd.setValue('');
					dd.setDisabled(true);
				} else {
					for (const prov of capableProviders) {
						dd.addOption(prov.id, `${PROVIDER_LABELS[prov.type] ?? prov.type}`);
					}
					const validVal = capableProviders.some((p) => p.id === prefs.sttProviderId)
						? prefs.sttProviderId
						: capableProviders[0].id;
					dd.setValue(validVal).onChange(async (val) => {
						await updateVoicePreferences(tab.plugin, { sttProviderId: val });
					});
				}
			});
	}

	const hasCloudStt = getSttCapableProviders(tab.plugin.settings.connections.providers).length > 0;
	if (
		!Platform.isMobile &&
		(prefs.sttMode === 'local-whisper' || (prefs.sttMode === 'auto' && !hasCloudStt))
	) {
		tab.infoBox(el, t('voiceNote.settings.localWhisperNotice'), 'info');
	}

	// 5. 음성 언어 힌트 (STT 엔진 바로 아래에 배치)
	new Setting(el)
		.setName(t('voiceNote.settings.language.name'))
		.setDesc(t('voiceNote.settings.language.desc'))
		.addText((text) => {
			text
				.setPlaceholder(t('voiceNote.settings.language.auto'))
				.setValue(prefs.language === 'auto' ? '' : prefs.language)
				.onChange(async (val) => {
					await updateVoicePreferences(tab.plugin, {
						language: val.trim() || 'auto',
					});
				});
		});

	// 6. 노트 정리용 LLM 모델 (사용자 연결 프로바이더만 재사용)
	const llmEligible = getVoiceEligibleLlmProviders(tab.plugin.settings.connections.providers);
	const llmSetting = new Setting(el)
		.setName(t('voiceNote.settings.llmModel.name'))
		.setDesc(t('voiceNote.settings.llmModel.desc'))
		.addDropdown((dd) => {
			dd.addOption('', t('voiceNote.settings.llmModel.autoOption'));
			for (const prov of llmEligible) {
				for (const model of prov.availableModels) {
					dd.addOption(
						toProviderModelValue(prov.id, model),
						`[${PROVIDER_LABELS[prov.type] ?? prov.type}] ${model}${!isPro ? ' 🔒 PRO' : ''}`,
					);
				}
			}
			const curVal =
				isPro && prefs.llmProviderId && prefs.llmModelId
					? toProviderModelValue(prefs.llmProviderId, prefs.llmModelId)
					: '';
			dd.setValue(curVal).onChange(async (val) => {
				if (!isPro) {
					dd.setValue('');
					notifyProFeatureLocked(tab.app, 'voice-note', t('voiceNote.proSettingNotice'));
					return;
				}
				if (!val) {
					await updateVoicePreferences(tab.plugin, { llmProviderId: '', llmModelId: '' });
					return;
				}
				const parsed = parseProviderModelValue(val);
				if (parsed) {
					await updateVoicePreferences(tab.plugin, {
						llmProviderId: parsed.providerId,
						llmModelId: parsed.modelId,
					});
				}
			});
		});
	if (!isPro) {
		appendProBadge(llmSetting);
	}

	// 7. 자동 위키링크([[...]])
	const wikiLinkSetting = new Setting(el)
		.setName(t('voiceNote.settings.autoWikiLink.name'))
		.setDesc(t('voiceNote.settings.autoWikiLink.desc'))
		.addToggle((toggle) => {
			toggle.setValue(isPro ? prefs.autoWikiLink : false).onChange(async (val) => {
				if (!isPro) {
					toggle.setValue(false);
					notifyProFeatureLocked(tab.app, 'voice-note', t('voiceNote.proSettingNotice'));
					return;
				}
				await updateVoicePreferences(tab.plugin, { autoWikiLink: val });
			});
		});
	if (!isPro) {
		appendProBadge(wikiLinkSetting);
	}

	// 8. 원본 스크립트 접기 콜아웃 포함
	new Setting(el)
		.setName(t('voiceNote.settings.includeRawTranscript.name'))
		.setDesc(t('voiceNote.settings.includeRawTranscript.desc'))
		.addToggle((toggle) => {
			toggle.setValue(prefs.includeRawTranscript).onChange(async (val) => {
				await updateVoicePreferences(tab.plugin, { includeRawTranscript: val });
			});
		});

	// 9. 고유명사 / 전문용어 사전
	const vocabSetting = new Setting(el)
		.setName(t('voiceNote.settings.customVocabulary.name'))
		.setDesc(t('voiceNote.settings.customVocabulary.desc'))
		.addTextArea((text) => {
			text
				.setPlaceholder(t('voiceNote.settings.customVocabulary.placeholder'))
				.setValue(isPro ? formatCustomVocabulary(prefs.customVocabulary) : '')
				.onChange(async (val) => {
					if (!isPro) {
						text.setValue('');
						notifyProFeatureLocked(tab.app, 'voice-note', t('voiceNote.proSettingNotice'));
						return;
					}
					await updateVoicePreferences(tab.plugin, {
						customVocabulary: parseCustomVocabulary(val),
					});
				});
			if (!isPro) {
				text.inputEl.readOnly = true;
				text.inputEl.classList.add('is-locked');
				// 모바일에서 잠긴 입력창을 탭했을 때 가상 키보드가 올라오지 않도록 즉시 포커스를 해제한다
				text.inputEl.addEventListener('focus', () => {
					text.inputEl.blur();
				});
				text.inputEl.addEventListener('click', () => {
					notifyProFeatureLocked(tab.app, 'voice-note', t('voiceNote.proSettingNotice'));
				});
			}
		});
	if (!isPro) {
		appendProBadge(vocabSetting);
	}
}
