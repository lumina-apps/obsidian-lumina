/**
 * RAG 임베딩 워커 + 인덱서 초기화 모듈.
 * 임베딩 워커(auto/custom) 초기화, VaultIndexer 생성, 동기화 모드(watch/on-start/manual) 처리를 담당합니다.
 * 프로젝트별 인덱서 hot-swap을 지원합니다.
 */

import { Notice, Platform } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import { createProvider } from '../../core/llm-providers';
import { EmbeddingWorkerBridge } from './workerBridge';
import { getModelCacheDir } from './storage';
import { VaultIndexer } from './indexer';
import { EmbeddingStore } from './embeddingStore';
import { setIndexingStatus } from '../../core/store/ragStore';
import { projectIndexCache } from './projectIndexCache';
import { getActiveProject } from '../../core/store/projectStore';
import { debugLogger } from '../../shared/debugLogger';
import type LuminaPlugin from '../../main';

/** 기본 임베딩 모델 (auto 모드). 다국어 지원. */
export const DEFAULT_EMBEDDING_MODEL = 'ibm-granite/granite-embedding-97m-multilingual-r2';



/**
 * RAG 임베딩 워커 초기화 후 VaultIndexer를 생성하여 인덱싱을 시작합니다.
 * 초기 실행 시 호출됩니다. 프로젝트 전환은 switchProjectIndex()를 사용하세요.
 */
export async function initEmbeddingWorker(
	plugin: LuminaPlugin,
	isStartup: boolean = false,
	isFirstRun: boolean = false,
): Promise<void> {
	// 기존에 실행 중인 워커가 있으면 먼저 정리
	if (plugin.indexer) {
		plugin.indexer.destroy();
		plugin.indexer = null;
	}
	if (plugin.embeddingWorker) {
		plugin.embeddingWorker.terminate();
		plugin.embeddingWorker = null;
	}
	plugin.watchManager.clearWatchEvents();

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

			if (!plugin.app.loadLocalStorage('lumina-cache-cleared-v1.2.3')) {
				try {
					await caches.delete('transformers-cache');
					plugin.app.saveLocalStorage('lumina-cache-cleared-v1.2.3', 'true');
					debugLogger.logSystem('rag', 'Cleared transformers-cache for migration');
				} catch (e) {
					debugLogger.logError('rag', e instanceof Error ? e : new Error(`Failed to clear transformers-cache: ${e}`));
				}
			}

			plugin.embeddingWorker = new EmbeddingWorkerBridge();

			// 로컬에 WASM 파일 우선, 없으면 Worker에서 CDN 폴백
			const pluginDir = plugin.app.vault.adapter.getResourcePath(plugin.manifest.dir || '');

			await plugin.embeddingWorker.init(
				modelName,
				cacheDir,
				pluginDir,
				(progress, status) => {
					const pct = Math.round(progress * 100);
					if (!isStartup) progressNotice?.setMessage(t('settings.rag.init.loadingProgress', { pct: pct }));
					setIndexingStatus('loading-model', { progressPct: pct });
				},
			);
			const worker = plugin.embeddingWorker;
			embedFn = (texts: string[]) => {
				if (!worker) throw new Error('임베딩 워커가 종료되었습니다.');
				return worker.embed(texts);
			};
		}

		progressNotice?.hide();

		// 활성 프로젝트 RAG 설정 적용
		const ragSettings = plugin.settings.rag;
		const activeProject = getActiveProject();

		// IndexedDB 임베딩 저장소 초기화 (프로젝트별 격리)
		const embeddingStore = new EmbeddingStore();
		await embeddingStore.init(modelName, activeProject.id);

		// 인덱서 생성 (modelName + projectId 전달로 프로젝트별 인덱스 분리)
		plugin.indexer = new VaultIndexer({
			app: plugin.app,
			embedFn,
			parseBinaryFn: (buffer, ext) => plugin.embeddingWorker!.parse(buffer, ext),
			settings: ragSettings,
			includedPaths: activeProject.ragIncludedPaths,
			excludedPaths: activeProject.ragExcludedPaths,
			chatHistoryPath: plugin.settings.chat.historyPath,
			modelName,
			projectId: activeProject.id,
			embeddingStore,
			persistCacheFn: plugin.embeddingWorker ? () => plugin.embeddingWorker!.persistCache() : undefined,
		});

		// 현재 활성 프로젝트로 캐시에 등록
		projectIndexCache.set(activeProject.id, plugin.indexer);

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
						plugin.watchManager.registerWatchEvents();
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

/**
 * 프로젝트 전환 시 인덱서를 hot-swap합니다.
 * - 캐시에 대상 프로젝트 인덱서가 있으면 즉시 교체 (재인덱싱 없음)
 * - 없으면 새 인덱서 생성 후 인덱싱 시작
 *
 * 전제 조건: projectStore의 activeProjectId가 이미 newProjectId로 업데이트된 상태.
 */
export async function switchProjectIndex(
	plugin: LuminaPlugin,
	newProjectId: string,
): Promise<void> {
	if (!plugin.settings.connections.ragEnabled) return;
	if (!plugin.embeddingWorker && plugin.settings.connections.embedding.mode === 'auto') return;

	// 현재 인덱서 watch 이벤트 해제
	plugin.watchManager.clearWatchEvents();

	// 캐시에서 대상 프로젝트 인덱서 조회
	const cached = projectIndexCache.get(newProjectId);
	if (cached) {
		// hot-swap: 캐시 히트
		plugin.indexer = cached;
		setIndexingStatus('ready');
		debugLogger.logSystem('rag', `Project index hot-swap: ${newProjectId} (cached)`);

		// watch 모드면 이벤트 재등록
		if (plugin.settings.rag.syncMode === 'watch') {
			plugin.watchManager.registerWatchEvents();
		}
		return;
	}

	// 캐시 미스: 새 인덱서 생성
	// embeddingWorker가 있으면 재사용, 없으면 전체 초기화
	if (!plugin.embeddingWorker && plugin.settings.connections.embedding.mode !== 'custom') {
		// auto 모드 & 워커 없음 → 전체 재초기화
		await initEmbeddingWorker(plugin, false, true);
		return;
	}

	// 워커는 살아있으므로 인덱서만 새로 생성
	const { embedding, providers } = plugin.settings.connections;
	let embedFn: (texts: string[]) => Promise<number[][]>;
	let modelName = DEFAULT_EMBEDDING_MODEL;

	if (embedding.mode === 'custom' && embedding.providerId && embedding.modelId) {
		modelName = embedding.modelId;
		const providerConfig = providers.find(p => p.id === embedding.providerId);
		if (!providerConfig) {
			debugLogger.logError('rag', new Error('switchProjectIndex: 임베딩 프로바이더를 찾을 수 없습니다.'));
			return;
		}
		const provider = createProvider(providerConfig);
		embedFn = (texts: string[]) => provider.embed(texts, { model: modelName });
	} else {
		const worker = plugin.embeddingWorker;
		if (!worker) return;
		embedFn = (texts: string[]) => worker.embed(texts);
	}

	const project = getActiveProject();

	// IndexedDB 임베딩 저장소 초기화 (프로젝트별 격리)
	const embeddingStore = new EmbeddingStore();
	await embeddingStore.init(modelName, newProjectId);

	const newIndexer = new VaultIndexer({
		app: plugin.app,
		embedFn,
		parseBinaryFn: plugin.embeddingWorker
			? (buffer, ext) => plugin.embeddingWorker!.parse(buffer, ext)
			: () => Promise.resolve(''),
		settings: plugin.settings.rag,
		includedPaths: project.ragIncludedPaths,
		excludedPaths: project.ragExcludedPaths,
		chatHistoryPath: plugin.settings.chat.historyPath,
		modelName,
		projectId: newProjectId,
		embeddingStore,
		persistCacheFn: plugin.embeddingWorker ? () => plugin.embeddingWorker!.persistCache() : undefined,
	});

	plugin.indexer = newIndexer;
	projectIndexCache.set(newProjectId, newIndexer);

	const { syncMode } = plugin.settings.rag;
	new Notice(t('settings.rag.init.indexingVault'), 2000);

	const indexPromise = newIndexer.updateIndex();
	indexPromise
		.then(() => {
			new Notice(t('settings.rag.init.ready'), 3000);
		})
		.catch((err: Error) => {
			new Notice(t('settings.rag.init.indexFail', { error: err.message }), 5000);
			debugLogger.logError('rag', err);
		})
		.finally(() => {
			if (syncMode === 'watch') {
				plugin.watchManager.registerWatchEvents();
			}
		});
}