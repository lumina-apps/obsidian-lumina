/**
 * fuzzyModelSuggestModal.ts
 *
 * FuzzyModelSuggestModal 클래스와 addModelSelector 팩토리 함수.
 * 모델 선택 UI를 옵션 개수에 따라 FuzzyModal 또는 Dropdown으로 자동 렌더링합니다.
 *
 * 이전에는 settingsUIHelpers.ts에 통합되어 있었으나,
 * 관심사 분리를 위해 독립 모듈로 추출되었습니다.
 */

import { App, FuzzySuggestModal, Setting } from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
import { wrapAsync } from './asyncUtils';
import type { ModelSuggestItem } from '../types/settingsUI.types';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** FuzzyModelSuggestModal로 전환할 옵션 개수 임계값 */
export const FUZZY_MODAL_THRESHOLD = 30;

// ═══════════════════════════════════════════════════════════════════════════════
// Fuzzy Model Suggest Modal
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Model Selector (FuzzyModal / Dropdown)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 모델 선택 UI를 옵션 개수에 따라 FuzzyModal 또는 Dropdown으로 자동 렌더링합니다.
 * @param setting - 대상 Setting 인스턴스
 * @param options - 선택 옵션 배열
 * @param currentValue - 현재 선택된 값
 * @param currentLabel - 현재 표시될 라벨
 * @param onChange - 값 변경 시 호출 (value: string)
 * @param getDynamicValue - FuzzyModal open 시점에 동적으로 현재 값을 가져오는 함수
 * @param app - Obsidian App 인스턴스
 */
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