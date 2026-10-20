import { wrapAsync, createComposingSafeTextHandler } from '../../../../shared/utils/settingHelpers';
import type { LuminaSettingTab } from '../../settingTab';
import { t } from '../../../../shared/locales/helpers';
import { createButtonContainer } from '../../../../shared/utils/domUtils';
import { DEFAULT_SETTINGS } from '../../defaultSettings';

import { setIcon } from 'obsidian';

const openPromptIds = new Set<string>();
let newlyAddedPromptId: string | null = null;

export function renderSystemPromptSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.chat;

	tab.sectionHeading(el, t('settings.chat.systemPrompt.name'));

	for (const prompt of s.systemPrompts) {
		const card = el.createEl('details', { cls: 'lumina-prompt-card' });
		card.dataset.promptId = prompt.id;

		const isNewlyAdded = newlyAddedPromptId === prompt.id;
		if (openPromptIds.has(prompt.id) || isNewlyAdded) {
			card.open = true;
			openPromptIds.add(prompt.id);
		}
		card.addEventListener('toggle', () => {
			if (card.open) {
				openPromptIds.add(prompt.id);
			} else {
				openPromptIds.delete(prompt.id);
			}
		});

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
		nameInput.type = 'text';
		nameInput.value = prompt.name;
		nameInput.placeholder = t('settings.chat.systemPrompt.name');
		nameInput.addEventListener('click', (e) => e.stopPropagation());
		nameInput.addEventListener('keydown', (e) => {
			if (e.key === ' ' || e.key === 'Enter') {
				e.stopPropagation();
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				nameInput.blur();
			}
		});
		nameInput.addEventListener('keyup', (e) => {
			if (e.key === ' ' || e.key === 'Enter') {
				e.stopPropagation();
			}
		});

		const syncPromptName = (val: string) => {
			prompt.name = val;
			const selectEl = el.querySelector<HTMLSelectElement>('select[data-role="default-system-prompt-select"]');
			const opt = selectEl ? Array.from(selectEl.options).find(o => o.value === prompt.id) : undefined;
			if (opt) {
				opt.text = val;
			}
			void tab.saveAndSync();
		};
		createComposingSafeTextHandler(nameInput, syncPromptName);
		nameInput.addEventListener('change', () => {
			syncPromptName(nameInput.value);
		});

		if (isNewlyAdded) {
			newlyAddedPromptId = null;
			if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
				window.requestAnimationFrame(() => {
					nameInput.focus();
					nameInput.select();
				});
			}
		}

		// Actions
		const actions = header.createDiv({ cls: 'lumina-prompt-card__actions' });

		// Delete button
		const delBtn = actions.createEl('button', {
			cls: 'lumina-prompt-card__btn-delete',
			attr: {
				type: 'button',
				'aria-label': t('common.delete') || 'Delete',
			}
		});
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', wrapAsync(async (e) => {
			e.stopPropagation();
			openPromptIds.delete(prompt.id);
			s.systemPrompts = s.systemPrompts.filter(p => p.id !== prompt.id);

			// 모든 시스템 프롬프트가 삭제된 경우 기본 프롬프트를 자동 복원하여 빈 상태 방지
			if (s.systemPrompts.length === 0) {
				const fallbackDefault = DEFAULT_SETTINGS.chat.systemPrompts[0];
				if (fallbackDefault) {
					s.systemPrompts = [{ ...fallbackDefault }];
				}
			}

			// 삭제된 프롬프트 ID를 참조하던 프로젝트의 systemPromptId 정리
			for (const proj of tab.plugin.settings.projects.list) {
				if (proj.systemPromptId === prompt.id && !s.systemPrompts.some(p => p.id === prompt.id)) {
					proj.systemPromptId = '';
				}
			}

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
		createComposingSafeTextHandler(textarea, (val) => {
			prompt.content = val;
			void tab.saveAndSync();
		});
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
		const newId = crypto.randomUUID();
		newlyAddedPromptId = newId;
		s.systemPrompts.push({
			id: newId,
			name: `${t('settings.chat.systemPrompt.defaultName')} ${s.systemPrompts.length + 1}`,
			content: '',
		});
		await tab.saveAndSync();
		tab.refreshDisplay();
	}));
}