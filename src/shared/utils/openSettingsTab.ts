/**
 * openSettingsTab.ts
 *
 * Obsidian 설정 탭을 여는 유틸리티 함수.
 * `plugin.app`의 App 타입을 우회하지 않고 안전하게 설정 탭을 엽니다.
 */

import type { App } from "obsidian";

/**
 * Obsidian 설정 화면을 열고 지정된 탭으로 이동합니다.
 *
 * @param app - Obsidian App 인스턴스
 * @param tabId - 설정 탭 ID (기본값: "lumina")
 */
export function openSettingsTab(app: App, tabId: string = "lumina"): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const appWithSettings = app as App & {
		setting?: { open(): void; openTabById(id: string): void };
	};
	if (appWithSettings.setting) {
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(tabId);
	}
}