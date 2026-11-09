import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsManager } from './settingsManager';
import { DEFAULT_SETTINGS } from './defaultSettings';
import type LuminaPlugin from '../../main';
import type { LuminaSettings } from './settings.types';
import type { LLMProviderConfig } from '../../shared/types/settings.types';

describe('SettingsManager', () => {
	let mockPlugin: LuminaPlugin;
	let mockSecretStore: Map<string, string>;
	let mockSecretStorage: {
		getSecret: ReturnType<typeof vi.fn>;
		setSecret: ReturnType<typeof vi.fn>;
		listSecrets: ReturnType<typeof vi.fn>;
	};
	let savedDataPayload: LuminaSettings | null = null;

	beforeEach(() => {
		mockSecretStore = new Map<string, string>();
		savedDataPayload = null;

		mockSecretStorage = {
			getSecret: vi.fn((key: string) => mockSecretStore.get(key) ?? null),
			setSecret: vi.fn((key: string, val: string) => {
				mockSecretStore.set(key, val);
			}),
			listSecrets: vi.fn(() => Array.from(mockSecretStore.keys())),
		};

		const defaultCopy = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaSettings;

		mockPlugin = {
			settings: defaultCopy,
			isFirstRun: false,
			app: {
				secretStorage: mockSecretStorage,
			},
			loadData: vi.fn().mockResolvedValue(null),
			saveData: vi.fn().mockImplementation((data: LuminaSettings) => {
				savedDataPayload = data;
				return Promise.resolve();
			}),
		} as unknown as LuminaPlugin;
	});

	describe('loadSettings', () => {
		it('저장된 데이터가 없으면 isFirstRun=true가 되고 언어를 자동 감지하여 저장한다', async () => {
			mockPlugin.loadData = vi.fn().mockResolvedValue(null);
			const manager = new SettingsManager(mockPlugin);

			await manager.loadSettings();

			expect(mockPlugin.isFirstRun).toBe(true);
			expect(mockPlugin.saveData).toHaveBeenCalled();
			expect(mockPlugin.settings.connections.language).toBeDefined();
		});

		it('저장된 데이터가 있으면 DEFAULT_SETTINGS와 깊은 병합(deepMerge)된다', async () => {
			mockPlugin.loadData = vi.fn().mockResolvedValue({
				connections: {
					language: 'ko',
				},
				mcp: {
					serverPort: 9999,
				},
			});
			const manager = new SettingsManager(mockPlugin);

			await manager.loadSettings();

			expect(mockPlugin.isFirstRun).toBe(false);
			expect(mockPlugin.settings.connections.language).toBe('ko');
			expect(mockPlugin.settings.mcp.serverPort).toBe(9999);
			// 병합되지 않은 기본값들은 그대로 보존
			expect(mockPlugin.settings.rag.topK).toBe(DEFAULT_SETTINGS.rag.topK);
		});
	});

	describe('saveSettings - SecretStorage 분리 및 평문 누출 방지', () => {
		it('secretStorage가 활성화되어 있으면 API 키와 자격 증명을 secretStorage에 저장하고 디스크 저장 객체에서는 제거한다', async () => {
			const manager = new SettingsManager(mockPlugin);

			// 테스트용 프로바이더 및 시크릿 설정
			const testProvider: LLMProviderConfig = {
				id: 'prov-openai-1',
				type: 'openai',
				credential: 'sk-secret-openai-api-key',
				availableModels: ['gpt-4o'],
				isVerified: true,
			};
			mockPlugin.settings.connections.providers = [testProvider];

			mockPlugin.settings.webSearch.providers = [
				{
					type: 'google',
					apiKey: 'google-api-key-1234',
					googleSearchEngineId: 'cx-engine-id-5678',
				},
			];

			mockPlugin.settings.mcp.serverAuthToken = 'mcp-secret-token-777';
			mockPlugin.settings.mcp.servers = [
				{
					id: 'remote-mcp-1',
					name: 'Remote Server',
					transport: 'sse',
					url: 'http://localhost:3000',
					authToken: 'remote-auth-secret-999',
					enabled: true,
					status: 'connected',
				},
			];

			await manager.saveSettings();

			// 1. SecretStorage에 올바른 키로 시크릿이 저장되었는지 검증
			expect(mockSecretStorage.setSecret).toHaveBeenCalledWith(
				'lumina-provider-prov-openai-1',
				'sk-secret-openai-api-key',
			);
			expect(mockSecretStorage.setSecret).toHaveBeenCalledWith(
				'lumina-websearch-apikey-google',
				'google-api-key-1234',
			);
			expect(mockSecretStorage.setSecret).toHaveBeenCalledWith(
				'lumina-websearch-cx-google',
				'cx-engine-id-5678',
			);
			expect(mockSecretStorage.setSecret).toHaveBeenCalledWith(
				'lumina-mcp-server-auth',
				'mcp-secret-token-777',
			);
			expect(mockSecretStorage.setSecret).toHaveBeenCalledWith(
				'lumina-mcp-client-remote-mcp-1',
				'remote-auth-secret-999',
			);

			// 2. 디스크에 저장되는 파일(saveData 페이로드)에는 민감 정보가 빈 문자열('')로 비워졌는지 엄격 검증
			expect(savedDataPayload).not.toBeNull();
			expect(savedDataPayload?.connections.providers[0].credential).toBe('');
			expect(savedDataPayload?.webSearch.providers[0].apiKey).toBe('');
			expect(savedDataPayload?.webSearch.providers[0].googleSearchEngineId).toBe('');
			expect(savedDataPayload?.mcp.serverAuthToken).toBe('');
			expect(savedDataPayload?.mcp.servers[0].authToken).toBe('');

			// 3. 하지만 런타임 메모리(plugin.settings)에는 원본 자격 증명이 유지되어야 함
			expect(mockPlugin.settings.connections.providers[0].credential).toBe('sk-secret-openai-api-key');
			expect(mockPlugin.settings.webSearch.providers[0].apiKey).toBe('google-api-key-1234');
		});

		it('secretStorage가 없는 환경에서는 fallback으로 디스크 저장 페이로드에 자격 증명을 보존한다', async () => {
			(mockPlugin.app as { secretStorage: unknown }).secretStorage = undefined;
			const manager = new SettingsManager(mockPlugin);

			mockPlugin.settings.connections.providers = [
				{
					id: 'prov-1',
					type: 'anthropic',
					credential: 'sk-ant-test',
					availableModels: [],
					isVerified: true,
				},
			];

			await manager.saveSettings();

			expect(savedDataPayload?.connections.providers[0].credential).toBe('sk-ant-test');
		});
	});

	describe('loadSecrets - SecretStorage에서 자격 증명 복원', () => {
		it('SecretStorage에 저장된 자격 증명을 읽어 plugin.settings에 올바르게 복원한다', async () => {
			mockSecretStore.set('lumina-provider-p1', 'sk-restored-provider-key');
			mockSecretStore.set('lumina-websearch-apikey-google', 'restored-google-key');
			mockSecretStore.set('lumina-websearch-cx-google', 'restored-cx-id');
			mockSecretStore.set('lumina-mcp-server-auth', 'restored-mcp-server-token');
			mockSecretStore.set('lumina-mcp-client-s1', 'restored-mcp-client-token');

			mockPlugin.settings.connections.providers = [
				{ id: 'p1', type: 'openai', credential: '', availableModels: [], isVerified: true },
			];
			mockPlugin.settings.webSearch.providers = [
				{ type: 'google', apiKey: '', googleSearchEngineId: '' },
			];
			mockPlugin.settings.mcp.serverAuthToken = '';
			mockPlugin.settings.mcp.servers = [
				{ id: 's1', name: 'Server 1', transport: 'sse', url: 'http://localhost', authToken: '', enabled: true, status: 'connected' },
			];

			const manager = new SettingsManager(mockPlugin);
			await manager.loadSecrets();

			expect(mockPlugin.settings.connections.providers[0].credential).toBe('sk-restored-provider-key');
			expect(mockPlugin.settings.webSearch.providers[0].apiKey).toBe('restored-google-key');
			expect(mockPlugin.settings.webSearch.providers[0].googleSearchEngineId).toBe('restored-cx-id');
			expect(mockPlugin.settings.mcp.serverAuthToken).toBe('restored-mcp-server-token');
			expect(mockPlugin.settings.mcp.servers[0].authToken).toBe('restored-mcp-client-token');
		});

		it('secretStorage 호출 중 예외가 발생하더라도 크래시 없이 건너뛴다', async () => {
			mockSecretStorage.getSecret.mockImplementation(() => {
				throw new Error('Keyring locked');
			});

			mockPlugin.settings.connections.providers = [
				{ id: 'p1', type: 'openai', credential: '', availableModels: [], isVerified: true },
			];

			const manager = new SettingsManager(mockPlugin);
			await expect(manager.loadSecrets()).resolves.not.toThrow();
		});
	});
});
