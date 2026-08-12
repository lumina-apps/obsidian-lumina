import { App, Modal, Setting } from 'obsidian';
import { t } from '../../shared/locales/helpers';

/**
 * lumina* 프론트매터 키 일괄 제거 실행 전 확인용 모달.
 * tags/description 등 다른 프론트매터 값은 건드리지 않는다.
 */
export class StripFrontmatterModal extends Modal {
	private readonly count: number;
	private readonly onConfirm: () => void | Promise<void>;

	constructor(app: App, count: number, onConfirm: () => void | Promise<void>) {
		super(app);
		this.count = count;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: t('uiMessages.stripMetadataTitle') });
		contentEl.createEl('p', { text: t('uiMessages.stripMetadataBody', { count: this.count }) });
		contentEl.createEl('p', {
			text: t('uiMessages.stripMetadataHint'),
			cls: 'setting-item-description',
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(t('uiMessages.modalProceed')).setCta().onClick(() => {
					this.close();
					void this.onConfirm();
				})
			)
			.addButton((btn) =>
				btn.setButtonText(t('uiMessages.modalCancel')).onClick(() => this.close())
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
