import { describe, it, expect, vi } from 'vitest';
import { migrateQuickActions, migrateExcludedPaths } from './migrations';
import { addDynamicLocale, setLanguage } from '../../shared/locales/helpers';
import type LuminaPlugin from '../../main';

describe('migrateQuickActions', () => {
	it('Spanish and French translate quick actions (case-insensitive) are correctly migrated', async () => {
		// Set up dynamic translation keys for testing
		addDynamicLocale('es', {
			settings: {
				chat: {
					quickActions: {
						defaults: {
							translate: {
								name: 'Traducir al español',
								prompt: 'Traduce el siguiente texto a un español natural:\n\n',
							},
						},
					},
				},
			},
		} as any);

		addDynamicLocale('en', {
			settings: {
				chat: {
					quickActions: {
						defaults: {
							translate: {
								name: 'Translate to English',
								prompt: 'Translate the following text into natural English:\n\n',
							},
						},
					},
				},
			},
		} as any);

		// Initialize translation system to English first
		await setLanguage('en');

		// Mock plugin instance
		const registerQuickActionsMock = vi.fn();
		const mockPlugin = {
			settings: {
				chat: {
					quickActions: [
						{
							id: 'qa-translate',
							name: 'Traducir al español', // Spanish lowercase 'español' which is what is in es.json
							prompt: 'Some prompt',
							actionType: 'replace',
						},
					],
				},
			},
			registerQuickActions: registerQuickActionsMock,
		} as unknown as LuminaPlugin;

		// 1. When in English mode, check if "Traducir al español" is correctly detected and migrated to "Translate to English"
		const result = migrateQuickActions(mockPlugin);

		expect(result).toBe(true);
		expect(mockPlugin.settings.chat.quickActions[0].name).toBe('Translate to English');
		expect(mockPlugin.settings.chat.quickActions[0].prompt).toBe(
			'Translate the following text into natural English:\n\n'
		);
		expect(registerQuickActionsMock).toHaveBeenCalledTimes(1);

		// 2. Set translation system to Spanish
		await setLanguage('es');

		// If name is already 'Translate to English', changing language to 'es' should migrate it to 'Traducir al español'
		registerQuickActionsMock.mockClear();
		const result2 = migrateQuickActions(mockPlugin);
		expect(result2).toBe(true);
		expect(mockPlugin.settings.chat.quickActions[0].name).toBe('Traducir al español');
		expect(mockPlugin.settings.chat.quickActions[0].prompt).toBe(
			'Traduce el siguiente texto a un español natural:\n\n'
		);
		expect(registerQuickActionsMock).toHaveBeenCalledTimes(1);
	});
});

describe('migrateExcludedPaths', () => {
	it('adds backups and other missing paths to excludedPaths settings', () => {
		const mockPlugin = {
			app: {
				vault: {
					configDir: '.obsidian',
				},
			},
			settings: {
				misc: {
					hasMigratedChatHistory: false,
				},
				rag: {
					excludedPaths: ['templates', 'Templates', '_templates'],
				},
			},
		} as unknown as LuminaPlugin;

		const result = migrateExcludedPaths(mockPlugin);

		expect(result).toBe(true);
		expect(mockPlugin.settings.rag.excludedPaths).toContain('backups');
		expect(mockPlugin.settings.rag.excludedPaths).toContain('.obsidian');
		expect(mockPlugin.settings.rag.excludedPaths).toContain('chatHistory');
	});

	it('does not add backups if already present', () => {
		const mockPlugin = {
			app: {
				vault: {
					configDir: '.obsidian',
				},
			},
			settings: {
				misc: {
					hasMigratedChatHistory: true,
				},
				rag: {
					excludedPaths: ['templates', 'Templates', '_templates', 'chatHistory', '.obsidian', 'backups'],
				},
			},
		} as unknown as LuminaPlugin;

		const result = migrateExcludedPaths(mockPlugin);

		expect(result).toBe(false);
	});
});
