import { Setting, type DropdownComponent, type TextComponent } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { wrapAsync } from '../../../../shared/utils/settingHelpers';
import { t } from '../../../../shared/locales/helpers';
import { debugLogger } from '../../../../shared/debugLogger';
import { normalizeError } from '../../../../shared/utils/errorUtils';
import { getActiveProject } from '../../../store/projectStore';
import {
	formatHistoryFolderPreview,
	hasUnsafeHistoryPathInput,
	normalizeHistoryRootPath,
	sanitizeHistorySubfolder,
} from '../../../../shared/utils/historyPathUtils';

/** 히스토리 경로 변경 후 인덱서 제외 경로 동기화 및 디바운스 재인덱싱 타이머 */
let historyPathReindexTimer: number | null = null;
const HISTORY_PATH_REINDEX_DEBOUNCE_MS = 1500;

/**
 * 채팅 히스토리 경로 변경 시 활성·캐시 인덱서의 제외 경로를 즉시 갱신하고,
 * 자동 동기화 모드에서는 디바운스 후 증분 인덱싱을 실행합니다.
 */
function syncHistoryPathToRag(tab: LuminaSettingTab, rawHistoryPath: string): void {
	const normalizedPath = normalizeHistoryRootPath(rawHistoryPath);
	tab.plugin.indexer?.setChatHistoryPath(normalizedPath);

	void import('../../../../features/rag/projectIndexCache')
		.then(({ projectIndexCache }) => {
			projectIndexCache.updateChatHistoryPath(normalizedPath);
		})
		.catch(() => {
			// RAG 모듈 미로드 상태는 무시
		});

	if (!tab.plugin.settings.connections?.ragEnabled || !tab.plugin.indexer) {
		return;
	}
	if (tab.plugin.settings.rag?.syncMode === 'manual') {
		return;
	}

	if (historyPathReindexTimer !== null) {
		window.clearTimeout(historyPathReindexTimer);
	}
	historyPathReindexTimer = window.setTimeout(() => {
		historyPathReindexTimer = null;
		const indexer = tab.plugin.indexer;
		if (!indexer || indexer.isDestroyed) return;
		void indexer.updateIndex().catch((err: unknown) => {
			debugLogger.logError('rag', normalizeError(err, `히스토리 경로 변경 후 재인덱싱 실패: ${err}`));
		});
	}, HISTORY_PATH_REINDEX_DEBOUNCE_MS);
}

const CUSTOM_PRESET_KEY = '__custom__';
const FOLDER_FORMAT_PRESETS = new Set<string>([
	'',
	'{{YYYY}}',
	'{{YYYY}}/{{MM}}',
	'{{YYYY}}/{{MM}}/{{DD}}',
	'{{YYYY-MM}}',
]);

export function renderChatHistorySection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.chat;

	tab.sectionHeading(el, t('settings.chat.history.name'));

	new Setting(el)
		.setName(t('settings.chat.history.name'))
		.setDesc(t('settings.chat.history.desc'))
		.addToggle(toggle => {
			toggle.setValue(s.autoSaveHistory).onChange(wrapAsync(async (val) => {
				s.autoSaveHistory = val;
				await tab.saveAndSync();
				tab.refreshDisplay();
			}));
		});

	if (s.autoSaveHistory) {
		let updatePreview = () => {};

		const savePathSetting = new Setting(el)
			.setName(t('settings.chat.history.savePath'))
			.setDesc(t('settings.chat.history.savePathDesc'))
			.addText(text => {
				let composing = false;
				const inputEl = text.inputEl;
				inputEl.addEventListener('compositionstart', () => { composing = true; });
				inputEl.addEventListener('compositionend', () => {
					composing = false;
					s.historyPath = inputEl.value;
					updatePreview();
					void tab.saveAndSync();
					syncHistoryPathToRag(tab, s.historyPath);
				});
				text.setPlaceholder(t('settings.chat.history.pathPlaceholder'))
					.setValue(s.historyPath).onChange(async (val) => {
						if (composing) return;
						s.historyPath = val;
						updatePreview();
						await tab.saveAndSync();
						syncHistoryPathToRag(tab, val);
					});
			});

		const pathWarningEl = savePathSetting.descEl.createDiv({ cls: 'lumina-settings__desc-warning' });
		pathWarningEl.setCssStyles({ display: 'none' });

		let dropComp: DropdownComponent | null = null;
		let textComp: TextComponent | null = null;
		const currentFormat = s.historyFolderFormat ?? '';

		const formatSetting = new Setting(el)
			.setClass('lumina-setting-stacked-control')
			.setName(t('settings.chat.history.folderFormat'))
			.setDesc(t('settings.chat.history.folderFormatDesc', { example: '{{YYYY}}/{{MM}}' }))
			.addDropdown(drop => {
				dropComp = drop;
				drop
					.addOption('', t('settings.chat.history.folderFormatPresetNone'))
					.addOption('{{YYYY}}', t('settings.chat.history.folderFormatPresetYear'))
					.addOption('{{YYYY}}/{{MM}}', t('settings.chat.history.folderFormatPresetYearMonth'))
					.addOption('{{YYYY}}/{{MM}}/{{DD}}', t('settings.chat.history.folderFormatPresetYearMonthDay'))
					.addOption('{{YYYY-MM}}', t('settings.chat.history.folderFormatPresetYearMonthDash'))
					.addOption(CUSTOM_PRESET_KEY, t('settings.chat.history.folderFormatPresetCustom'))
					.setValue(FOLDER_FORMAT_PRESETS.has(currentFormat) ? currentFormat : CUSTOM_PRESET_KEY)
					.onChange(wrapAsync(async (val) => {
						if (val === CUSTOM_PRESET_KEY) {
							textComp?.inputEl.focus();
							return;
						}
						s.historyFolderFormat = val;
						textComp?.setValue(val);
						updatePreview();
						await tab.saveAndSync();
					}));
			})
			.addText(text => {
				textComp = text;
				let composing = false;
				const inputEl = text.inputEl;
				inputEl.addEventListener('compositionstart', () => { composing = true; });
				inputEl.addEventListener('compositionend', () => {
					composing = false;
					const val = inputEl.value;
					s.historyFolderFormat = val;
					dropComp?.setValue(FOLDER_FORMAT_PRESETS.has(val) ? val : CUSTOM_PRESET_KEY);
					updatePreview();
					void tab.saveAndSync();
				});
				text.setPlaceholder(t('settings.chat.history.folderFormatPlaceholder', { example: '{{YYYY}}/{{MM}}' }))
					.setValue(currentFormat)
					.onChange(async (val) => {
						if (composing) return;
						s.historyFolderFormat = val;
						dropComp?.setValue(FOLDER_FORMAT_PRESETS.has(val) ? val : CUSTOM_PRESET_KEY);
						updatePreview();
						await tab.saveAndSync();
					});
			});

		const previewEl = formatSetting.descEl.createDiv({ cls: 'lumina-settings__desc-guide' });
		const activeProjectPreviewEl = formatSetting.descEl.createDiv({ cls: 'lumina-settings__desc-guide' });
		const warningEl = formatSetting.descEl.createDiv({ cls: 'lumina-settings__desc-warning' });

		// 설정 입력에 따른 실시간 폴더 경로 미리보기 및 정제 경고 갱신
		updatePreview = () => {
			const rawHistoryPath = s.historyPath ?? '';
			if (hasUnsafeHistoryPathInput(rawHistoryPath)) {
				pathWarningEl.setText(t('settings.chat.history.pathSanitizedWarning'));
				pathWarningEl.setCssStyles({ display: '' });
			} else {
				pathWarningEl.setText('');
				pathWarningEl.setCssStyles({ display: 'none' });
			}

			const now = new Date();
			const format = s.historyFolderFormat ?? '';
			const globalPreview = formatHistoryFolderPreview(rawHistoryPath, '', format, now);

			if (!globalPreview.isFormatValid) {
				warningEl.setText(t('settings.chat.history.folderFormatInvalid'));
				warningEl.setCssStyles({ display: '' });
			} else {
				warningEl.setText('');
				warningEl.setCssStyles({ display: 'none' });
			}
			previewEl.setText(t('settings.chat.history.folderFormatPreview', { path: `${globalPreview.resolvedPath}/` }));

			const activeProject = getActiveProject();
			const activeSubfolder = sanitizeHistorySubfolder(activeProject?.historySubfolder);
			if (activeProject && activeSubfolder) {
				const activePreview = formatHistoryFolderPreview(rawHistoryPath, activeSubfolder, format, now);
				const activeName = (activeProject.id === 'default' && activeProject.name === 'Default')
					? t('projects.settings.defaultProjectName')
					: activeProject.name;
				activeProjectPreviewEl.setText(
					t('settings.chat.history.folderFormatActiveProjectPreview', {
						project: activeName,
						path: `${activePreview.resolvedPath}/`,
					}),
				);
				activeProjectPreviewEl.setCssStyles({ display: '' });
			} else {
				activeProjectPreviewEl.setText('');
				activeProjectPreviewEl.setCssStyles({ display: 'none' });
			}
		};

		updatePreview();
	}
}