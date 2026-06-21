import { Setting, type ButtonComponent } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { wrapAsync } from '../../../../shared/utils/settingHelpers';
import { t } from '../../../../shared/locales/helpers';
import { createButtonContainer } from '../../../../shared/utils/domUtils';

/**
 * ButtonComponent에 setWarning()이 있으면 호출합니다.
 * Obsidian 1.x API 기준으로 존재하는 메서드이지만, 타입 정의에 따라
 * 누락되었을 수 있으므로 안전하게 타입 확인 후 호출합니다.
 */
function applyWarningStyle(btn: ButtonComponent): void {
	const b = btn as unknown as Record<string, unknown>;
	if (typeof b.setWarning === 'function') {
		(b.setWarning as () => void)();
	}
}

export function renderQuickActionSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.chat;

	tab.sectionHeading(el, t('settings.chat.quickActions.name'));
	tab.infoBox(el, t('settings.chat.quickActions.desc'), 'info');

	new Setting(el)
		.setName(t('settings.chat.inlineTrigger.name'))
		.setDesc(t('settings.chat.inlineTrigger.desc'))
		.addText(text => {
			let composing = false;
			const inputEl = text.inputEl;
			inputEl.addEventListener('compositionstart', () => { composing = true; });
			inputEl.addEventListener('compositionend', () => {
				composing = false;
				s.inlineTrigger = inputEl.value;
				void tab.saveAndSync();
			});
			text.setPlaceholder('/ai')
				.setValue(s.inlineTrigger || '/ai')
				.onChange(async (val) => {
					if (composing) return;
					s.inlineTrigger = val;
					await tab.saveAndSync();
				});
		});

	for (const action of s.quickActions || []) {
		const card = el.createEl('details', { cls: 'lumina-prompt-card' });

		// Header row
		const header = card.createEl('summary', { cls: 'lumina-prompt-card__header' });
		header.setText(`✨ ${action.name || t('settings.chat.quickActions.newAction')}`);
		header.setCssStyles({ cursor: 'pointer', fontWeight: 'bold', userSelect: 'none' });

		// Body content
		const body = card.createDiv({ cls: 'lumina-prompt-card__body' });

		// Name Setting
		new Setting(body)
			.setName(t('settings.chat.quickActions.actionName'))
			.addText(text => {
				let composing = false;
				const nameInputEl = text.inputEl;
				nameInputEl.addEventListener('compositionstart', () => { composing = true; });
				nameInputEl.addEventListener('compositionend', () => {
					composing = false;
					action.name = nameInputEl.value;
					header.setText(`✨ ${nameInputEl.value || t('settings.chat.quickActions.newAction')}`);
					void tab.saveAndSync();
					if (tab.plugin.commandManager.registerQuickActions) {
						tab.plugin.commandManager.registerQuickActions();
					}
				});
				text.setValue(action.name)
					.onChange(async (val) => {
						if (composing) return;
						action.name = val;
						header.setText(`✨ ${val || t('settings.chat.quickActions.newAction')}`);
						await tab.saveAndSync();
						if (tab.plugin.commandManager.registerQuickActions) {
							tab.plugin.commandManager.registerQuickActions();
						}
					});
			});

		// Action Type Dropdown
		new Setting(body)
			.setName(t('settings.chat.quickActions.actionType'))
			.addDropdown(drop => {
				drop.addOption('replace', t('settings.chat.quickActions.typeReplace'))
					.addOption('append', t('settings.chat.quickActions.typeAppend'))
					.addOption('chat', t('settings.chat.quickActions.typeChat'))
					.setValue(action.actionType)
					.onChange(async (val: string) => {
						action.actionType = val as 'replace' | 'append' | 'chat';
						await tab.saveAndSync();
					});
			});

		// Prompt Textarea
		const promptSetting = new Setting(body)
			.setName(t('settings.chat.quickActions.actionPrompt'))
			.addTextArea(text => {
				let composing = false;
				text.inputEl.addClass('lumina-prompt-card__content');
				text.inputEl.setCssStyles({ width: '100%', minWidth: '300px' });
				text.inputEl.rows = 4;
				text.inputEl.addEventListener('compositionstart', () => { composing = true; });
				text.inputEl.addEventListener('compositionend', () => {
					composing = false;
					action.prompt = text.inputEl.value;
					void tab.saveAndSync();
				});
				text.setValue(action.prompt).onChange(async (val) => {
					if (composing) return;
					action.prompt = val;
					await tab.saveAndSync();
				});
			});

		promptSetting.settingEl.setCssStyles({ display: 'flex', alignItems: 'flex-start' });
		promptSetting.infoEl.setCssStyles({ flex: '0 0 auto', whiteSpace: 'nowrap', marginRight: '20px' });
		promptSetting.controlEl.setCssStyles({ flex: '1 1 auto', width: '100%', justifyContent: 'flex-end', display: 'flex' });

		// Delete button
		const deleteSetting = new Setting(body)
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText(t('settings.chat.quickActions.deleteAction'));
				applyWarningStyle(btn);
				btn.onClick(async () => {
					s.quickActions = s.quickActions.filter(a => a.id !== action.id);
					await tab.saveAndSync();
					if (tab.plugin.commandManager.registerQuickActions) {
						tab.plugin.commandManager.registerQuickActions();
					}
					tab.refreshDisplay();
				});
			});

		// Force center alignment
		deleteSetting.settingEl.addClass('lumina-setting-center-button');
	}

	const addActionBtnContainer = createButtonContainer(el, 'lumina-settings-add-prompt-container');

	const addActionBtn = addActionBtnContainer.createEl('button', { text: t('settings.chat.quickActions.add') });
	addActionBtn.addEventListener('click', wrapAsync(async () => {
		if (!s.quickActions) s.quickActions = [];
		s.quickActions.push({
			id: `qa-${crypto.randomUUID()}`,
			name: t('settings.chat.quickActions.newAction'),
			prompt: '',
			actionType: 'replace',
		});
		await tab.saveAndSync();
		if (tab.plugin.commandManager.registerQuickActions) {
			tab.plugin.commandManager.registerQuickActions();
		}
		tab.refreshDisplay();
	}));
}