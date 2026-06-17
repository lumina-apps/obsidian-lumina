/**
 * connectionNoticeUtils.ts
 *
 * Provider 연결 상태 Notice 및 UI 갱신 헬퍼.
 * 설정 UI 렌더링이 아닌 "Provider/Connection 상태 알림" 관심사에 집중합니다.
 *
 * 이전에는 settingsUIHelpers.ts에 통합되어 있었으나,
 * 관심사 분리를 위해 독립 모듈로 추출되었습니다.
 */

import { Notice } from 'obsidian';
import type { LLMProviderConfig, ProviderType } from '../types/settings.types';
import { PROVIDER_LABELS, PROVIDER_CATEGORIES } from '../types/settings.types';
import { t } from '../locales/helpers';

// ─── t with loose key typing for keys not yet in TranslationKeys ──────────────

const _t = t as (key: string, params?: Record<string, string | number>) => string;

// ═══════════════════════════════════════════════════════════════════════════════
// Notice helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Provider 검증 성공 시 표시할 Notice
 */
export function showConnectionSuccess(providerName: string): void {
	new Notice(`${_t('connection.success')}: ${providerName}`);
}

/**
 * 변경사항 동기화 실패 시 표시할 Notice
 */
export function showSyncFailNotice(): void {
	new Notice(_t('connection.syncFail'));
}

/**
 * MCP 서버와 연결 해제 시 표시할 Notice
 */
export function showDisconnectedNotice(): void {
	new Notice(_t('connection.mcpDisconnected'));
}

/**
 * MCP 서버와 연결 성공 시 표시할 Notice
 */
export function showConnectedNotice(): void {
	new Notice(_t('connection.mcpConnected'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Connection Status
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 등록된 Provider의 연결 상태와 사용 가능한 모델 수를 문자열로 반환합니다.
 * 사용처: DebugPanel.svelte
 */
export function getConnectionStatus(provider: LLMProviderConfig): string {
	if (!provider.isVerified) return _t('connections.noConnection');
	const count = provider.availableModels?.length ?? 0;
	if (count <= 0) {
		return _t('connections.availableModelsCount', { models: count.toString() });
	}
	const category = PROVIDER_CATEGORIES[provider.type];
	if (category === 'local') {
		return _t('connections.localModelsDisabled');
	}
	const providerLabel = PROVIDER_LABELS[provider.type] ?? provider.type;
	return _t('connections.connectedCountLabel', { provider: providerLabel, count: count.toString() });
}

/**
 * Provider 연결/해제 버튼을 누른 후 UI 갱신을 위한 리프레시 처리를 통합한 핸들러입니다.
 * - refreshSettingTab()이 제공되면 버튼 텍스트와 함께 UI를 즉시 갱신합니다.
 * - refreshSettingTab()이 없으면 (간헐적이지만) Notice로 결과를 안내합니다.
 */
export async function refreshAfterConnectionToggle(
	provider: LLMProviderConfig,
	refreshSettingTab?: () => void,
): Promise<void> {
	if (refreshSettingTab) {
		refreshSettingTab();
	} else {
		const providerLabel = PROVIDER_LABELS[provider.type] ?? provider.type;
		if (provider.isVerified) {
			new Notice(_t('connection.disconnected', { name: providerLabel }));
		} else {
			new Notice(_t('connection.connected', { name: providerLabel }));
		}
	}
}

/**
 * MCP 서버 연결/해제 토글 후 UI 갱신을 처리합니다.
 * @param isCurrentlyConnected - 현재 연결 상태
 * @param serverName - 서버명
 * @param refreshSettingTab - UI 갱신 함수
 */
export function refreshAfterMcpConnectionToggle(
	isCurrentlyConnected: boolean,
	serverName: string,
	refreshSettingTab: () => void,
): void {
	showDisconnectedNotice();
	setTimeout(() => {
		refreshSettingTab();
		if (isCurrentlyConnected) {
			showConnectedNotice();
		}
	}, 800);
}