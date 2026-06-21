/** 모델 선택 UI: 옵션 개수에 따라 FuzzyModal 또는 Dropdown 자동 전환 */

import { App, FuzzySuggestModal, Setting } from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
import { wrapAsync } from './asyncUtils';
import type { ModelSuggestItem } from '../types/settingsUI.types';

/** FuzzyModal 전환 임계값 */
export const FUZZY_MODAL_THRESHOLD = 30;

export class FuzzyModelSuggestModal extends FuzzySuggestModal<ModelSuggestItem> {
	private items: ModelSuggestItem[];
	private onChoose: (item: ModelSuggestItem) => void;
	private defaultItemValue?: string;

	constructor(app: App, items: ModelSuggestItem[], onChoose: (item: ModelSuggestItem) => void, defaultItemValue?: string) {
		super(app);
		this.items = items;
		this.onChoose = onChoose;
		this.defaultItemValue = defaultItemValue;
		this.setPlaceholder('Search models...');
	}

	getItems(): ModelSuggestItem[] {
		return this.items;
	}

	getItemText(item: ModelSuggestItem): string {
		return item.label;
	}

	renderSuggestion(match: FuzzyMatch<ModelSuggestItem>, el: HTMLElement): void {
		super.renderSuggestion(match, el);
		if (this.defaultItemValue !== undefined && match.item.value === this.defaultItemValue) {
			el.classList.add('is-selected-default');
		}
	}

	onChooseItem(item: ModelSuggestItem, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(item);
	}

	onOpen(): void {
		void super.onOpen();
		this.modalEl.classList.add('lumina-model-suggest-modal');

		if (this.defaultItemValue) {
			window.setTimeout(() => {
				const selectedEl = this.containerEl.querySelector('.is-selected-default');
				if (selectedEl) {
					selectedEl.scrollIntoView({ behavior: 'auto', block: 'center' });
				}
			}, 50);
		}
	}
}

/** 모델 선택 UI 자동 렌더링 (FuzzyModal / Dropdown) */
export function addModelSelector(
	setting: Setting,
	options: { value: string; label: string }[],
	currentValue: string,
	currentLabel: string,
	onChange: (val: string) => Promise<void>,
	getDynamicValue: () => string,
	app: App,
): void {
	if (options.length >= FUZZY_MODAL_THRESHOLD) {
		setting.addButton(btn => {
			btn.setButtonText(currentLabel)
				.onClick(() => {
					new FuzzyModelSuggestModal(
						app,
						options,
						wrapAsync(async (item) => {
							await onChange(item.value);
							btn.setButtonText(item.label);
						}),
						getDynamicValue(),
					).open();
				});
		});
	} else {
		setting.addDropdown(drop => {
			for (const opt of options) {
				drop.addOption(opt.value, opt.label);
			}
			drop.setValue(currentValue)
				.onChange(wrapAsync(async (val) => {
					await onChange(val);
				}));
		});
	}
}