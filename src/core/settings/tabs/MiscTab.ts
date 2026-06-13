import { Notice, Setting, Platform, ButtonComponent } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { t, setLanguage } from '../../../shared/locales/helpers';
import { wrapAsync } from '../settingTab';
import { ConfirmModal } from '../../../shared/utils/modal';
import { debugLogger } from '../../../shared/debugLogger';
import { resetIndexing } from '../../store/ragStore';
import { loadSystemLocaleCache } from '../../../shared/locales/translator';

export function renderMiscTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.misc;

	// ── 일반 ─────────────────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.misc.contextMenu.name'));

	new Setting(el)
		.setName(t('settings.misc.contextMenu.name'))
		.setDesc(t('settings.misc.contextMenu.desc'))
		.addToggle(toggle => {
			toggle.setValue(s.contextMenuEnabled).onChange(async (val) => {
				s.contextMenuEnabled = val;
				await tab.saveAndSync();
			});
		});

	new Setting(el)
		.setName(t('settings.misc.ribbonIcon.name'))
		.setDesc(t('settings.misc.ribbonIcon.desc'))
		.addToggle(toggle => {
			toggle.setValue(s.showRibbonIcon).onChange(async (val) => {
				s.showRibbonIcon = val;
				await tab.saveAndSync();
				// 재시작 없이 즉시 반영
				tab.plugin.updateRibbonIcon();
			});
		});


	// ── 고급 ─────────────────────────────────────────────────────────────
	if (tab.showAdvanced) {
		tab.advancedLabel(el);

		new Setting(el)
			.setName(t('settings.misc.frontmatter.name'))
			.setDesc(t('settings.misc.frontmatter.desc'))
			.addToggle(toggle => {
				toggle.setValue(s.autoFrontmatter).onChange(async (val) => {
					s.autoFrontmatter = val;
					await tab.saveAndSync();

					if (val) {
						tab.plugin.registerFrontmatterEvents();
					} else {
						tab.plugin.clearFrontmatterEvents();
					}

					tab.refreshDisplay();
				});
			});



		new Setting(el)
			.setName(t('settings.misc.debugMode.name'))
			.setDesc(t('settings.misc.debugMode.desc'))
			.addToggle(toggle => {
				toggle.setValue(s.debugMode).onChange(async (val) => {
					s.debugMode = val;
					await tab.saveAndSync();
					// 토글에 따라 DevLog 패널 자동 열기/닫기
					if (val) {
						void tab.plugin.activateDebugView();
					} else {
						tab.plugin.closeDebugView();
					}
				});
			});

		// 버전 정보
		tab.sectionHeading(el, t('settings.misc.versionInfo.name'));
		const { version } = (tab.app as unknown as { plugins: { manifests: Record<string, { version?: string }> } }).plugins.manifests['lumina'] ?? { version: '—' };
		new Setting(el)
			.setName(`Lumina v${version}`)
			.setDesc(t('settings.misc.versionInfo.desc'))
			.addButton(btn => {
				btn.setButtonText('GitHub →').onClick(() => {
					window.open('https://github.com/lumina-apps/obsidian-lumina/releases', '_blank');
				});
			});

		// 데이터 초기화
		new Setting(el)
			.setName(t('settings.misc.factoryReset.name'))
			.setDesc(t('settings.misc.factoryReset.desc'))
			.addButton(btn => {
				btn.setButtonText(t('settings.misc.factoryReset.button'));
				const customBtn = btn as ButtonComponent & { setDestructive?: () => ButtonComponent };
				if (typeof customBtn.setDestructive === 'function') {
					customBtn.setDestructive();
				} else {
					customBtn.setWarning();
				}
				btn.onClick(wrapAsync(async () => {
					new ConfirmModal(
						tab.app,
						t('settings.misc.factoryReset.confirmTitle'),
						t('settings.misc.factoryReset.confirmMsg'),
						wrapAsync(async () => {
							// 워커 및 인덱서 정리
							if (tab.plugin.embeddingWorker) {
								tab.plugin.embeddingWorker.terminate();
								tab.plugin.embeddingWorker = null;
							}
							tab.plugin.indexer = null;

							// 인덱스 및 다운로드된 모델(storage 폴더) 삭제
							try {
								const storagePath = `${tab.app.vault.configDir}/plugins/lumina/storage`;
								if (await tab.app.vault.adapter.exists(storagePath)) {
									await tab.app.vault.adapter.rmdir(storagePath, true);
								}
							} catch (e) {
								debugLogger.logError('system', e instanceof Error ? e : new Error(`스토리지 삭제 실패: ${e}`));
							}

							// 언어 번역 캐시(locales 폴더) 삭제
							try {
								const localesPath = `${tab.app.vault.configDir}/plugins/lumina/locales`;
								if (await tab.app.vault.adapter.exists(localesPath)) {
									await tab.app.vault.adapter.rmdir(localesPath, true);
								}
							} catch (e) {
								debugLogger.logError('system', e instanceof Error ? e : new Error(`번역 캐시 삭제 실패: ${e}`));
							}

							// 설정 초기화 (빈 데이터를 저장하여 다음 로드나 loadSettings 시 isFirstRun이 true가 되도록 유도)
							await tab.plugin.saveData({});
							await tab.plugin.loadSettings();

							// RAG 인덱싱 상태 초기화 및 자동 재인덱싱
							resetIndexing();
							if (tab.plugin.settings.connections.ragEnabled) {
								if (Platform.isMobile && tab.plugin.settings.connections.embedding.mode === 'auto') {
									new Notice(t('uiMessages.noticeMobileRag'), 10000);
								} else {
									tab.plugin.initEmbeddingWorker(false, true).catch(console.error);
								}
							}

							// UI 업데이트 반영
							tab.plugin.updateRibbonIcon();
							tab.plugin.closeDebugView();

							// 언어 설정 다시 반영 (loadSettings에서 감지된 언어로 즉시 전환)
							if (tab.plugin.settings.connections.language === 'system') {
								const success = await loadSystemLocaleCache(tab.app);
								if (success) {
									setLanguage('system');
								} else {
									setLanguage('en');
								}
							} else {
								setLanguage(tab.plugin.settings.connections.language);
							}

							new Notice(t('settings.misc.factoryReset.success'), 3000);
							tab.refreshDisplay();
						})
					).open();
				}));
			});
	}
}
