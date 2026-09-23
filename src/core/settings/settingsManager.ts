import { App, moment, getLanguage } from 'obsidian';
import type LuminaPlugin from '../../main';
import { DEFAULT_SETTINGS } from './defaultSettings';
import type { LuminaSettings } from './settings.types';
import type { PluginLanguage } from '../../shared/types/settings.types';
import { initSettingsStore, syncSettingsStore } from '../store/settingsStore';
import { initProjectStore, syncProjectStore } from '../store/projectStore';
import { debugLogger } from '../../shared/debugLogger';

export class SettingsManager {
	private plugin: LuminaPlugin;
	private app: App;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	private deepMergeSettings<T extends object>(defaultSettings: T, savedSettings: Partial<T>): T {
		const result = { ...defaultSettings } as Record<string, unknown>;
		const saved = savedSettings as Record<string, unknown>;

		for (const key in saved) {
			const savedValue = saved[key];
			if (savedValue === undefined) continue;

			if (
				savedValue !== null &&
				typeof savedValue === 'object' &&
				!Array.isArray(savedValue)
			) {
				const defaultValue = result[key];
				const defaultObj = (defaultValue !== null && typeof defaultValue === 'object' && !Array.isArray(defaultValue))
					? defaultValue
					: {};
				result[key] = this.deepMergeSettings(defaultObj, savedValue);
			} else {
				result[key] = savedValue;
			}
		}
		return result as T;
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.plugin.loadData()) as Partial<LuminaSettings> | null;
		this.plugin.isFirstRun = !saved || Object.keys(saved).length === 0;
		const safeSaved = saved ?? {};

		this.plugin.settings = this.deepMergeSettings(DEFAULT_SETTINGS, safeSaved);

		if (this.plugin.isFirstRun) {
			this.plugin.settings.connections.language = this.detectSystemLanguage();
			await this.saveSettings();
		}
		
		// Initialize the settings store immediately after loading
		initSettingsStore(this.plugin.settings);
		// Initialize the project store
		const proj = this.plugin.settings.projects;
		initProjectStore(
			proj?.list ?? DEFAULT_SETTINGS.projects.list,
			proj?.activeProjectId ?? 'default',
		);
	}

	async loadSecrets(): Promise<void> {
		if (!this.app.secretStorage) {
			return;
		}

		// SecretStorage에서 자격 증명 로드 (LLM Provider)
		for (const provider of this.plugin.settings.connections.providers) {
			try {
				const storedSecret = this.app.secretStorage.getSecret(`lumina-provider-${provider.id}`);
				if (storedSecret !== null && storedSecret !== '') {
					provider.credential = storedSecret;
				}
			} catch (e) {
				debugLogger.logWarn('settings', `Failed to get secret for provider ${provider.id}: ${e}`);
			}
		}

		// SecretStorage에서 MCP 토큰 로드 (내장 서버)
		try {
			const mcpServerSecret = this.app.secretStorage.getSecret('lumina-mcp-server-auth');
			if (mcpServerSecret !== null && mcpServerSecret !== '') {
				this.plugin.settings.mcp.serverAuthToken = mcpServerSecret;
			}
		} catch (e) {
			debugLogger.logWarn('settings', `Failed to get mcp server auth secret: ${e}`);
		}

		// SecretStorage에서 MCP 토큰 로드 (외부 서버)
		for (const server of this.plugin.settings.mcp.servers) {
			try {
				const storedSecret = this.app.secretStorage.getSecret(`lumina-mcp-client-${server.id}`);
				if (storedSecret !== null && storedSecret !== '') {
					server.authToken = storedSecret;
				}
			} catch (e) {
				debugLogger.logWarn('settings', `Failed to get mcp client secret for ${server.id}: ${e}`);
			}
		}

		for (const provider of this.plugin.settings.webSearch.providers) {
			try {
				const apiKey = this.app.secretStorage.getSecret(`lumina-websearch-apikey-${provider.type}`);
				if (apiKey !== null && apiKey !== '') {
					provider.apiKey = apiKey;
				}
				if (provider.type === 'google') {
					const cx = this.app.secretStorage.getSecret(`lumina-websearch-cx-${provider.type}`);
					if (cx !== null && cx !== '') {
						provider.googleSearchEngineId = cx;
					}
				}
			} catch (e) {
				debugLogger.logWarn('settings', `Failed to get websearch secret for ${provider.type}: ${e}`);
			}
		}
		
		// Sync the store again after secrets are loaded
		syncSettingsStore(this.plugin.settings);
	}

	async saveSettings(): Promise<void> {
		const settingsToSave = JSON.parse(JSON.stringify(this.plugin.settings)) as LuminaSettings;
		const hasSecretStorage = !!this.app.secretStorage;

		// 자격 증명은 SecretStorage에 저장하고, 파일 저장 객체에서는 제거 (LLM Provider)
		for (const provider of settingsToSave.connections.providers) {
			const originalProvider = this.plugin.settings.connections.providers.find((p) => p.id === provider.id);
			const credential = originalProvider?.credential || '';
			if (hasSecretStorage) {
				try {
					this.app.secretStorage.setSecret(
						`lumina-provider-${provider.id}`,
						credential,
					);
					provider.credential = '';
				} catch (e) {
					debugLogger.logWarn('settings', `Failed to save secret for provider ${provider.id}: ${e}`);
					provider.credential = credential;
				}
			} else {
				provider.credential = credential;
			}
		}

		for (const provider of settingsToSave.webSearch.providers) {
			const originalProvider = this.plugin.settings.webSearch.providers.find((p) => p.type === provider.type);
			const apiKey = originalProvider?.apiKey || '';
			const cx = (originalProvider?.type === 'google' ? originalProvider.googleSearchEngineId : '') || '';

			if (hasSecretStorage) {
				try {
					this.app.secretStorage.setSecret(
						`lumina-websearch-apikey-${provider.type}`,
						apiKey,
					);
					provider.apiKey = '';
				} catch (e) {
					debugLogger.logWarn('settings', `Failed to save websearch apikey for ${provider.type}: ${e}`);
					provider.apiKey = apiKey;
				}

				if (provider.type === 'google') {
					try {
						this.app.secretStorage.setSecret(
							`lumina-websearch-cx-${provider.type}`,
							cx,
						);
						provider.googleSearchEngineId = '';
					} catch (e) {
						debugLogger.logWarn('settings', `Failed to save websearch cx for google: ${e}`);
						provider.googleSearchEngineId = cx;
					}
				}
			} else {
				provider.apiKey = apiKey;
				if (provider.type === 'google') {
					provider.googleSearchEngineId = cx;
				}
			}
		}

		// MCP 내장 서버 토큰
		const mcpToken = this.plugin.settings.mcp.serverAuthToken || '';
		if (hasSecretStorage) {
			try {
				this.app.secretStorage.setSecret('lumina-mcp-server-auth', mcpToken);
				settingsToSave.mcp.serverAuthToken = '';
			} catch (e) {
				debugLogger.logWarn('settings', `Failed to save mcp server auth token: ${e}`);
				settingsToSave.mcp.serverAuthToken = mcpToken;
			}
		} else {
			settingsToSave.mcp.serverAuthToken = mcpToken;
		}

		// MCP 외부 서버 토큰
		for (const server of settingsToSave.mcp.servers) {
			const originalServer = this.plugin.settings.mcp.servers.find((s) => s.id === server.id);
			const authToken = originalServer?.authToken || '';
			if (hasSecretStorage) {
				try {
					this.app.secretStorage.setSecret(`lumina-mcp-client-${server.id}`, authToken);
					server.authToken = '';
				} catch (e) {
					debugLogger.logWarn('settings', `Failed to save mcp client secret for ${server.id}: ${e}`);
					server.authToken = authToken;
				}
			} else {
				server.authToken = authToken;
			}
		}

		await this.plugin.saveData(settingsToSave);
		syncSettingsStore(this.plugin.settings);
		syncProjectStore(
			this.plugin.settings.projects.list,
			this.plugin.settings.projects.activeProjectId,
		);
	}

	private detectSystemLanguage(): PluginLanguage {
		let obsLang = getLanguage();
		const momentLang = moment.locale();
		const navLangRaw = navigator.language;

		if (!obsLang) {
			obsLang = momentLang || navLangRaw;
		}
		const navLang = (obsLang || 'en').toLowerCase();
		const supportedLangs = ['en', 'ko', 'ja', 'zh', 'zh-tw', 'es', 'pt', 'de', 'fr', 'ru', 'it'];
		let detectLang = 'en';

		if (navLang.startsWith('zh')) {
			detectLang = navLang === 'zh-tw' || navLang === 'zh-hk' ? 'zh-tw' : 'zh';
		} else {
			const baseLang = navLang.split('-')[0];
			if (supportedLangs.includes(baseLang)) {
				detectLang = baseLang;
			}
		}

		return detectLang as PluginLanguage;
	}
}
