import { Notice, Setting, ButtonComponent } from 'obsidian';
import { ProjectSettingsModal } from '../../../features/projects/ui/ProjectSettingsModal';
import type { LuminaSettingTab } from '../settingTab';
import { wrapAsync, addSliderWithInput } from '../../../shared/utils/settingHelpers';
import { t } from '../../../shared/locales/helpers';
import { indexingState } from '../../store/ragStore';
import { ConfirmModal } from '../../../shared/utils/modal';
import { syncProjectStore } from '../../../core/store/projectStore';

/** 경로 설정 변경 후 자동 재인덱싱 디바운스 타이머 */
let pathChangeDebounceTimer: number | null = null;
const PATH_CHANGE_DEBOUNCE_MS = 1500;

/**
 * 경로 설정(includedPaths / excludedPaths) 변경 시 호출.
 * 1.5초 디바운스 후 indexVault()를 실행하여 변경 사항을 즉시 반영합니다.
 */
function triggerReindexAfterPathChange(tab: LuminaSettingTab): void {
	if (pathChangeDebounceTimer !== null) {
		window.clearTimeout(pathChangeDebounceTimer);
	}
	pathChangeDebounceTimer = window.setTimeout(() => {
		pathChangeDebounceTimer = null;
		if (!tab.plugin.indexer) return;
		new Notice(t('settings.rag.reindex.started'), 2000);
		tab.plugin.indexer.updateIndex()
			.then(() => {
				new Notice(t('settings.rag.reindex.success'), 3000);
			})
			.catch((err: Error) => {
				new Notice(`${t('settings.rag.reindex.fail')}${err.message}`, 5000);
			});
	}, PATH_CHANGE_DEBOUNCE_MS);
}

export function renderRagTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.rag;
	const ragEnabled = tab.plugin.settings.connections.ragEnabled;

	// 임베딩 모델 위치 안내
	tab.infoBox(
		el,
		t('settings.rag.embeddingWarning'),
		'info'
	);

	if (!ragEnabled) {
		tab.infoBox(el, t('settings.rag.disabledWarning'), 'warning');
	}

	// ── 프로젝트 관리 ──────────────────────────────────────────────────────
	tab.sectionHeading(el, t('projects.settings.title') || '프로젝트');

	const projects = tab.plugin.settings.projects;

	// 프로젝트 목록 렌더링
	for (const project of [...projects.list]) {
		const isDefault = project.id === 'default';
		const isActive = projects.activeProjectId === project.id;

		const card = el.createDiv({ cls: `lumina-feature-card${isActive ? ' is-active' : ''}` });
		
		const displayName = (project.id === 'default' && project.name === 'Default') ? (t('projects.settings.defaultProjectName') || 'Default Project') : project.name;

		const setting = new Setting(card)
			.setName(displayName + (isActive ? ' ✓' : ''))
			.setDesc(
				isDefault
					? (t('projects.settings.defaultDesc') || '기본 프로젝트 — RAG 및 히스토리 전역 설정 사용')
					: (project.historySubfolder
						? `${t('projects.settings.historyPath') || '히스토리'}: ${project.historySubfolder}`
						: (t('projects.settings.noSubfolder') || '히스토리: 전역 경로 사용'))
			);

		// 활성 전환 버튼
		if (!isActive) {
			setting.addButton(btn => {
				btn.setButtonText(t('projects.settings.activate') || '전환')
					.onClick(async () => {
						projects.activeProjectId = project.id;
						await tab.saveAndSync();
						syncProjectStore(projects.list, projects.activeProjectId);
						tab.plugin.refreshSettingTab();
						// RAG 인덱서 hot-swap
						if (tab.plugin.settings.connections.ragEnabled) {
							const { switchProjectIndex } = await import('../../../features/rag/ragInitializer');
							void switchProjectIndex(tab.plugin, project.id);
						}
					});
			});
		}

		// 설정 버튼
		setting.addButton(btn => {
			btn.setIcon('settings')
				.setTooltip('프로젝트 설정')
				.onClick(() => {
					new ProjectSettingsModal(tab.plugin, project).open();
				});
		});

		// 삭제 버튼
		if (!isDefault) {
			setting.addButton(btn => {
				btn.setIcon('trash')
					.setTooltip(t('common.delete') || '삭제')
					.setWarning()
					.onClick(() => {
						new ConfirmModal(
							tab.plugin.app,
							t('projects.settings.deleteConfirmTitle') || '프로젝트 삭제',
							(t('projects.settings.deleteConfirmDesc') || '\"{name}\" 프로젝트를 삭제하시겠습니까? 히스토리 파일은 삭제되지 않습니다.').replace('{name}', project.name),
							async () => {
								projects.list = projects.list.filter(p => p.id !== project.id);
								if (projects.activeProjectId === project.id) {
									projects.activeProjectId = 'default';
								}
								const { projectIndexCache } = await import('../../../features/rag/projectIndexCache');
								projectIndexCache.delete(project.id);
								await tab.saveAndSync();
								syncProjectStore(projects.list, projects.activeProjectId);
								tab.plugin.refreshSettingTab();
							},
						).open();
					});
			});
		}
	}

	// 새 프로젝트 추가
	new Setting(el)
		.setName(t('projects.settings.newProjectTitle') || '새 프로젝트 추가')
		.setDesc(t('projects.settings.addProjectDesc') || '새로운 프로젝트를 생성하고 RAG 및 채팅 설정을 구성합니다.')
		.addButton(btn => {
			btn.setButtonText(t('projects.settings.addProjectBtn') || '+ 새 프로젝트 만들기')
				.setCta()
				.onClick(() => {
					new ProjectSettingsModal(tab.plugin).open();
				});
		});

	// ── 고급 ─────────────────────────────────────────────────────────────
	if (tab.showAdvanced) {
		tab.advancedLabel(el);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.chunking.parentSizeName'))
				.setDesc(t('settings.rag.chunking.parentSizeDesc')),
			{ min: 1000, max: 3000, step: 100, value: s.parentChunkSize },
			wrapAsync(async (val) => { s.parentChunkSize = val; await tab.saveAndSync(); }),
		);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.chunking.parentOverlapName'))
				.setDesc(t('settings.rag.chunking.parentOverlapDesc')),
			{ min: 0, max: 500, step: 50, value: s.parentChunkOverlap },
			wrapAsync(async (val) => { s.parentChunkOverlap = val; await tab.saveAndSync(); }),
		);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.chunking.childSizeName'))
				.setDesc(t('settings.rag.chunking.childSizeDesc')),
			{ min: 100, max: 500, step: 10, value: s.childChunkSize },
			wrapAsync(async (val) => { s.childChunkSize = val; await tab.saveAndSync(); }),
		);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.chunking.childOverlapName'))
				.setDesc(t('settings.rag.chunking.childOverlapDesc')),
			{ min: 0, max: 100, step: 10, value: s.childChunkOverlap },
			wrapAsync(async (val) => { s.childChunkOverlap = val; await tab.saveAndSync(); }),
		);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.topK.name'))
				.setDesc(t('settings.rag.topK.desc')),
			{ min: 1, max: 20, step: 1, value: s.topK },
			wrapAsync(async (val) => { s.topK = val; await tab.saveAndSync(); }),
		);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.minSimilarity.name'))
				.setDesc(t('settings.rag.minSimilarity.desc')),
			{ min: 0, max: 1, step: 0.05, value: s.minSimilarity },
			wrapAsync(async (val) => { s.minSimilarity = val; await tab.saveAndSync(); }),
		);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.maxFileSize.name'))
				.setDesc(t('settings.rag.maxFileSize.desc')),
			{ min: 0, max: 500, step: 5, value: s.maxFileSizeMB },
			wrapAsync(async (val) => {
				s.maxFileSizeMB = val;
				await tab.saveAndSync();
				if (tab.plugin.indexer) triggerReindexAfterPathChange(tab);
			}),
		);

		new Setting(el)
			.setName(t('settings.rag.syncMode.name'))
			.setDesc(t('settings.rag.syncMode.desc'))
			.addDropdown(drop => {
				drop
					.addOption('watch', t('settings.rag.syncMode.watch'))
					.addOption('on-start', t('settings.rag.syncMode.startup'))
					.addOption('manual', t('settings.rag.syncMode.manual'))
					.setValue(s.syncMode)
					.onChange(wrapAsync(async (val) => {
						s.syncMode = val as typeof s.syncMode;
						await tab.saveAndSync();
					}));
			});

		// ── 인덱싱 상태 표시 (실제 indexer 데이터 연결) ──────────────────
		tab.sectionHeading(el, t('settings.rag.status.name'));
		const statusEl = el.createDiv({ cls: 'lumina-rag-status' });

		if (tab.unsubscribeRagState) {
			tab.unsubscribeRagState();
		}

		tab.unsubscribeRagState = indexingState.subscribe(ragState => {
			statusEl.empty();
			const indexedCount = tab.plugin.indexer?.indexedFileCount ?? 0;
			statusEl.createEl('p', {
				text: ragState.status === 'ready'
					? t('settings.rag.status.files', { count: String(indexedCount) })
					: `📄 ${t('settings.rag.status.statusLabel')}: ${ragState.status === 'indexing' ? t('settings.rag.status.indexing', { processed: String(ragState.processedFiles), total: String(ragState.totalFiles) }) : ragState.status}`,
			});
		});

		// 수동 재인덱싱 및 초기화 버튼
		const actionSetting = new Setting(el);
		actionSetting.settingEl.addClass('lumina-setting-cta');
		actionSetting
			.addButton(btn => {
				btn.setButtonText(t('settings.rag.reindex.button')).setCta().onClick(wrapAsync(async () => {
					if (!tab.plugin.indexer) {
						new Notice(t('settings.rag.reindex.notActivated'));
						return;
					}
					new Notice(t('settings.rag.reindex.started'), 2000);
					try {
						await tab.plugin.indexer.resetIndex();
						await tab.plugin.indexer.indexVault();
						new Notice(t('settings.rag.reindex.success'), 3000);
						tab.refreshDisplay();
					} catch (err) {
						new Notice(`${t('settings.rag.reindex.fail')}${(err as Error).message}`, 5000);
					}
				}));
			})
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText(t('settings.rag.reset.button'));
				const btnCompat = btn as unknown as { setDestructive?: () => void; setWarning?: () => void };
				if (typeof btnCompat.setDestructive === 'function') {
					btnCompat.setDestructive();
				} else if (typeof btnCompat.setWarning === 'function') {
					btnCompat.setWarning();
				}
				btn.onClick(() => {
					if (!tab.plugin.indexer) {
						new Notice(t('settings.rag.reindex.notActivated'));
						return;
					}
					new ConfirmModal(
						tab.app,
						t('settings.rag.reset.button'),
						t('settings.rag.reset.resetConfirm'),
						wrapAsync(async () => {
							if (tab.plugin.indexer) {
								await tab.plugin.indexer.resetIndex();
								new Notice(t('settings.rag.reset.resetSuccess'), 3000);
								tab.refreshDisplay();
							}
						})
					).open();
				});
			});

		actionSetting.settingEl.setCssStyles({ borderTop: 'none', padding: '0', marginTop: '-10px' }); // 좀 더 위로 붙이기
	}
}
