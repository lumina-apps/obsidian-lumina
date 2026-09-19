/** Provider 연결 상태 Notice 및 UI 갱신 헬퍼 */

import { Notice } from 'obsidian';
import type { LLMProviderConfig } from '../types/settings.types';
import { PROVIDER_LABELS, PROVIDER_CATEGORIES } from '../types/settings.types';
import { t } from '../locales/helpers';

export function showConnectionSuccess(providerName: string): void {
	new Notice(`${t('settings.connections.connectionStatus.success')}: ${providerName}`);
}

export function showSyncFailNotice(): void {
	new Notice(t('settings.connections.connectionStatus.syncFail'));
}

export function showDisconnectedNotice(): void {
	new Notice(t('settings.connections.connectionStatus.mcpDisconnected'));
}

export function showConnectedNotice(): void {
	new Notice(t('settings.connections.connectionStatus.mcpConnected'));
}

/** Provider 연결 상태와 사용 가능한 모델 수를 문자열로 반환 */
export function getConnectionStatus(provider: LLMProviderConfig): string {
	if (!provider.isVerified) return t('settings.connections.connectionStatus.noConnection');
	const count = provider.availableModels?.length ?? 0;
	if (count <= 0) {
		return t('settings.connections.connectionStatus.availableModelsCount', { models: count.toString() });
	}
	const category = PROVIDER_CATEGORIES[provider.type];
	if (category === 'local') {
		return t('settings.connections.connectionStatus.localModelsDisabled');
	}
	const providerLabel = PROVIDER_LABELS[provider.type] ?? provider.type;
	return t('settings.connections.connectionStatus.connectedCountLabel', { provider: providerLabel, count: count.toString() });
}