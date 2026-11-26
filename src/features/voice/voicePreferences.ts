/**
 * voicePreferences.ts
 *
 * 사용자 설정(plugin.settings.voiceNote)의 기본값 머지 및 안전 저장 헬퍼.
 * 기존 사용자의 data.json을 오염시키지 않기 위해 사용자가 명시적으로 변경할 때만
 * settings.voiceNote 필드를 생성하여 저장합니다.
 */

import type LuminaPlugin from '../../main';
import type { LuminaSettings } from '../../core/settings/settings.types';
import { syncSettingsStore } from '../../core/store/settingsStore';
import type { LLMProviderConfig, ProviderType } from '../../shared/types/settings.types';
import type { VoiceNotePreferences } from '../../shared/types/voice.types';
import { isEmbeddingModel, isProviderSupportedOnCurrentPlatform } from '../../shared/utils/modelUtils';

/** Voice-to-Note 기본 설정값 (메모리 머지 전용, data.json에 자동 주입하지 않음) */
export const DEFAULT_VOICE_PREFERENCES: Required<VoiceNotePreferences> = {
	recordMode: 'post-process',
	audioStorageMode: 'vault',
	audioFolder: 'Attachments/Voice',
	defaultTemplate: 'clean',
	sttMode: 'auto',
	sttProviderId: '',
	sttModelId: '',
	llmProviderId: '',
	llmModelId: '',
	localWhisperModel: 'Xenova/whisper-tiny',
	includeRawTranscript: true,
	autoWikiLink: true,
	customVocabulary: [],
	language: 'auto',
	showRibbonIcon: true,
	mobileCaptureMode: 'auto',
};

/**
 * 현재 설정에서 Voice-to-Note 유효 설정을 복사본으로 반환합니다.
 * 원본 settings 객체는 절대 변경하지 않습니다.
 */
export function getVoicePreferences(settings: LuminaSettings): Required<VoiceNotePreferences> {
	const saved = settings.voiceNote;
	if (!saved) {
		return {
			...DEFAULT_VOICE_PREFERENCES,
			customVocabulary: [...DEFAULT_VOICE_PREFERENCES.customVocabulary],
		};
	}

	return {
		recordMode: saved.recordMode ?? DEFAULT_VOICE_PREFERENCES.recordMode,
		audioStorageMode: saved.audioStorageMode ?? DEFAULT_VOICE_PREFERENCES.audioStorageMode,
		audioFolder: saved.audioFolder?.trim() || DEFAULT_VOICE_PREFERENCES.audioFolder,
		defaultTemplate: saved.defaultTemplate ?? DEFAULT_VOICE_PREFERENCES.defaultTemplate,
		sttMode: saved.sttMode ?? DEFAULT_VOICE_PREFERENCES.sttMode,
		sttProviderId: saved.sttProviderId ?? DEFAULT_VOICE_PREFERENCES.sttProviderId,
		sttModelId: saved.sttModelId ?? DEFAULT_VOICE_PREFERENCES.sttModelId,
		llmProviderId: saved.llmProviderId ?? DEFAULT_VOICE_PREFERENCES.llmProviderId,
		llmModelId: saved.llmModelId ?? DEFAULT_VOICE_PREFERENCES.llmModelId,
		localWhisperModel: saved.localWhisperModel || DEFAULT_VOICE_PREFERENCES.localWhisperModel,
		includeRawTranscript: saved.includeRawTranscript ?? DEFAULT_VOICE_PREFERENCES.includeRawTranscript,
		autoWikiLink: saved.autoWikiLink ?? DEFAULT_VOICE_PREFERENCES.autoWikiLink,
		customVocabulary: Array.isArray(saved.customVocabulary)
			? [...saved.customVocabulary]
			: [...DEFAULT_VOICE_PREFERENCES.customVocabulary],
		language: saved.language ?? DEFAULT_VOICE_PREFERENCES.language,
		showRibbonIcon: saved.showRibbonIcon ?? DEFAULT_VOICE_PREFERENCES.showRibbonIcon,
		mobileCaptureMode: saved.mobileCaptureMode ?? DEFAULT_VOICE_PREFERENCES.mobileCaptureMode,
	};
}

/**
 * Voice-to-Note 설정 일부를 저장하고 반응형 스토어를 동기화합니다.
 */
export async function updateVoicePreferences(
	plugin: LuminaPlugin,
	patch: Partial<VoiceNotePreferences>,
): Promise<void> {
	const current = plugin.settings.voiceNote ? { ...plugin.settings.voiceNote } : {};
	const next: VoiceNotePreferences = {
		...current,
		...patch,
		...(patch.customVocabulary
			? { customVocabulary: [...patch.customVocabulary] }
			: current.customVocabulary
				? { customVocabulary: [...current.customVocabulary] }
				: {}),
	};

	plugin.settings.voiceNote = next;
	await plugin.saveSettings();
	syncSettingsStore(plugin.settings);
}

/**
 * 쉼표 또는 줄바꿈으로 구분된 고유명사 입력 문자열을 배열로 파싱합니다.
 */
export function parseCustomVocabulary(raw: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const token of raw.split(/[,\n\r]+/)) {
		const trimmed = token.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

/**
 * 고유명사 배열을 설정 텍스트 영역 표시용 문자열로 직렬화합니다.
 */
export function formatCustomVocabulary(terms: readonly string[]): string {
	return terms.join(', ');
}

/** 오디오 전사(STT) API를 지원하는 프로바이더 타입 목록 */
const STT_SUPPORTED_PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set<ProviderType>([
	'groq',
	'openai',
	'google',
	'custom',
]);

/**
 * 연결된 프로바이더 목록에서 STT를 지원하는 검증 완료 프로바이더만 필터링합니다.
 */
export function getSttCapableProviders(
	providers: readonly LLMProviderConfig[],
): LLMProviderConfig[] {
	return providers.filter((p) => {
		if (!p.isVerified) return false;
		if (!STT_SUPPORTED_PROVIDER_TYPES.has(p.type)) return false;
		if (p.type === 'custom' && !p.baseUrl?.trim()) return false;
		if (p.type !== 'custom' && !p.credential?.trim()) return false;
		return true;
	});
}

/**
 * 후처리에 사용 가능한 검증 완료 LLM 프로바이더 목록을 반환합니다.
 */
export function getVoiceEligibleLlmProviders(
	providers: readonly LLMProviderConfig[],
): LLMProviderConfig[] {
	return providers
		.filter((p) => {
			if (!p.isVerified || p.availableModels.length === 0) return false;
			if (!isProviderSupportedOnCurrentPlatform(p.type)) return false;
			return true;
		})
		.map((p) => {
			const chatModels = p.availableModels.filter((m) => !isEmbeddingModel(p.type, m));
			return {
				...p,
				availableModels: chatModels.length > 0 ? chatModels : p.availableModels,
			};
		});
}
