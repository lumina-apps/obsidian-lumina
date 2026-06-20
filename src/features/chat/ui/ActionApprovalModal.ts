import { Modal, App, Setting, ButtonComponent } from 'obsidian';
import { approvalManager, type ApprovalRequest } from '../utils/approvalManager';
import { t } from '../../../shared/locales/helpers';

export class ActionApprovalModal extends Modal {
	request: ApprovalRequest;

	constructor(app: App, request: ApprovalRequest) {
		super(app);
		this.request = request;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lumina-action-approval-modal');

		contentEl.createEl('h2', { text: t('uiMessages.actionApproval.title', { action: this.request.actionType?.toUpperCase() || '' }) });
		contentEl.createEl('p', { text: t('uiMessages.actionApproval.targetFile', { path: this.request.filePath }) });

		const descEl = contentEl.createEl('div', { cls: 'action-desc', attr: { style: 'margin-bottom: 20px;' } });
		
		const { actionType, metadata } = this.request;

		if (actionType === 'create_note' as any) {
			descEl.createEl('p', { text: t('uiMessages.actionApproval.createNote') });
			descEl.createEl('strong', { text: this.request.filePath });
			if (metadata?.content) {
				const pre = descEl.createEl('pre', { cls: 'code-preview', attr: { style: 'max-height: 200px; overflow-y: auto; background: var(--background-secondary-alt); padding: 8px; margin-top: 8px;' } });
				pre.setText(metadata.content);
			}
		} else if (actionType === 'delete') {
			descEl.createEl('p', { text: t('uiMessages.actionApproval.deleteNote') });
		} else if (actionType === 'rename') {
			descEl.createEl('p', { text: t('uiMessages.actionApproval.renameNote') });
			descEl.createEl('strong', { text: metadata?.targetPath });
		} else if (actionType === 'frontmatter') {
			descEl.createEl('p', { text: t('uiMessages.actionApproval.updateFrontmatter') });
			descEl.createEl('strong', { text: `${metadata?.key} -> ${metadata?.value}` });
		} else if (actionType === 'attachment') {
			descEl.createEl('p', { text: t('uiMessages.actionApproval.saveAttachment', { size: metadata?.sizeBytes?.toString() || '0' }) });
		} else if (actionType === 'execute') {
			descEl.createEl('p', { text: t('uiMessages.actionApproval.executeCode') });
			const pre = descEl.createEl('pre', { cls: 'code-preview', attr: { style: 'max-height: 200px; overflow-y: auto; background: var(--background-secondary-alt); padding: 8px;' } });
			pre.setText(metadata?.code || '');
		}

		new Setting(contentEl)
			.addButton((btn: ButtonComponent) =>
				btn
					.setButtonText(t('uiMessages.actionApproval.accept') || 'Accept')
					.setCta()
					.onClick(() => {
						approvalManager.acceptAll(this.request.id);
						this.close();
					})
			)
			.addButton((btn: ButtonComponent) =>
				btn
					.setButtonText(t('uiMessages.actionApproval.reject') || 'Reject')
					.setWarning()
					.onClick(() => {
						approvalManager.rejectAll(this.request.id);
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// If closed without explicitly clicking accept/reject, treat as reject
		approvalManager.rejectAll(this.request.id);
	}
}
