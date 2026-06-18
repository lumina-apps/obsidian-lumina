/** Obsidian 설정 탭 열기 */
import type { App } from "obsidian";

export function openSettingsTab(app: App, tabId: string = "lumina"): void {
	const appWithSettings = app as unknown as {
		setting?: { open(): void; openTabById(id: string): void };
	};
	if (appWithSettings.setting) {
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(tabId);
	}
}
