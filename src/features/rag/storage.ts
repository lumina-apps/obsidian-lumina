/**
 * storage.ts
 *
 * 플러그인 스토리지 경로를 계산하는 유틸리티.
 * - Obsidian의 FileSystemAdapter를 통해 볼트 절대 경로를 획득
 * - 워커 경로, 모델 캐시 경로, 히스토리 경로 등 반환
 */

import { normalizePath, type App, Platform } from 'obsidian';
import { FileSystemAdapter } from 'obsidian';
import { t } from '../../shared/locales/helpers';

let nodePath: typeof import('path') | null = null;
if (Platform.isDesktop) {
	nodePath = (window as unknown as { require: (module: string) => typeof import('path') }).require('path');
}

const PLUGIN_ID = 'lumina';

/** 볼트 절대 경로 (예: /path/to/vault) */
function getBasePath(app: App): string {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return adapter.getBasePath();
	}
	throw new Error(t('uiMessages.fsAdapterErr'));
}

/** 플러그인 디렉토리 절대 경로 */
export function getPluginDir(app: App): string {
	const base = getBasePath(app);
	const configDir = app.vault.configDir; // 예: .obsidian
	if (Platform.isDesktop && nodePath) {
		return nodePath.join(base, configDir, 'plugins', PLUGIN_ID);
	}
	return `${base}/${configDir}/plugins/${PLUGIN_ID}`;
}

/** 임베딩 워커 파일 절대 경로 */
export function getWorkerPath(app: App): string {
	if (Platform.isDesktop && nodePath) {
		return nodePath.join(getPluginDir(app), 'embedding.worker.js');
	}
	return `${getPluginDir(app)}/embedding.worker.js`;
}

/** 임베딩 워커 파일의 Vault 상대 경로 (getResourcePath 용도) */
export function getWorkerRelativePath(app: App): string {
	const configDir = app.vault.configDir; // 예: .obsidian
	return normalizePath(`${configDir}/plugins/${PLUGIN_ID}/embedding.worker.js`);
}

/** 모델 캐시 저장 절대 경로 */
export function getModelCacheDir(app: App): string {
	if (Platform.isDesktop && nodePath) {
		return nodePath.join(getPluginDir(app), 'storage', 'models');
	}
	return `${getPluginDir(app)}/storage/models`;
}

/** 벡터 DB 저장 절대 경로 */
export function getVectorDbDir(app: App): string {
	if (Platform.isDesktop && nodePath) {
		return nodePath.join(getPluginDir(app), 'storage', 'vectordb');
	}
	return `${getPluginDir(app)}/storage/vectordb`;
}

/** 채팅 기록 저장 경로 (볼트 내 상대 경로 → normalizePath 적용) */
export function getHistoryVaultPath(relativePath: string): string {
	return normalizePath(relativePath);
}
