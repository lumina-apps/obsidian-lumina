import { App, Modal, Setting } from 'obsidian';
import { t } from '../locales/helpers';

export class ConfirmModal extends Modal {
	private onConfirm: () => void;
	private onCancel?: () => void;
	private title: string;
	private message: string;
	private settled = false;

	constructor(app: App, title: string, message: string, onConfirm: () => void, onCancel?: () => void) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
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
					.onClick(() => {
						if (!this.settled) {
							this.settled = true;
							this.onConfirm();
						}
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		if (!this.settled) {
			this.settled = true;
			this.onCancel?.();
		}
	}
}

/**
 * Obsidian ConfirmModal을 Promise 형태로 열어 사용자 확인/취소 결과를 반환합니다.
 * 확인 클릭 시 true, 취소·Esc·외부 클릭으로 닫히면 false를 반환합니다.
 */
export function confirmWithModal(app: App, title: string, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		let resolved = false;
		const settle = (accepted: boolean) => {
			if (resolved) return;
			resolved = true;
			resolve(accepted);
		};

		new ConfirmModal(
			app,
			title,
			message,
			() => settle(true),
			() => settle(false),
		).open();
	});
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