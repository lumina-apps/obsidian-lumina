import { App, Modal, Setting, FuzzySuggestModal, type FuzzyMatch } from 'obsidian';
import { t } from '../../shared/locales/helpers';

export class ConfirmModal extends Modal {
	private onConfirm: () => void;
	private title: string;
	private message: string;

	constructor(app: App, title: string, message: string, onConfirm: () => void) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.title });
		const messageLines = this.message.split('\n');
		for (const line of messageLines) {
			contentEl.createEl('p', { text: line });
		}
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(t('uiMessages.modalCancel'))
					.onClick(() => { this.close(); })
			)
			.addButton((btn) =>
				btn
					.setButtonText(t('uiMessages.modalProceed'))
					.setCta()
					.onClick(() => { this.onConfirm(); this.close(); })
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export interface ModelSuggestItem {
	value: string;
	label: string;
}

export class FuzzyModelSuggestModal extends FuzzySuggestModal<ModelSuggestItem> {
	private items: ModelSuggestItem[];
	private onChoose: (item: ModelSuggestItem) => void;
	private defaultItemValue?: string;

	constructor(app: App, items: ModelSuggestItem[], onChoose: (item: ModelSuggestItem) => void, defaultItemValue?: string) {
		super(app);
		this.items = items;
		this.onChoose = onChoose;
		this.defaultItemValue = defaultItemValue;
		this.setPlaceholder(t('uiMessages.modelPlaceholder'));
	}

	getItems(): ModelSuggestItem[] {
		return this.items;
	}

	getItemText(item: ModelSuggestItem): string {
		return item.label;
	}

	renderSuggestion(match: FuzzyMatch<ModelSuggestItem>, el: HTMLElement) {
		super.renderSuggestion(match, el);
		if (this.defaultItemValue !== undefined && match.item.value === this.defaultItemValue) {
			el.classList.add('is-selected-default');
			// 강제 인라인 스타일 적용 (테마 CSS 충돌 방지)
			el.style.setProperty('background-color', 'rgba(139, 92, 246, 0.15)', 'important');
			el.style.setProperty('border-left', '3px solid #8b5cf6', 'important');
			el.style.setProperty('font-weight', '600', 'important');
			el.style.setProperty('position', 'relative', 'important');
			
			// 체크마크 강제 추가
			const checkmark = el.createSpan();
			checkmark.innerText = '✓';
			checkmark.style.setProperty('position', 'absolute', 'important');
			checkmark.style.setProperty('right', '12px', 'important');
			checkmark.style.setProperty('top', '50%', 'important');
			checkmark.style.setProperty('transform', 'translateY(-50%)', 'important');
			checkmark.style.setProperty('color', '#8b5cf6', 'important');
			checkmark.style.setProperty('font-weight', '700', 'important');
			checkmark.style.setProperty('font-size', '1.1em', 'important');
		}
	}

	onChooseItem(item: ModelSuggestItem, evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(item);
	}

	onOpen(): void {
		void super.onOpen();

		if (this.defaultItemValue) {
			// give it a bit of time to render suggestions
			window.setTimeout(() => {
				const selectedEl = this.containerEl.querySelector('.is-selected-default');
				if (selectedEl) {
					selectedEl.scrollIntoView({ behavior: 'auto', block: 'center' });
				}
			}, 50);
		}
	}
}