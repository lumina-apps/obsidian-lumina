import { App, moment, getLanguage } from 'obsidian';
import type LuminaPlugin from '../../main';
import { DEFAULT_SETTINGS } from './defaultSettings';
import type { LuminaSettings } from './settings.types';
import type { PluginLanguage } from '../../shared/types/settings.types';
import { initSettingsStore, syncSettingsStore } from '../store/settingsStore';

export class SettingsManager {
	private plugin: LuminaPlugin;
	private app: App;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.plugin.loadData()) as Partial<LuminaSettings> | null;
		this.plugin.isFirstRun = !saved || Object.keys(saved).length === 0;
		const safeSaved = saved ?? {};

		this.plugin.settings = {
			connections: Object.assign({}, DEFAULT_SETTINGS.connections, safeSaved.connections ?? {}),
			chat: Object.assign({}, DEFAULT_SETTINGS.chat, safeSaved.chat ?? {}),
			rag: Object.assign({}, DEFAULT_SETTINGS.rag, safeSaved.rag ?? {}),
			misc: Object.assign({}, DEFAULT_SETTINGS.misc, safeSaved.misc ?? {}),
			mcp: Object.assign({}, DEFAULT_SETTINGS.mcp, safeSaved.mcp ?? {}),
			webSearch: Object.assign({}, DEFAULT_SETTINGS.webSearch, safeSaved.webSearch ?? {}),
		};

		// SecretStorage에서 자격 증명 로드 (LLM Provider)
		for (const provider of this.plugin.settings.connections.providers) {
			const storedSecret = this.app.secretStorage.getSecret(`lumina-provider-${provider.id}`);
			if (storedSecret !== null) {
				provider.credential = storedSecret;
			}
		}

		// SecretStorage에서 MCP 토큰 로드 (내장 서버)
		const mcpServerSecret = this.app.secretStorage.getSecret('lumina-mcp-server-auth');
		if (mcpServerSecret !== null) {
			this.plugin.settings.mcp.serverAuthToken = mcpServerSecret;
		}

		// SecretStorage에서 MCP 토큰 로드 (외부 서버)
		for (const server of this.plugin.settings.mcp.servers) {
			const storedSecret = this.app.secretStorage.getSecret(`lumina-mcp-client-${server.id}`);
			if (storedSecret !== null) {
				server.authToken = storedSecret;
			}
		}

		for (const provider of this.plugin.settings.webSearch.providers) {
			const apiKey = this.app.secretStorage.getSecret(`lumina-websearch-apikey-${provider.type}`);
			if (apiKey !== null) {
				provider.apiKey = apiKey;
			}
			if (provider.type === 'google') {
				const cx = this.app.secretStorage.getSecret(`lumina-websearch-cx-${provider.type}`);
				if (cx !== null) {
					provider.googleSearchEngineId = cx;
				}
			}
		}

		if (this.plugin.isFirstRun) {
			this.plugin.settings.connections.language = this.detectSystemLanguage();
			await this.saveSettings();
		}
		
		// Initialize the settings store immediately after loading
		initSettingsStore(this.plugin.settings);
	}

	async saveSettings(): Promise<void> {
		const settingsToSave = JSON.parse(JSON.stringify(this.plugin.settings)) as LuminaSettings;

		// 자격 증명은 SecretStorage에 저장하고, 파일 저장 객체에서는 제거 (LLM Provider)
		for (const provider of settingsToSave.connections.providers) {
			const originalProvider = this.plugin.settings.connections.providers.find((p) => p.id === provider.id);
			if (originalProvider) {
				this.app.secretStorage.setSecret(
					`lumina-provider-${provider.id}`,
					originalProvider.credential || '',
				);
			}
			provider.credential = '';
		}

		for (const provider of settingsToSave.webSearch.providers) {
			const originalProvider = this.plugin.settings.webSearch.providers.find((p) => p.type === provider.type);
			if (originalProvider) {
				this.app.secretStorage.setSecret(
					`lumina-websearch-apikey-${provider.type}`,
					originalProvider.apiKey || '',
				);
				if (provider.type === 'google') {
					this.app.secretStorage.setSecret(
						`lumina-websearch-cx-${provider.type}`,
						originalProvider.googleSearchEngineId || '',
					);
				}
			}
			provider.apiKey = '';
			if (provider.type === 'google') {
				provider.googleSearchEngineId = '';
			}
		}

		// MCP 내장 서버 토큰
		this.app.secretStorage.setSecret(
			'lumina-mcp-server-auth',
			this.plugin.settings.mcp.serverAuthToken || '',
		);
		settingsToSave.mcp.serverAuthToken = '';

		// MCP 외부 서버 토큰
		for (const server of settingsToSave.mcp.servers) {
			const originalServer = this.plugin.settings.mcp.servers.find((s) => s.id === server.id);
			if (originalServer?.authToken) {
				this.app.secretStorage.setSecret(`lumina-mcp-client-${server.id}`, originalServer.authToken);
			}
			server.authToken = '';
		}

		await this.plugin.saveData(settingsToSave);
		syncSettingsStore(this.plugin.settings);
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
