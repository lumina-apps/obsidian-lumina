/**
 * sttResolver.ts
 *
 * 사용자가 이미 Lumina에 연결·인증한 프로바이더 설정을 읽기 전용으로 탐색해
 * 가장 적합한 STT 엔진(연결된 API 또는 데스크톱 무료 로컬 Whisper)을 자동 선택합니다.
 */

import { App, Platform } from 'obsidian';
import { t } from '../../../shared/locales/helpers';
import type { LLMProviderConfig, ProviderType } from '../../../shared/types/settings.types';
import type { VoiceNotePreferences } from '../../../shared/types/voice.types';
import { getSttCapableProviders } from '../voicePreferences';
import { GeminiSttEngine } from './geminiSttEngine';
import { LocalWhisperSttEngine } from './localWhisperEngine';
import { OpenAiSttEngine } from './openaiSttEngine';
import type { ISttEngine } from './sttTypes';

export { getSttCapableProviders };

/** 자동 탐색 시 STT 프로바이더 우선순위 (속도·정확도 기준) */
const AUTO_PROVIDER_PRIORITY: readonly ProviderType[] = [
	'groq',
	'openai',
	'google',
	'custom',
];

function buildEngineFromProvider(
	config: LLMProviderConfig,
	explicitModel?: string,
): ISttEngine {
	if (config.type === 'google') {
		return new GeminiSttEngine(config, explicitModel);
	}
	return new OpenAiSttEngine(config, explicitModel);
}

/**
 * 사용자 설정과 연결 상태를 기반으로 실제 사용할 STT 엔진 인스턴스를 결정합니다.
 */
export function resolveSttEngine(
	app: App,
	providers: readonly LLMProviderConfig[],
	prefs: Required<VoiceNotePreferences>,
): ISttEngine {
	// 1. 명시적으로 로컬 Whisper를 선택한 경우
	if (prefs.sttMode === 'local-whisper') {
		if (Platform.isMobile) {
			throw new Error(t('voiceNote.notices.localWhisperMobileUnsupported'));
		}
		return new LocalWhisperSttEngine(app, prefs.localWhisperModel);
	}

	const capable = getSttCapableProviders(providers);

	// 2. 특정 연결 프로바이더를 명시적으로 지정한 경우
	if (prefs.sttMode === 'provider' && prefs.sttProviderId) {
		const target = capable.find((p) => p.id === prefs.sttProviderId);
		if (target) {
			return buildEngineFromProvider(target, prefs.sttModelId);
		}
	}

	// 3. 자동(auto) 모드: 연결된 클라우드 STT 프로바이더 우선순위 탐색
	for (const type of AUTO_PROVIDER_PRIORITY) {
		const found = capable.find((p) => p.type === type);
		if (found) {
			return buildEngineFromProvider(found, prefs.sttModelId || undefined);
		}
	}

	// 4. 클라우드 STT 가능 프로바이더가 없고 데스크톱이면 무료 로컬 Whisper로 폴백
	if (!Platform.isMobile) {
		return new LocalWhisperSttEngine(app, prefs.localWhisperModel);
	}

	throw new Error(t('voiceNote.notices.noSttAvailable'));
}
