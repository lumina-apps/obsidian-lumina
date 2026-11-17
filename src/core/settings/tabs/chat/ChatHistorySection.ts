import { Setting, type DropdownComponent, type TextComponent } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { wrapAsync } from '../../../../shared/utils/settingHelpers';
import { t } from '../../../../shared/locales/helpers';
import { getActiveProject } from '../../../store/projectStore';
import {
	formatHistoryFolderPreview,
	hasUnsafeHistoryPathInput,
	sanitizeHistorySubfolder,
} from '../../../../shared/utils/historyPathUtils';

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
				});
				text.setPlaceholder(t('settings.chat.history.pathPlaceholder'))
					.setValue(s.historyPath).onChange(async (val) => {
						if (composing) return;
						s.historyPath = val;
						updatePreview();
						await tab.saveAndSync();
					});
			});

		const pathWarningEl = savePathSetting.descEl.createDiv({ cls: 'lumina-settings__desc-warning' });
		pathWarningEl.style.display = 'none';

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
				pathWarningEl.style.display = '';
			} else {
				pathWarningEl.setText('');
				pathWarningEl.style.display = 'none';
			}

			const now = new Date();
			const format = s.historyFolderFormat ?? '';
			const globalPreview = formatHistoryFolderPreview(rawHistoryPath, '', format, now);

			if (!globalPreview.isFormatValid) {
				warningEl.setText(t('settings.chat.history.folderFormatInvalid'));
				warningEl.style.display = '';
			} else {
				warningEl.setText('');
				warningEl.style.display = 'none';
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
				activeProjectPreviewEl.style.display = '';
			} else {
				activeProjectPreviewEl.setText('');
				activeProjectPreviewEl.style.display = 'none';
			}
		};

		updatePreview();
	}
}