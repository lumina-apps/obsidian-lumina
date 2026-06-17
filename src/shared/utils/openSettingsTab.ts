/** Obsidian 설정 탭 열기 */
import type { App } from "obsidian";

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