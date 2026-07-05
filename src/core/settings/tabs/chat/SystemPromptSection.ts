import { wrapAsync } from '../../../../shared/utils/settingHelpers';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import { createButtonContainer } from '../../../../shared/utils/domUtils';

import { setIcon } from 'obsidian';

export function renderSystemPromptSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.chat;

	tab.sectionHeading(el, t('settings.chat.systemPrompt.name'));

	for (const prompt of s.systemPrompts) {
		const card = el.createEl('details', { cls: 'lumina-prompt-card' });

		// Header row
		const header = card.createEl('summary', { cls: 'lumina-prompt-card__header' });

		const chevron = header.createSpan({ cls: 'lumina-prompt-card__chevron' });
		setIcon(chevron, 'chevron-right');

		// Name input
		const nameInput = header.createEl('input', {
			type: 'text',
			value: prompt.name,
			cls: 'lumina-prompt-card__name'
		});
		nameInput.placeholder = t('settings.chat.systemPrompt.name');
		nameInput.addEventListener('click', (e) => e.stopPropagation());
		nameInput.addEventListener('change', () => {
			prompt.name = nameInput.value;
			void tab.saveAndSync();
		});



		// Actions
		const actions = header.createDiv({ cls: 'lumina-prompt-card__actions' });


		// Delete button
		const delBtn = actions.createEl('button', {
			text: '🗑',
			cls: 'lumina-prompt-card__btn-delete'
		});
		delBtn.addEventListener('click', wrapAsync(async (e) => {
			e.stopPropagation();
			s.systemPrompts = s.systemPrompts.filter(p => p.id !== prompt.id);
			await tab.saveAndSync();
			tab.refreshDisplay();
		}));

		// Body content (Textarea)
		const body = card.createDiv({ cls: 'lumina-prompt-card__body' });
		const textarea = body.createEl('textarea', {
			cls: 'lumina-prompt-card__content'
		});
		textarea.value = prompt.content;
		textarea.rows = 3;
		textarea.placeholder = t('settings.chat.systemPrompt.desc');
		textarea.addEventListener('change', wrapAsync(async () => {
			prompt.content = textarea.value;
			await tab.saveAndSync();
		}));

		// Variables insert section
		const varsContainer = body.createDiv({ cls: 'lumina-prompt-vars' });
		varsContainer.createSpan({ text: t('settings.chat.systemPrompt.variablesHint'), cls: 'lumina-prompt-vars__hint' });
		const varsList = varsContainer.createDiv({ cls: 'lumina-prompt-vars__list' });

		const addVarChip = (varName: string) => {
			const btn = varsList.createEl('button', { text: varName, cls: 'lumina-prompt-vars__btn' });
			btn.addEventListener('click', wrapAsync(async (e) => {
				e.preventDefault();
				const start = textarea.selectionStart;
				const end = textarea.selectionEnd;
				const text = textarea.value;
				const newText = text.substring(0, start) + varName + text.substring(end);
				textarea.value = newText;
				
				prompt.content = newText;
				await tab.saveAndSync();
				
				textarea.focus();
				textarea.selectionStart = textarea.selectionEnd = start + varName.length;
			}));
		};

		addVarChip('{{title}}');
		addVarChip('{{date}}');
		addVarChip('{{time}}');
		addVarChip('{{activeFile}}');
	}

	const addBtnContainer = createButtonContainer(el, 'lumina-settings-add-prompt-container');

	const addBtn = addBtnContainer.createEl('button', { text: t('settings.chat.systemPrompt.addPrompt') });
	addBtn.addEventListener('click', wrapAsync(async () => {
		s.systemPrompts.push({
			id: crypto.randomUUID(),
			name: `${t('settings.chat.systemPrompt.defaultName')} ${s.systemPrompts.length + 1}`,
			content: '',
		});
		await tab.saveAndSync();
		tab.refreshDisplay();
	}));
}