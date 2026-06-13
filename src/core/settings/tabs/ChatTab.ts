import { Setting, ButtonComponent } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { wrapAsync, addSliderWithInput } from '../settingTab';
import { t } from '../../../shared/locales/helpers';

export function renderChatTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.chat;

	// ── 시스템 프롬프트 ───────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.chat.systemPrompt.name'));

	for (const prompt of s.systemPrompts) {
		const isActive = prompt.id === s.activeSystemPromptId;
		const card = el.createEl('details', { cls: 'lumina-prompt-card' });
		if (isActive) {
			card.open = true;
		}

		// Header row
		const header = card.createEl('summary', { cls: 'lumina-prompt-card__header' });

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

		// Status badge
		if (isActive) {
			header.createSpan({
				text: t('settings.chat.systemPrompt.active'),
				cls: 'lumina-prompt-card__status'
			});
		}

		// Actions
		const actions = header.createDiv({ cls: 'lumina-prompt-card__actions' });

		// Activate button
		if (!isActive) {
			const actBtn = actions.createEl('button', {
				text: t('settings.chat.systemPrompt.activate'),
				cls: 'lumina-prompt-card__btn-activate'
			});
			actBtn.addEventListener('click', wrapAsync(async (e) => {
				e.stopPropagation();
				s.activeSystemPromptId = prompt.id;
				await tab.saveAndSync();
				tab.refreshDisplay();
			}));
		}

		// Delete button
		const delBtn = actions.createEl('button', {
			text: '🗑',
			cls: 'lumina-prompt-card__btn-delete'
		});
		delBtn.addEventListener('click', wrapAsync(async (e) => {
			e.stopPropagation();
			s.systemPrompts = s.systemPrompts.filter(p => p.id !== prompt.id);
			if (s.activeSystemPromptId === prompt.id) {
				s.activeSystemPromptId = s.systemPrompts[0]?.id ?? '';
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
		textarea.addEventListener('change', wrapAsync(async () => {
			prompt.content = textarea.value;
			await tab.saveAndSync();
		}));
	}

	const addBtnContainer = el.createDiv({ cls: 'lumina-settings-add-prompt-container' });
	addBtnContainer.setCssStyles({ display: 'flex', justifyContent: 'center', margin: '10px 0' });

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

	// ── 채팅 기록 ─────────────────────────────────────────────────────────
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
		new Setting(el)
			.setName(t('settings.chat.history.savePath'))
			.setDesc(t('settings.chat.history.desc'))
			.addText(text => {
				text.setPlaceholder(t('settings.chat.history.pathPlaceholder'))
					.setValue(s.historyPath).onChange(async (val) => {
						s.historyPath = val;
						await tab.saveAndSync();
					});
			});
	}

	// ── 입력 방식 ─────────────────────────────────────────────────────────
	tab.sectionHeading(el, t('settings.chat.sendMode.name'));

	new Setting(el)
		.setName(t('settings.chat.sendMode.name'))
		.addDropdown(drop => {
			drop
				.addOption('enter', t('settings.chat.sendMode.enter'))
				.addOption('ctrl_enter', t('settings.chat.sendMode.ctrlEnter'))
				.setValue(s.sendKey)
				.onChange(async (val) => {
					s.sendKey = val as typeof s.sendKey;
					await tab.saveAndSync();
				});
		});

	// ── 퀵 액션 (단축키 프롬프트) ──────────────────────────────────────────
	tab.sectionHeading(el, t('settings.chat.quickActions.name'));
	tab.infoBox(el, t('settings.chat.quickActions.desc'), 'info');

	new Setting(el)
		.setName(t('settings.chat.inlineTrigger.name'))
		.setDesc(t('settings.chat.inlineTrigger.desc'))
		.addText(text => {
			text.setPlaceholder('/ai')
				.setValue(s.inlineTrigger || '/ai')
				.onChange(async (val) => {
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
				text.setValue(action.name)
					.onChange(async (val) => {
						action.name = val;
						header.setText(`✨ ${val || t('settings.chat.quickActions.newAction')}`);
						await tab.saveAndSync();
						if (tab.plugin.registerQuickActions) {
							tab.plugin.registerQuickActions();
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
				text.inputEl.addClass('lumina-prompt-card__content');
				text.inputEl.setCssStyles({ width: '100%', minWidth: '300px' });
				text.inputEl.rows = 4;
				text.setValue(action.prompt).onChange(async (val) => {
					action.prompt = val;
					await tab.saveAndSync();
				});
			});

		promptSetting.settingEl.setCssStyles({ display: 'flex', alignItems: 'flex-start' });
		promptSetting.infoEl.setCssStyles({ flex: '0 0 auto', whiteSpace: 'nowrap', marginRight: '20px' });
		promptSetting.controlEl.setCssStyles({ flex: '1 1 auto', width: '100%', justifyContent: 'flex-end', display: 'flex' });

		// Delete button
		const deleteSetting = new Setting(body)
			.addButton(btn => {
				btn.setButtonText(t('settings.chat.quickActions.deleteAction'));
				const customBtn = btn as ButtonComponent & { setDestructive?: () => ButtonComponent };
				if (typeof customBtn.setDestructive === 'function') {
					customBtn.setDestructive();
				} else {
					customBtn.setWarning();
				}
				btn.onClick(async () => {
						s.quickActions = s.quickActions.filter(a => a.id !== action.id);
						await tab.saveAndSync();
						if (tab.plugin.registerQuickActions) {
							tab.plugin.registerQuickActions();
						}
						tab.refreshDisplay();
					});
			});

		// Force center alignment
		deleteSetting.settingEl.addClass('lumina-setting-center-button');
	}

	const addActionBtnContainer = el.createDiv({ cls: 'lumina-settings-add-prompt-container' });
	addActionBtnContainer.setCssStyles({ display: 'flex', justifyContent: 'center', margin: '10px 0' });

	const addActionBtn = addActionBtnContainer.createEl('button', { text: t('settings.chat.quickActions.add') });
	addActionBtn.addEventListener('click', () => {
		void (async () => {
			if (!s.quickActions) s.quickActions = [];
			s.quickActions.push({
				id: `qa-${crypto.randomUUID()}`,
				name: t('settings.chat.quickActions.newAction'),
				prompt: '',
				actionType: 'replace',
			});
			await tab.saveAndSync();
			if (tab.plugin.registerQuickActions) {
				tab.plugin.registerQuickActions();
			}
			tab.refreshDisplay();
		})();
	});

	// ── 고급 ─────────────────────────────────────────────────────────────
	if (tab.showAdvanced) {
		tab.advancedLabel(el);

		new Setting(el)
			.setName(t('settings.chat.memoryLimit.limitType'))
			.setDesc(t('settings.chat.memoryLimit.desc'))
			.addDropdown(drop => {
				drop
					.addOption('turns', t('settings.chat.memoryLimit.turns'))
					.addOption('tokens', t('settings.chat.memoryLimit.tokens'))
					.setValue(s.useTokenLimit ? 'tokens' : 'turns')
					.onChange(async (val) => {
						s.useTokenLimit = val === 'tokens';
						await tab.saveAndSync();
						tab.refreshDisplay();
					});
			});

		if (!s.useTokenLimit) {
			addSliderWithInput(
				new Setting(el)
					.setName(t('settings.chat.memoryLimit.turnsLabel'))
					.setDesc(t('settings.chat.memoryLimit.turnsDesc')),
				{ min: 1, max: 15, step: 1, value: s.contextWindowTurns },
				wrapAsync(async (val) => { s.contextWindowTurns = val; await tab.saveAndSync(); })
			);
		} else {
			new Setting(el)
				.setName(t('settings.chat.memoryLimit.maxTokens'))
				.addText(text => {
					text.setValue(String(s.maxContextTokens)).onChange(wrapAsync(async (val) => {
						const n = parseInt(val);
						if (!isNaN(n)) { s.maxContextTokens = n; await tab.saveAndSync(); }
					}));
				});
		}

		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.chat.modelParams.tempLabel'))
				.setDesc(t('settings.chat.modelParams.tempDesc')),
			{ min: 0, max: 2, step: 0.1, value: s.temperature },
			wrapAsync(async (val) => { s.temperature = val; await tab.saveAndSync(); })
		);

		new Setting(el)
			.setName(t('settings.chat.modelParams.maxOutput'))
			.addText(text => {
				text.setValue(String(s.maxOutputTokens)).onChange(wrapAsync(async (val) => {
					const n = parseInt(val);
					if (!isNaN(n)) { s.maxOutputTokens = n; await tab.saveAndSync(); }
				}));
			});

		new Setting(el)
			.setName(t('settings.chat.streaming.name'))
			.setDesc(t('settings.chat.streaming.desc'))
			.addToggle(toggle => {
				toggle.setValue(s.streaming).onChange(wrapAsync(async (val) => {
					s.streaming = val;
					await tab.saveAndSync();
				}));
			});

		new Setting(el)
			.setName(t('settings.chat.modelParams.responseLang'))
			.setDesc(t('settings.chat.modelParams.responseLangDesc'))
			.addDropdown(drop => {
				drop
					.addOption('auto', t('settings.chat.modelParams.responseLangAuto'))
					.addOption('ko', t('settings.connections.language.option.ko'))
					.addOption('en', t('settings.connections.language.option.en'))
					.addOption('ja', t('settings.connections.language.option.ja'))
					.addOption('zh', '中文')
					.addOption('fr', 'Français')
					.addOption('de', 'Deutsch')
					.addOption('es', 'Español')
					.setValue(s.responseLanguage)
					.onChange(wrapAsync(async (val) => {
						s.responseLanguage = val as typeof s.responseLanguage;
						await tab.saveAndSync();
					}));
			});
	}
}
