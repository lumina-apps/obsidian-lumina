/** Provider 연결 상태 Notice 및 UI 갱신 헬퍼 */

import { Notice } from 'obsidian';
import type { LLMProviderConfig } from '../types/settings.types';
import { PROVIDER_LABELS, PROVIDER_CATEGORIES } from '../types/settings.types';
import { t } from '../locales/helpers';

const _t = t as (key: string, params?: Record<string, string | number>) => string;

export function showConnectionSuccess(providerName: string): void {
	new Notice(`${_t('settings.connections.connectionStatus.success')}: ${providerName}`);
}

export function showSyncFailNotice(): void {
	new Notice(_t('settings.connections.connectionStatus.syncFail'));
}

export function showDisconnectedNotice(): void {
	new Notice(_t('settings.connections.connectionStatus.mcpDisconnected'));
}

export function showConnectedNotice(): void {
	new Notice(_t('settings.connections.connectionStatus.mcpConnected'));
}

/** Provider 연결 상태와 사용 가능한 모델 수를 문자열로 반환 */
export function getConnectionStatus(provider: LLMProviderConfig): string {
	if (!provider.isVerified) return _t('settings.connections.connectionStatus.noConnection');
	const count = provider.availableModels?.length ?? 0;
	if (count <= 0) {
		return _t('settings.connections.connectionStatus.availableModelsCount', { models: count.toString() });
	}
	const category = PROVIDER_CATEGORIES[provider.type];
	if (category === 'local') {
		return _t('settings.connections.connectionStatus.localModelsDisabled');
	}
	const providerLabel = PROVIDER_LABELS[provider.type] ?? provider.type;
	return _t('settings.connections.connectionStatus.connectedCountLabel', { provider: providerLabel, count: count.toString() });
}

/** Provider 연결/해제 후 UI 갱신 핸들러 */
export async function refreshAfterConnectionToggle(
	provider: LLMProviderConfig,
	refreshSettingTab?: () => void,
): Promise<void> {
	if (refreshSettingTab) {
		refreshSettingTab();
	} else {
		const providerLabel = PROVIDER_LABELS[provider.type] ?? provider.type;
		if (provider.isVerified) {
			new Notice(_t('settings.connections.connectionStatus.disconnected', { name: providerLabel }));
		} else {
			new Notice(_t('settings.connections.connectionStatus.connected', { name: providerLabel }));
		}
	}
}

/** MCP 서버 연결/해제 후 UI 갱신 */
export function refreshAfterMcpConnectionToggle(
	isCurrentlyConnected: boolean,
	_serverName: string,
	refreshSettingTab: () => void,
): void {
	showDisconnectedNotice();
	window.setTimeout(() => {
		refreshSettingTab();
		if (isCurrentlyConnected) {
			showConnectedNotice();
		}
	}, 800);
}