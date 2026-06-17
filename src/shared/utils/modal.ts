import { App, Modal, Setting } from 'obsidian';
import { t } from '../locales/helpers';

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

/** LLM 연결 성공 후 에이전트(베타) 활성화를 묻는 전용 모달 */
export class AgentBetaModal extends Modal {
	private onResult: (enabled: boolean) => void;
	private title: string;
	private description: string;
	private confirmLabel: string;
	private skipLabel: string;

	constructor(
		app: App,
		title: string,
		description: string,
		confirmLabel: string,
		skipLabel: string,
		onResult: (enabled: boolean) => void,
	) {
		super(app);
		this.title = title;
		this.description = description;
		this.confirmLabel = confirmLabel;
		this.skipLabel = skipLabel;
		this.onResult = onResult;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('lumina-agent-beta-modal');

		// Icon + title
		contentEl.createEl('h2', { text: this.title, cls: 'lumina-agent-beta-modal__title' });

		// Description lines
		const descEl = contentEl.createDiv({ cls: 'lumina-agent-beta-modal__desc' });
		const lines = this.description.split('\n');
		for (const line of lines) {
			if (line.trim() === '') {
				descEl.createEl('br');
			} else {
				descEl.createEl('p', { text: line });
			}
		}

		// Action buttons
		const actions = contentEl.createDiv({ cls: 'lumina-agent-beta-modal__actions' });

		const skipBtn = actions.createEl('button', {
			text: this.skipLabel,
			cls: 'lumina-agent-beta-modal__btn-skip',
		});
		skipBtn.addEventListener('click', () => {
			this.onResult(false);
			this.close();
		});

		const confirmBtn = actions.createEl('button', {
			text: this.confirmLabel,
			cls: 'lumina-agent-beta-modal__btn-confirm mod-cta',
		});
		confirmBtn.addEventListener('click', () => {
			this.onResult(true);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}