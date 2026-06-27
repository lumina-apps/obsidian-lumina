import { Notice, Setting, Platform, ButtonComponent, SliderComponent, TextComponent } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { t, setLanguage } from '../../../shared/locales/helpers';
import { wrapAsync } from '../../../shared/utils/settingHelpers';
import { ConfirmModal } from '../../../shared/utils/modal';
import { debugLogger } from '../../../shared/debugLogger';
import { resetIndexing } from '../../store/ragStore';
import { loadSystemLocaleCache } from '../../../shared/locales/translator';
import { initEmbeddingWorker } from '../../../features/rag/ragInitializer';
import { activateView, closeView } from '../../views/viewHelper';
import { DEBUG_VIEW_TYPE } from '../../../features/debug/debugView';

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


	// ── Canvas 시각화 설정 ────────────────────────────────────────────────────
	const cs = tab.plugin.settings.canvas;
	tab.sectionHeading(el, t('canvas.menuItem'));

	let depthSlider: SliderComponent;
	let depthText: TextComponent;
	new Setting(el)
		.setName(t('canvas.settings.depth.name'))
		.setDesc(t('canvas.settings.depth.desc'))
		.addSlider(slider => {
			depthSlider = slider;
			slider
				.setLimits(1, 5, 1)
				.setValue(cs.depth)
				.onChange(async (val) => {
					cs.depth = val;
					depthText.setValue(val.toString());
					await tab.saveAndSync();
				});
		})
		.addText(text => {
			depthText = text;
			text
				.setValue(cs.depth.toString())
				.onChange(async (val) => {
					const num = parseInt(val, 10);
					if (!isNaN(num) && num >= 1 && num <= 5) {
						cs.depth = num;
						depthSlider.setValue(num);
						await tab.saveAndSync();
					}
				});
			text.inputEl.type = 'number';
			text.inputEl.setCssStyles({ width: '50px' });
		});

	new Setting(el)
		.setName(t('canvas.settings.layout.name'))
		.setDesc(t('canvas.settings.layout.desc'))
		.addDropdown(dd => {
			dd.addOption('radial', t('canvas.settings.layout.radial'));
			dd.addOption('tree', t('canvas.settings.layout.tree'));
			dd.setValue(cs.layout).onChange(async (val) => {
				cs.layout = val as 'radial' | 'tree';
				await tab.saveAndSync();
			});
		});

	new Setting(el)
		.setName(t('canvas.settings.bidirectional.name'))
		.setDesc(t('canvas.settings.bidirectional.desc'))
		.addToggle(toggle => {
			toggle.setValue(cs.bidirectional).onChange(async (val) => {
				cs.bidirectional = val;
				await tab.saveAndSync();
			});
		});

	new Setting(el)
		.setName(t('canvas.settings.includeAttachments.name'))
		.setDesc(t('canvas.settings.includeAttachments.desc'))
		.addToggle(toggle => {
			toggle.setValue(cs.includeAttachments).onChange(async (val) => {
				cs.includeAttachments = val;
				await tab.saveAndSync();
			});
		});

	let maxNodesSlider: SliderComponent;
	let maxNodesText: TextComponent;
	new Setting(el)
		.setName(t('canvas.settings.maxNodes.name'))
		.setDesc(t('canvas.settings.maxNodes.desc'))
		.addSlider(slider => {
			maxNodesSlider = slider;
			slider
				.setLimits(20, 500, 10)
				.setValue(cs.maxNodes)
				.onChange(async (val) => {
					cs.maxNodes = val;
					maxNodesText.setValue(val.toString());
					await tab.saveAndSync();
				});
		})
		.addText(text => {
			maxNodesText = text;
			text
				.setValue(cs.maxNodes.toString())
				.onChange(async (val) => {
					const num = parseInt(val, 10);
					if (!isNaN(num) && num >= 20 && num <= 500) {
						cs.maxNodes = num;
						maxNodesSlider.setValue(num);
						await tab.saveAndSync();
					}
				});
			text.inputEl.type = 'number';
			text.inputEl.setCssStyles({ width: '60px' });
		});

	let folderDepthSlider: SliderComponent;
	let folderDepthText: TextComponent;
	new Setting(el)
		.setName(t('canvas.settings.folderDepth.name'))
		.setDesc(t('canvas.settings.folderDepth.desc'))
		.addSlider(slider => {
			folderDepthSlider = slider;
			slider
				.setLimits(0, 3, 1)
				.setValue(cs.folderDepth)
				.onChange(async (val) => {
					cs.folderDepth = val;
					folderDepthText.setValue(val.toString());
					await tab.saveAndSync();
				});
		})
		.addText(text => {
			folderDepthText = text;
			text
				.setValue(cs.folderDepth.toString())
				.onChange(async (val) => {
					const num = parseInt(val, 10);
					if (!isNaN(num) && num >= 0 && num <= 3) {
						cs.folderDepth = num;
						folderDepthSlider.setValue(num);
						await tab.saveAndSync();
					}
				});
			text.inputEl.type = 'number';
			text.inputEl.setCssStyles({ width: '50px' });
		});

	new Setting(el)
		.setName(t('canvas.settings.outputPath.name'))
		.setDesc(t('canvas.settings.outputPath.desc'))
		.addText(text => {
			text
				.setPlaceholder('canvasVisualize')
				.setValue(cs.outputPath)
				.onChange(async (val) => {
					cs.outputPath = val.trim() || 'canvasVisualize';
					await tab.saveAndSync();
				});
		});

	new Setting(el)
		.setName(t('canvas.settings.showFolderGroups.name'))
		.setDesc(t('canvas.settings.showFolderGroups.desc'))
		.addToggle(toggle => {
			toggle.setValue(cs.showFolderGroups).onChange(async (val) => {
				cs.showFolderGroups = val;
				await tab.saveAndSync();
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
					tab.plugin.frontmatterManager.registerEvents();
				} else {
					tab.plugin.frontmatterManager.clearEvents();
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
						void activateView(tab.plugin.app.workspace, DEBUG_VIEW_TYPE);
					} else {
						closeView(tab.plugin.app.workspace, DEBUG_VIEW_TYPE);
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
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText(t('settings.misc.factoryReset.button'));
				const btnCompat = btn as unknown as { setDestructive?: () => void; setWarning?: () => void };
				if (typeof btnCompat.setDestructive === 'function') {
					btnCompat.setDestructive();
				} else if (typeof btnCompat.setWarning === 'function') {
					btnCompat.setWarning();
				}
				btn.onClick(wrapAsync(async () => {
					new ConfirmModal(
						tab.app,
						t('settings.misc.factoryReset.confirmTitle'),
						t('settings.misc.factoryReset.confirmMsg'),
						wrapAsync(async () => {
							// 워커 및 인덱서 정리
							if (tab.plugin.indexer) {
								tab.plugin.indexer.destroy();
								tab.plugin.indexer = null;
							}
							if (tab.plugin.embeddingWorker) {
								tab.plugin.embeddingWorker.terminate();
								tab.plugin.embeddingWorker = null;
							}

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
									initEmbeddingWorker(tab.plugin, false, true).catch(console.error);
								}
							}

							// UI 업데이트 반영
							tab.plugin.updateRibbonIcon();
							closeView(tab.plugin.app.workspace, DEBUG_VIEW_TYPE);

							// 언어 설정 다시 반영 (loadSettings에서 감지된 언어로 즉시 전환)
							if (tab.plugin.settings.connections.language === 'system') {
								const success = await loadSystemLocaleCache(tab.app);
								if (success) {
									await setLanguage('system');
								} else {
									await setLanguage('en');
								}
							} else {
								await setLanguage(tab.plugin.settings.connections.language);
							}

							new Notice(t('settings.misc.factoryReset.success'), 3000);
							tab.refreshDisplay();
						})
					).open();
				}));
			});
	}
}
