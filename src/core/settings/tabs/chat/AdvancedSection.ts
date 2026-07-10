import { Setting } from 'obsidian';
import type { LuminaSettingTab } from '../../settingTab';
import { wrapAsync, addSliderWithInput } from '../../../../shared/utils/settingHelpers';
import { t } from '../../../../shared/locales/helpers';

export function renderAdvancedSection(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.chat;

	tab.advancedLabel(el);

	new Setting(el)
		.setName(t('settings.chat.memoryLimit.limitType'))
		.setDesc(t('settings.chat.memoryLimit.desc'))
		.addDropdown(drop => {
			drop
				.addOption('auto_summary', t('settings.chat.memoryLimit.autoSummary') ?? 'Auto Context Summary')
				.addOption('turns', t('settings.chat.memoryLimit.turns'))
				.addOption('tokens', t('settings.chat.memoryLimit.tokens'))
				.setValue(s.memoryMethod ?? 'auto_summary')
				.onChange(async (val) => {
					s.memoryMethod = val as 'auto_summary' | 'turns' | 'tokens';
					await tab.saveAndSync();
					tab.refreshDisplay();
				});
		});

	if (s.memoryMethod === 'auto_summary' || s.memoryMethod === 'turns') {
		addSliderWithInput(
			new Setting(el)
				.setName(t('settings.chat.memoryLimit.turnsLabel'))
				.setDesc(t('settings.chat.memoryLimit.turnsDesc')),
			{ min: 5, max: 20, step: 1, value: s.contextWindowTurns },
			wrapAsync(async (val) => { s.contextWindowTurns = val; await tab.saveAndSync(); })
		);
	}
	
	if (s.memoryMethod === 'tokens') {
		new Setting(el)
			.setName(t('settings.chat.memoryLimit.maxTokens'))
			.addText(text => {
				let composing = false;
				const inputEl = text.inputEl;
				inputEl.type = 'number';
				inputEl.addEventListener('compositionstart', () => { composing = true; });
				inputEl.addEventListener('compositionend', () => {
					composing = false;
					const n = parseInt(inputEl.value);
					s.maxContextTokens = isNaN(n) ? 8000 : n;
					void tab.saveAndSync();
				});
				text.setValue(String(s.maxContextTokens)).onChange(wrapAsync(async (val) => {
					if (composing) return;
					const n = parseInt(val);
					s.maxContextTokens = isNaN(n) ? 8000 : n;
					await tab.saveAndSync();
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
		.setDesc(t('settings.chat.modelParams.maxOutputDesc'))
		.addText(text => {
			let composing = false;
			const inputEl = text.inputEl;
			inputEl.type = 'number';
			inputEl.addEventListener('compositionstart', () => { composing = true; });
			inputEl.addEventListener('compositionend', () => {
				composing = false;
				const n = parseInt(inputEl.value);
				s.maxOutputTokens = isNaN(n) ? 4000 : n;
				void tab.saveAndSync();
			});
			text.setValue(String(s.maxOutputTokens)).onChange(wrapAsync(async (val) => {
				if (composing) return;
				const n = parseInt(val);
				s.maxOutputTokens = isNaN(n) ? 4000 : n;
				await tab.saveAndSync();
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
		.setName(t('settings.chat.timeout.ttftLabel', { fallback: 'Time-To-First-Token Timeout (ms)' }))
		.setDesc(t('settings.chat.timeout.ttftDesc', { fallback: 'Wait time for the very first token to arrive. Set to 0 to disable. (Default: 0)' }))
		.addText(text => {
			let composing = false;
			const inputEl = text.inputEl;
			inputEl.type = 'number';
			inputEl.addEventListener('compositionstart', () => { composing = true; });
			inputEl.addEventListener('compositionend', () => {
				composing = false;
				const n = parseInt(inputEl.value);
				s.ttftTimeoutMs = isNaN(n) ? 0 : n;
				void tab.saveAndSync();
			});
			text.setValue(String(s.ttftTimeoutMs ?? 0)).onChange(wrapAsync(async (val) => {
				if (composing) return;
				const n = parseInt(val);
				s.ttftTimeoutMs = isNaN(n) ? 0 : n;
				await tab.saveAndSync();
			}));
		});

	new Setting(el)
		.setName(t('settings.chat.timeout.interTokenLabel', { fallback: 'Inter-Token Timeout (ms)' }))
		.setDesc(t('settings.chat.timeout.interTokenDesc', { fallback: 'Wait time between subsequent streaming chunks. Set to 0 to disable. (Default: 0)' }))
		.addText(text => {
			let composing = false;
			const inputEl = text.inputEl;
			inputEl.type = 'number';
			inputEl.addEventListener('compositionstart', () => { composing = true; });
			inputEl.addEventListener('compositionend', () => {
				composing = false;
				const n = parseInt(inputEl.value);
				s.interTokenTimeoutMs = isNaN(n) ? 0 : n;
				void tab.saveAndSync();
			});
			text.setValue(String(s.interTokenTimeoutMs ?? 0)).onChange(wrapAsync(async (val) => {
				if (composing) return;
				const n = parseInt(val);
				s.interTokenTimeoutMs = isNaN(n) ? 0 : n;
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