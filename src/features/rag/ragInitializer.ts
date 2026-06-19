/**
 * RAG 임베딩 워커 + 인덱서 초기화 모듈.
 * 임베딩 워커(auto/custom) 초기화, VaultIndexer 생성, 동기화 모드(watch/on-start/manual) 처리를 담당합니다.
 */

import { Notice, Platform } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import { createProvider } from '../../core/llm-providers';
import { EmbeddingWorkerBridge } from './workerBridge';
import { getModelCacheDir } from './storage';
import { VaultIndexer } from './indexer';
import { EmbeddingStore } from './embeddingStore';
import { setIndexingStatus } from '../../core/store/ragStore';
import { debugLogger } from '../../shared/debugLogger';
import type LuminaPlugin from '../../main';

/** 기본 임베딩 모델 (auto 모드). 다국어 지원. */
export const DEFAULT_EMBEDDING_MODEL = 'ibm-granite/granite-embedding-97m-multilingual-r2';

/**
 * RAG 임베딩 워커 초기화 후 VaultIndexer를 생성하여 인덱싱을 시작합니다.
 */
export async function initEmbeddingWorker(
	plugin: LuminaPlugin,
	isStartup: boolean = false,
	isFirstRun: boolean = false,
): Promise<void> {
	// 기존에 실행 중인 워커가 있으면 먼저 정리
	if (plugin.embeddingWorker) {
		plugin.embeddingWorker.terminate();
		plugin.embeddingWorker = null;
	}
	if (plugin.indexer) {
		plugin.indexer.destroy();
	}
	plugin.indexer = null;
	plugin.clearWatchEvents();

	const { embedding, providers } = plugin.settings.connections;
	let progressNotice: Notice | null = null;

	try {
		if (!isStartup) {
			progressNotice = new Notice(t('settings.rag.init.loadingModel'), 0);
		}
		setIndexingStatus('loading-model');

		let embedFn: (texts: string[]) => Promise<number[][]>;
		let modelName = DEFAULT_EMBEDDING_MODEL;

		if (embedding.mode === 'custom' && embedding.providerId && embedding.modelId) {
			modelName = embedding.modelId;
			const providerConfig = providers.find(p => p.id === embedding.providerId);
			if (!providerConfig) throw new Error('선택한 임베딩 프로바이더 설정을 찾을 수 없습니다.');

			const provider = createProvider(providerConfig);
			embedFn = (texts: string[]) => provider.embed(texts, { model: modelName });
			progressNotice?.setMessage(t('settings.rag.init.cloudSuccess'));
		} else {
			if (Platform.isMobile) {
				throw new Error(t('uiMessages.errMobileAuto'));
			}
			modelName = DEFAULT_EMBEDDING_MODEL;
			const cacheDir = getModelCacheDir(plugin.app);

			plugin.embeddingWorker = new EmbeddingWorkerBridge();

			// 로컬에 WASM 파일 우선, 없으면 Worker에서 CDN 폴백
			const pluginDir = plugin.app.vault.adapter.getResourcePath(plugin.manifest.dir || '');

			await plugin.embeddingWorker.init(
				modelName,
				cacheDir,
				pluginDir,
				(progress, status) => {
					const pct = Math.round(progress * 100);
					if (!isStartup) progressNotice?.setMessage(t('settings.rag.init.loadingProgress', { pct: pct, status: status }));
				},
			);
			const worker = plugin.embeddingWorker;
			embedFn = (texts: string[]) => {
				if (!worker) throw new Error('임베딩 워커가 종료되었습니다.');
				return worker.embed(texts);
			};
		}

		progressNotice?.hide();

		// IndexedDB 임베딩 저장소 초기화
		const embeddingStore = new EmbeddingStore();
		await embeddingStore.init(modelName);

		// 인덱서 생성 (modelName 전달로 스키마 무효화 감지)
		plugin.indexer = new VaultIndexer(
			plugin.app,
			embedFn,
			(buffer, ext) => plugin.embeddingWorker!.parse(buffer, ext),
			plugin.settings.rag,
			plugin.settings.chat.historyPath,
			modelName,
			embeddingStore,
			plugin.embeddingWorker ? () => plugin.embeddingWorker!.persistCache() : undefined,
		);

		if (!isStartup) progressNotice?.setMessage(t('settings.rag.init.indexingVault'));

		const { syncMode } = plugin.settings.rag;

		if (syncMode === 'watch' || syncMode === 'on-start') {
			if (!isStartup || isFirstRun) new Notice(t('settings.rag.init.indexingVault'), 2000);

			// 최초 실행 시 전체 인덱싱, 아니면 증분 업데이트
			const indexPromise = isFirstRun ? plugin.indexer.indexVault() : plugin.indexer.updateIndex();

			indexPromise
				.then(() => {
					if (!isStartup || isFirstRun) new Notice(t('settings.rag.init.ready'), 3000);
				})
				.catch((err: Error) => {
					new Notice(t('settings.rag.init.indexFail', { error: err.message }), 5000);
					debugLogger.logError('rag', err instanceof Error ? err : new Error(`인덱싱 실패: ${err}`));
				})
				.finally(() => {
					// watch 모드: 초기 인덱싱 완료 후 파일 변경 이벤트 등록
					if (syncMode === 'watch') {
						plugin.registerWatchEvents();
					}
				});
		} else {
			// manual 모드: 즉시 ready 상태로 설정
			setIndexingStatus('ready');
			if (!isStartup) new Notice(t('settings.rag.init.readyManual'), 3000);
		}
	} catch (err) {
		if (progressNotice) {
			progressNotice.hide();
		}
		setIndexingStatus('error', { errorMessage: (err as Error).message });
		new Notice(t('settings.rag.init.initFail', { error: (err as Error).message }), 5000);
		debugLogger.logError('rag', err instanceof Error ? err : new Error(`embedding worker init failed: ${err}`));
		plugin.embeddingWorker = null;
		// 초기화 실패 시 RAG 토글을 false로 되돌림
		if (plugin.settings.connections.ragEnabled) {
			plugin.settings.connections.ragEnabled = false;
			await plugin.saveSettings();
			plugin.refreshSettingTab();
		}
	}
}