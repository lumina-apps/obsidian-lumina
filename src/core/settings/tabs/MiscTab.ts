import { Notice, Setting, Platform, ButtonComponent, SliderComponent, TextComponent } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { t, setLanguage, removeDynamicLocale } from '../../../shared/locales/helpers';
import { wrapAsync } from '../../../shared/utils/settingHelpers';
import { normalizeError } from '../../../shared/utils/errorUtils';
import { ConfirmModal } from '../../../shared/utils/modal';
import { debugLogger } from '../../../shared/debugLogger';
import { resetIndexing } from '../../store/ragStore';
import { resetDiscoveryState } from '../../store/discoveryStore';
import { sessionProviderId, sessionModelId } from '../../store/chatStore';
import { loadSystemLocaleCache } from '../../../shared/locales/translator';
import { initEmbeddingWorker } from '../../../features/rag/ragInitializer';
import { projectIndexCache } from '../../../features/rag/projectIndexCache';
import { EmbeddingStore } from '../../../features/rag/embeddingStore';
import { getVaultId } from '../../../features/rag/storage';
import { runMigrations } from '../migrations';
import { activateView, closeView } from '../../views/viewHelper';
import { DEBUG_VIEW_TYPE } from '../../../shared/constants/viewTypes';

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

	new Setting(el)
		.setName(t('settings.misc.graphRibbonIcon.name'))
		.setDesc(t('settings.misc.graphRibbonIcon.desc'))
		.addToggle(toggle => {
			toggle.setValue(s.showGraphRibbonIcon).onChange(async (val) => {
				s.showGraphRibbonIcon = val;
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
		const { version } = (tab.app as unknown as { plugins?: { manifests?: Record<string, { version?: string }> } } | undefined)?.plugins?.manifests?.['lumina'] ?? { version: '—' };
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
							// 1. 설정 초기화 전 기존 프로젝트 ID 목록 수집 (IndexedDB 정리용)
							const projectIds = new Set<string>([
								'default',
								...(tab.plugin.settings.projects?.list?.map((p) => p.id) ?? []),
							]);

							// 2. 파일 감시, 캐시된 인덱서 및 임베딩 워커 정리 (캐시 재기록 방지)
							tab.plugin.watchManager?.clearWatchEvents();
							projectIndexCache.destroyAll();
							if (tab.plugin.indexer) {
								tab.plugin.indexer.destroy();
								tab.plugin.indexer = null;
							}
							if (tab.plugin.embeddingWorker) {
								tab.plugin.embeddingWorker.terminate(false);
								tab.plugin.embeddingWorker = null;
							}

							// 3. 모든 프로젝트의 IndexedDB 임베딩 저장소 삭제
							if (typeof indexedDB !== 'undefined') {
								const vaultId = getVaultId(tab.app);
								const dbStores: EmbeddingStore[] = [new EmbeddingStore()];
								for (const pid of projectIds) {
									dbStores.push(new EmbeddingStore(pid, vaultId));
									dbStores.push(new EmbeddingStore(pid));
								}
								for (const store of dbStores) {
									try {
										await store.clear();
									} catch (e) {
										debugLogger.logWarn('rag', `IndexedDB 삭제 실패: ${e}`);
									}
								}
							}

							// 4. 브라우저 Cache Storage 내 로컬 임베딩 모델 캐시 삭제
							if (typeof caches !== 'undefined') {
								try {
									await caches.delete('transformers-cache');
								} catch (e) {
									debugLogger.logWarn('rag', `로컬 모델 브라우저 캐시 삭제 실패: ${e}`);
								}
							}

							// 5. 인덱스 및 다운로드된 모델(storage 폴더) 삭제
							try {
								const storagePath = `${tab.app.vault.configDir}/plugins/lumina/storage`;
								if (await tab.app.vault.adapter.exists(storagePath)) {
									await tab.app.vault.adapter.rmdir(storagePath, true);
								}
							} catch (e) {
								debugLogger.logError('system', normalizeError(e, `스토리지 삭제 실패: ${e}`));
							}

							// 6. 언어 번역 캐시(locales 폴더 및 메모리 캐시) 삭제
							removeDynamicLocale('system');
							try {
								const localesPath = `${tab.app.vault.configDir}/plugins/lumina/locales`;
								if (await tab.app.vault.adapter.exists(localesPath)) {
									await tab.app.vault.adapter.rmdir(localesPath, true);
								}
							} catch (e) {
								debugLogger.logError('system', normalizeError(e, `번역 캐시 삭제 실패: ${e}`));
							}

							// 7. 프론트매터 및 MCP 매니저(내장 서버, 외부 연결, CLI 설정) 정리
							tab.plugin.frontmatterManager?.clearEvents();
							if (tab.plugin.mcpManager) {
								try {
									await tab.plugin.mcpManager.cleanupCliMcp();
								} catch (e) {
									debugLogger.logWarn('mcp', `CLI MCP 설정 정리 실패: ${e}`);
								}
								try {
									await tab.plugin.mcpManager.destroy();
								} catch (e) {
									debugLogger.logError('mcp', normalizeError(e, `MCP 매니저 종료 실패: ${e}`));
								}
							}

							// 8. SecretStorage 시크릿 일괄 삭제 후 설정 초기화
							tab.plugin.settingsManager?.clearAllSecrets();
							await tab.plugin.saveData({});
							await tab.plugin.loadSettings();

							// 9. 언어 설정 다시 반영 및 뷰/리본 로캘 갱신
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
							tab.plugin.refreshLocales?.();

							// 10. 초기 마이그레이션(기본 퀵 액션 다국어화, configDir 제외 경로 등) 및 커맨드 재등록
							if (runMigrations(tab.plugin)) {
								await tab.plugin.saveSettings();
							}
							tab.plugin.commandManager?.registerQuickActions?.();

							// 11. 런타임 스토어, 로거 및 UI 상태 초기화
							resetIndexing();
							resetDiscoveryState();
							sessionProviderId.set(null);
							sessionModelId.set(null);
							debugLogger.clear();

							tab.plugin.updateRibbonIcon?.();
							closeView(tab.plugin.app.workspace, DEBUG_VIEW_TYPE);

							// 12. RAG 자동 재인덱싱
							if (tab.plugin.settings.connections.ragEnabled) {
								if (Platform.isMobile && tab.plugin.settings.connections.embedding.mode === 'auto') {
									new Notice(t('uiMessages.noticeMobileRag'), 10000);
								} else {
									initEmbeddingWorker(tab.plugin, false, true).catch((err: unknown) => {
										debugLogger.logError('rag', normalizeError(err, `RAG 재초기화 실패: ${err}`));
									});
								}
							}

							new Notice(t('settings.misc.factoryReset.success'), 3000);
							tab.refreshDisplay();
						})
					).open();
				}));
			});
	}
}
