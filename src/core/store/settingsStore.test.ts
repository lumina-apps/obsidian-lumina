import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { settingsStore, syncSettingsStore } from './settingsStore';
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
});
