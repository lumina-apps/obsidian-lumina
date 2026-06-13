import { Notice, Setting, ButtonComponent } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { wrapAsync, addSliderWithInput } from '../settingTab';
import { t } from '../../../shared/locales/helpers';
import { indexingState } from '../../store/ragStore';
import { ConfirmModal } from '../../../shared/utils/modal';

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

	// ── 데이터 범위 ───────────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.rag.dataScope.name'));

	new Setting(el)
		.setName(t('settings.rag.dataScope.name'))
		.setDesc(t('settings.rag.dataScope.desc'))
		.addDropdown(drop => {
			drop
				.addOption('vault', t('settings.rag.dataScope.vaultWide'))
				.addOption('active-note', t('settings.rag.dataScope.activeNote'))
				.addOption('manual', t('settings.rag.dataScope.manual'))
				.setValue(s.dataScope)
				.onChange(async (val) => {
					s.dataScope = val as typeof s.dataScope;
					await tab.saveAndSync();
				});
		});

	new Setting(el)
		.setName(t('settings.rag.includePaths.name'))
		.setDesc(t('settings.rag.includePaths.desc'))
		.addText(text => {
			text
				.setPlaceholder('Projects, Notes')
				.setValue(s.includedPaths.join(', '))
				.onChange(async (val) => {
					s.includedPaths = val.split(',').map(v => v.trim()).filter(Boolean);
					await tab.saveAndSync();
				});
		});

	new Setting(el)
		.setName(t('settings.rag.ignorePaths.name'))
		.setDesc(t('settings.rag.ignorePaths.desc'))
		.addText(text => {
			text
				.setPlaceholder('Templates, Attachments/')
				.setValue(s.excludedPaths.join(', '))
				.onChange(async (val) => {
					s.excludedPaths = val.split(',').map(v => v.trim()).filter(Boolean);
					await tab.saveAndSync();
				});
		});

	// ── 고급 ─────────────────────────────────────────────────────────────
	if (tab.showAdvanced) {
		tab.advancedLabel(el);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.chunking.name'))
				.setDesc(t('settings.rag.chunking.sizeDesc')),
			{ min: 100, max: 2000, step: 50, value: s.chunkSize },
			wrapAsync(async (val) => { s.chunkSize = val; await tab.saveAndSync(); }),
		);

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.rag.chunking.overlapLabel'))
				.setDesc(t('settings.rag.chunking.overlapDesc')),
			{ min: 0, max: 500, step: 10, value: s.chunkOverlap },
			wrapAsync(async (val) => { s.chunkOverlap = val; await tab.saveAndSync(); }),
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
