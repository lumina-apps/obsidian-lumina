import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import type { LuminaSettings } from '../../../core/settings/settings.types';
import type LuminaPlugin from '../../../main';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import {
	DEFAULT_VOICE_PREFERENCES,
	formatCustomVocabulary,
	getSttCapableProviders,
	getVoiceEligibleLlmProviders,
	getVoicePreferences,
	parseCustomVocabulary,
	updateVoicePreferences,
} from '../voicePreferences';

function cloneSettings(): LuminaSettings {
	return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaSettings;
}

describe('voicePreferences', () => {
	const origIsMobile = Platform.isMobile;

	beforeEach(() => {
		(Platform as { isMobile: boolean }).isMobile = false;
	});

	afterEach(() => {
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		vi.restoreAllMocks();
	});

	it('settings.voiceNote가 미정의일 때 기본값을 반환하고 원본 settings를 오염시키지 않는다', () => {
		const settings = cloneSettings();
		expect(settings.voiceNote).toBeUndefined();

		const prefs = getVoicePreferences(settings);
		expect(prefs).toEqual(DEFAULT_VOICE_PREFERENCES);
		expect(prefs.localWhisperModel).toBe('Xenova/whisper-small');
		expect(settings.voiceNote).toBeUndefined();

		// 이전 설정에 tiny/base가 저장되어 있어도 whisper-small 단일 모델로 정규화됨
		const legacySettings = cloneSettings();
		legacySettings.voiceNote = { localWhisperModel: 'Xenova/whisper-tiny' };
		expect(getVoicePreferences(legacySettings).localWhisperModel).toBe('Xenova/whisper-small');

		prefs.customVocabulary.push('Lumina');
		expect(DEFAULT_VOICE_PREFERENCES.customVocabulary).toEqual([]);
	});

	it('updateVoicePreferences는 변경 시에만 settings.voiceNote를 생성해 저장한다', async () => {
		const settings = cloneSettings();
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		const plugin = { settings, saveSettings } as unknown as LuminaPlugin;

		await updateVoicePreferences(plugin, {
			recordMode: 'live-insert',
			customVocabulary: ['Obsidian', 'Lumina'],
		});

		expect(settings.voiceNote).toEqual({
			recordMode: 'live-insert',
			customVocabulary: ['Obsidian', 'Lumina'],
		});
		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

	it('parseCustomVocabulary와 formatCustomVocabulary는 중복과 공백을 정리한다', () => {
		const parsed = parseCustomVocabulary(' Lumina, obsidian\nLUMINA , , RAG ');
		expect(parsed).toEqual(['Lumina', 'obsidian', 'RAG']);
		expect(formatCustomVocabulary(parsed)).toBe('Lumina, obsidian, RAG');
	});

	it('getSttCapableProviders는 검증된 Groq/OpenAI/Google/Custom만 필터링한다', () => {
		const providers: LLMProviderConfig[] = [
			{ id: '1', type: 'anthropic', credential: 'sk-ant', availableModels: ['claude'], isVerified: true },
			{ id: '2', type: 'openai', credential: 'sk-oai', availableModels: ['gpt-4o'], isVerified: true },
			{ id: '3', type: 'groq', credential: 'gsk', availableModels: ['llama'], isVerified: true },
			{ id: '4', type: 'google', credential: '', availableModels: ['gemini'], isVerified: true },
			{ id: '5', type: 'custom', credential: '', baseUrl: 'http://localhost:8000', availableModels: ['whisper'], isVerified: true },
			{ id: '6', type: 'openai', credential: 'sk-unverified', availableModels: ['gpt-4o'], isVerified: false },
		];

		const capable = getSttCapableProviders(providers);
		expect(capable.map((p) => p.id)).toEqual(['2', '3', '5']);
	});

	it('getVoiceEligibleLlmProviders는 임베딩 전용 모델을 제외하고 모바일에서 CLI를 제외한다', () => {
		const providers: LLMProviderConfig[] = [
			{
				id: 'oai',
				type: 'openai',
				credential: 'sk',
				availableModels: ['text-embedding-3-small', 'gpt-4o-mini'],
				isVerified: true,
			},
			{
				id: 'cli',
				type: 'cli-claude-code',
				credential: '',
				availableModels: ['claude-sonnet'],
				isVerified: true,
			},
		];

		const desktop = getVoiceEligibleLlmProviders(providers);
		expect(desktop).toHaveLength(2);
		expect(desktop[0].availableModels).toEqual(['gpt-4o-mini']);

		(Platform as { isMobile: boolean }).isMobile = true;
		const mobile = getVoiceEligibleLlmProviders(providers);
		expect(mobile.map((p) => p.id)).toEqual(['oai']);
	});
});
