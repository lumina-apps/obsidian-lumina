import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { get } from 'svelte/store';
import { DEFAULT_SETTINGS } from '../../core/settings/defaultSettings';
import { initProjectStore } from '../../core/store/projectStore';
import { indexingState, setIndexingStatus } from '../../core/store/ragStore';
import { createProvider } from '../../core/llm-providers';
import { projectIndexCache } from './projectIndexCache';
import { initEmbeddingWorker, switchProjectIndex } from './ragInitializer';
import type LuminaPlugin from '../../main';

const { mockEmbedFn } = vi.hoisted(() => ({
	mockEmbedFn: vi.fn().mockResolvedValue([[0.1, 0.2]]),
}));

vi.mock('../../core/llm-providers', () => ({
	createProvider: vi.fn(() => ({
		embed: mockEmbedFn,
	})),
}));

vi.mock('./embeddingStore', () => ({
	EmbeddingStore: class MockEmbeddingStore {
		init = vi.fn().mockResolvedValue(undefined);
	},
}));

vi.mock('./indexer', () => ({
	VaultIndexer: class MockVaultIndexer {
		indexedFileCount = 3;
		destroy = vi.fn();
		indexVault = vi.fn().mockResolvedValue(undefined);
		updateIndex = vi.fn().mockResolvedValue(undefined);
		loadExistingIndex = vi.fn().mockResolvedValue(undefined);
		setChatHistoryPath = vi.fn();
	},
}));

vi.mock('./workerBridge', () => ({
	EmbeddingWorkerBridge: class MockEmbeddingWorkerBridge {
		init = vi.fn().mockResolvedValue(undefined);
		embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
		parse = vi.fn().mockResolvedValue('');
		persistCache = vi.fn().mockResolvedValue(undefined);
		terminate = vi.fn();
	},
}));

describe('ragInitializer mobile guards', () => {
	const origIsMobile = Platform.isMobile;
	const origIsDesktop = Platform.isDesktop;

	let mockPlugin: LuminaPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		projectIndexCache.destroyAll();
		setIndexingStatus('idle');

		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		settings.connections.ragEnabled = true;
		settings.projects.list = [
			{
				id: 'default',
				name: 'Default',
				historySubfolder: '',
				ragIncludedPaths: [],
				ragExcludedPaths: [],
				defaultProviderId: '',
				defaultModelId: '',
				systemPromptId: '',
				createdAt: 0,
			},
			{
				id: 'proj-2',
				name: 'Second',
				historySubfolder: '',
				ragIncludedPaths: ['Notes'],
				ragExcludedPaths: [],
				defaultProviderId: '',
				defaultModelId: '',
				systemPromptId: '',
				createdAt: 0,
			},
		];
		settings.projects.activeProjectId = 'default';
		initProjectStore(settings.projects.list, 'default');

		mockPlugin = {
			app: {
				vault: { adapter: { getResourcePath: vi.fn(() => '') }, getName: () => 'TestVault' },
				loadLocalStorage: vi.fn(() => null),
				saveLocalStorage: vi.fn(),
			},
			manifest: { id: 'lumina', dir: '.obsidian/plugins/lumina' },
			settings,
			indexer: null,
			embeddingWorker: null,
			watchManager: {
				clearWatchEvents: vi.fn(),
				registerWatchEvents: vi.fn(),
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
			refreshSettingTab: vi.fn(),
		} as unknown as LuminaPlugin;
	});

	afterEach(() => {
		projectIndexCache.destroyAll();
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		(Platform as { isDesktop: boolean }).isDesktop = origIsDesktop;
	});

	it('모바일 auto 모드에서는 로컬 임베딩 워커 초기화를 차단하되 동기화된 ragEnabled=true는 보존한다', async () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		(Platform as { isDesktop: boolean }).isDesktop = false;
		mockPlugin.settings.connections.embedding = { mode: 'auto', providerId: '', modelId: '' };

		await initEmbeddingWorker(mockPlugin, false, false);

		expect(mockPlugin.embeddingWorker).toBeNull();
		expect(mockPlugin.indexer).toBeNull();
		expect(mockPlugin.settings.connections.ragEnabled).toBe(true);
		expect(get(indexingState).status).toBe('error');
	});

	it('모바일에서 동기화된 데스크탑 로컬 임베딩(ollama)을 custom으로 가리키면 차단한다', async () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		(Platform as { isDesktop: boolean }).isDesktop = false;
		mockPlugin.settings.connections.providers = [
			{ id: 'ol', type: 'ollama', credential: '', baseUrl: 'http://localhost:11434', availableModels: ['nomic-embed-text'], isVerified: true },
		];
		mockPlugin.settings.connections.embedding = { mode: 'custom', providerId: 'ol', modelId: 'nomic-embed-text' };

		await initEmbeddingWorker(mockPlugin, false, false);

		expect(createProvider).not.toHaveBeenCalled();
		expect(mockPlugin.indexer).toBeNull();
		expect(get(indexingState).status).toBe('error');
	});

	it('모바일에서도 검증된 클라우드(OpenAI) 커스텀 임베딩이 설정되면 워커 없이 인덱서를 초기화한다', async () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		(Platform as { isDesktop: boolean }).isDesktop = false;
		mockPlugin.settings.connections.providers = [
			{ id: 'oai', type: 'openai', credential: 'sk-test', availableModels: ['text-embedding-3-small'], isVerified: true },
		];
		mockPlugin.settings.connections.embedding = { mode: 'custom', providerId: 'oai', modelId: 'text-embedding-3-small' };
		mockPlugin.settings.rag.syncMode = 'manual';

		await initEmbeddingWorker(mockPlugin, false, false);

		expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'oai', type: 'openai' }));
		expect(mockPlugin.embeddingWorker).toBeNull();
		expect(mockPlugin.indexer).not.toBeNull();
		expect(get(indexingState).status).toBe('ready');
	});

	it('switchProjectIndex는 모바일 auto 모드나 데스크탑 전용 로컬 임베딩 상태에서 워커 오류 없이 조기 반환한다', async () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		(Platform as { isDesktop: boolean }).isDesktop = false;

		mockPlugin.settings.connections.ragEnabled = true;
		mockPlugin.settings.connections.embedding = { mode: 'auto', providerId: '', modelId: '' };

		await switchProjectIndex(mockPlugin, 'proj-2');

		expect(mockPlugin.watchManager.clearWatchEvents).not.toHaveBeenCalled();
		expect(mockPlugin.indexer).toBeNull();
		expect(get(indexingState).status).toBe('idle');
	});
});
