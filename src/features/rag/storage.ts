/**
 * 플러그인 스토리지 경로 계산 유틸.
 * 모델 캐시 경로 및 볼트 식별자 등을 반환합니다.
 */

import { type App, Platform } from 'obsidian';
import { FileSystemAdapter } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import { hashString } from '../../shared/utils/hash';

let nodePath: typeof import('path') | null = null;
if (Platform.isDesktop) {
	nodePath = (window as unknown as { require: (module: string) => typeof import('path') }).require('path');
}

const PLUGIN_ID = 'lumina';

/** 볼트 절대 경로 */
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
	const configDir = app.vault.configDir;
	if (Platform.isDesktop && nodePath) {
		// path.join은 Windows에서 백슬래시 반환 → 슬래시로 일괄 변환
		return nodePath.join(base, configDir, 'plugins', PLUGIN_ID).replace(/\\/g, '/');
	}
	return `${base}/${configDir}/plugins/${PLUGIN_ID}`;
}

/** 모델 캐시 디렉토리 절대 경로 */
export function getModelCacheDir(app: App): string {
	if (Platform.isDesktop && nodePath) {
		return nodePath.join(getPluginDir(app), 'storage', 'models');
	}
	return `${getPluginDir(app)}/storage/models`;
}

/** 볼트별 고유 식별자 반환 (IndexedDB 볼트 간 격리용) */
export function getVaultId(app: App): string {
	const rawAppId = (app as unknown as { appId?: unknown }).appId;
	if (typeof rawAppId === 'string' && rawAppId.trim().length > 0) {
		return rawAppId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
	}
	const adapter = app.vault?.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return hashString(adapter.getBasePath()).toString(36);
	}
	if (typeof app.vault?.getName === 'function') {
		const name = app.vault.getName().trim();
		if (name.length > 0) {
			return hashString(name).toString(36);
		}
	}
	return 'default-vault';
}
