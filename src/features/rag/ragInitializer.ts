/**
 * ragInitializer.ts
 *
 * RAG (Retrieval-Augmented Generation) 임베딩 워커 + 인덱서 초기화 모듈.
 * main.ts의 initEmbeddingWorker 메서드(~180줄)를 분리하여
 * LuminaPlugin의 오케스트레이션 부담을 줄입니다.
 *
 * - 임베딩 워커 초기화 (auto/custom)
 * - 대규모 볼트 병렬 워커 처리
 * - VaultIndexer 생성 및 인덱싱 시작
 * - watch/on-start/manual sync 모드 처리
 */

import { Notice, Platform } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import { createProvider } from '../../core/llm-providers';
import { EmbeddingWorkerBridge } from './workerBridge';
import { getModelCacheDir } from './storage';
import { VaultIndexer } from './indexer';
import { setIndexingStatus } from '../../core/store/ragStore';
import { debugLogger } from '../../shared/debugLogger';
import type LuminaPlugin from '../../main';

/**
 * 기본 임베딩 모델 (원클릭 RAG auto 모드).
 * 한국어 포함 다국어 지원.
 */
export const DEFAULT_EMBEDDING_MODEL = 'ibm-granite/granite-embedding-97m-multilingual-r2';

/**
 * 이 파일 수 이상일 때 두 번째 임베딩 워커를 임시로 띄워 병렬 처리합니다.
 * 워커 1개당 ONNX 모델이 RAM에 추가 로드되므로 너무 작은 값은 피합니다.
 */
const PARALLEL_WORKER_THRESHOLD = 5000;

/**
 * RAG 임베딩 워커를 초기화하고, 완료 후 VaultIndexer를 생성하여 인덱싱을 시작합니다.
 * 설정에서 ragEnabled를 켤 때 settingTab이 직접 호출합니다.
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

			// 항상 pluginDir을 전달합니다.
			// 로컬에 WASM 파일이 있으면 우선 사용하고, 없으면 Worker에서 CDN 폴백을 시도합니다.
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
			embedFn = (texts: string[]) => plugin.embeddingWorker!.embed(texts);
		}

		// ── 대규모 볼트: 두 번째 워커를 임시로 띄워 병렬 임베딩 ─────────────────
		// 파일 수가 PARALLEL_WORKER_THRESHOLD 이상이면 워커 2개로 분산 처리.
		// 작은 볼트는 단일 워커로 충분하며, 추가 RAM 부담을 피합니다.
		const targetFileCount = plugin.app.vault.getMarkdownFiles().length;
		let secondaryWorker: EmbeddingWorkerBridge | null = null;

		if (embedding.mode !== 'custom' && targetFileCount >= PARALLEL_WORKER_THRESHOLD) {
			try {
				const cacheDir2 = getModelCacheDir(plugin.app);
				const pluginDir2 = plugin.app.vault.adapter.getResourcePath(plugin.manifest.dir || '');

				secondaryWorker = new EmbeddingWorkerBridge();
				await secondaryWorker.init(modelName, cacheDir2, pluginDir2);

				// 라운드로빈: 요청을 두 워커에 교대로 분배
				let turn = 0;
				const primaryEmbed = embedFn;
				const secondaryEmbed = (texts: string[]) => secondaryWorker!.embed(texts);
				embedFn = (texts: string[]) => {
					const useSecondary = (turn++ % 2 === 1);
					return useSecondary ? secondaryEmbed(texts) : primaryEmbed(texts);
				};
				debugLogger.logSystem('rag', `대규모 볼트(${targetFileCount}개 파일) 감지 → 워커 2개 병렬 모드 활성화`);
			} catch (workerErr) {
				// 두 번째 워커 초기화 실패 시 단일 워커로 폴백
				debugLogger.logError('rag', workerErr instanceof Error ? workerErr : new Error(`보조 워커 초기화 실패, 단일 워커로 폴백: ${workerErr}`));
				secondaryWorker?.terminate();
				secondaryWorker = null;
			}
		}

		progressNotice?.hide();

		// ── 인덱서 생성 (modelName 전달 → 스키마 무효화 감지) ─────────────
		plugin.indexer = new VaultIndexer(
			plugin.app,
			embedFn,
			(buffer, ext) => plugin.embeddingWorker!.parse(buffer, ext),
			plugin.settings.rag,
			modelName,
		);

		if (!isStartup) progressNotice?.setMessage(t('settings.rag.init.indexingVault'));

		const { syncMode } = plugin.settings.rag;

		if (syncMode === 'watch' || syncMode === 'on-start') {
			if (!isStartup || isFirstRun) new Notice(t('settings.rag.init.indexingVault'), 2000);

			// 최초 실행일 경우 전체 볼트 인덱싱(indexVault) 강제 실행, 아닐 경우 증분 업데이트(updateIndex) 실행
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
					// 인덱싱 완료(성공/실패 무관) 후 보조 워커 즉시 해제 → RAM 반환
					if (secondaryWorker) {
						secondaryWorker.terminate();
						secondaryWorker = null;
						debugLogger.logSystem('rag', '보조 워커 종료 완료 (RAM 반환)');
					}

					// watch 모드: 초기 인덱싱 완료 후에만 파일 변경 이벤트 등록
					// (인덱싱 중 watch 발동 시 currentProcessId 증가로 indexVault가 조기 종료되는 레이스 컨디션 방지)
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
		// 임베딩 워커 초기화 실패 시 RAG 토글을 false로 되돌려 UI 불일치 방지
		if (plugin.settings.connections.ragEnabled) {
			plugin.settings.connections.ragEnabled = false;
			await plugin.saveSettings();
			plugin.refreshSettingTab();
		}
	}
}