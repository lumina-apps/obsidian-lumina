import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { Platform } from 'obsidian';
import { settingsStore, syncSettingsStore, verifiedProviders, isRagEnabled } from './settingsStore';
import { DEFAULT_SETTINGS } from '../settings/defaultSettings';
import type { LuminaSettings } from '../settings/settings.types';

describe('settingsStore', () => {
	beforeEach(() => {
		syncSettingsStore(DEFAULT_SETTINGS);
	});

	it('should sync full settings correctly', () => {
		const customSettings: LuminaSettings = {
			...DEFAULT_SETTINGS,
			chat: {
				...DEFAULT_SETTINGS.chat,
				quickActions: [
					{ id: 'custom-qa', name: 'Custom Action', prompt: 'Custom Prompt', actionType: 'replace' }
				],
			},
		};

		syncSettingsStore(customSettings);

		const current = get(settingsStore);
		expect(current).not.toBeNull();
		expect(current?.chat.quickActions).toHaveLength(1);
		expect(current?.chat.quickActions[0].name).toBe('Custom Action');
	});

	it('should handle undefined quickActions safely without crashing', () => {
		const brokenSettings = {
			...DEFAULT_SETTINGS,
			chat: {
				...DEFAULT_SETTINGS.chat,
				quickActions: undefined as unknown as typeof DEFAULT_SETTINGS.chat.quickActions,
			},
		} as LuminaSettings;

		expect(() => syncSettingsStore(brokenSettings)).not.toThrow();

		const current = get(settingsStore);
		expect(current).not.toBeNull();
		expect(current?.chat.quickActions).toEqual([]);
	});

	it('should clone systemPrompts items for reactivity and handle undefined systemPrompts safely', () => {
		const originalPrompt = { id: 'sp-1', name: 'Original', content: 'Content' };
		const customSettings: LuminaSettings = {
			...DEFAULT_SETTINGS,
			chat: {
				...DEFAULT_SETTINGS.chat,
				systemPrompts: [originalPrompt],
			},
		};

		syncSettingsStore(customSettings);
		const current = get(settingsStore);
		expect(current?.chat.systemPrompts).toHaveLength(1);
		expect(current?.chat.systemPrompts[0]).toEqual(originalPrompt);
		expect(current?.chat.systemPrompts[0]).not.toBe(originalPrompt);

		const brokenSettings = {
			...DEFAULT_SETTINGS,
			chat: {
				...DEFAULT_SETTINGS.chat,
				systemPrompts: undefined as unknown as typeof DEFAULT_SETTINGS.chat.systemPrompts,
			},
		} as LuminaSettings;

		expect(() => syncSettingsStore(brokenSettings)).not.toThrow();
		expect(get(settingsStore)?.chat.systemPrompts).toEqual([]);
	});

	it('모바일 환경에서 verifiedProviders는 로컬/CLI를 제외하고 isRagEnabled는 auto 모드에서 false를 반환한다', () => {
		const origIsMobile = Platform.isMobile;
		try {
			const syncedSettings: LuminaSettings = {
				...DEFAULT_SETTINGS,
				connections: {
					...DEFAULT_SETTINGS.connections,
					ragEnabled: true,
					embedding: { mode: 'auto', providerId: '', modelId: '' },
					providers: [
						{ id: 'oai', type: 'openai', credential: 'sk', availableModels: ['gpt-4o'], isVerified: true },
						{ id: 'ol', type: 'ollama', credential: '', availableModels: ['llama3'], isVerified: true },
						{ id: 'cli', type: 'cli-claude-code', credential: '', availableModels: ['claude'], isVerified: true },
					],
				},
			};

			(Platform as { isMobile: boolean }).isMobile = true;
			syncSettingsStore(syncedSettings);
			expect(get(verifiedProviders).map(p => p.id)).toEqual(['oai']);
			expect(get(isRagEnabled)).toBe(false);

			// 모바일에서도 custom 클라우드 임베딩이 설정되면 isRagEnabled는 true 유지
			syncSettingsStore({
				...syncedSettings,
				connections: {
					...syncedSettings.connections,
					embedding: { mode: 'custom', providerId: 'oai', modelId: 'text-embedding-3-small' },
				},
			});
			expect(get(isRagEnabled)).toBe(true);

			// 모바일에서 custom 대상이 동기화된 로컬 프로바이더(ollama)인 경우 false 반환
			syncSettingsStore({
				...syncedSettings,
				connections: {
					...syncedSettings.connections,
					embedding: { mode: 'custom', providerId: 'ol', modelId: 'nomic-embed' },
				},
			});
			expect(get(isRagEnabled)).toBe(false);
		} finally {
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
	});
});
