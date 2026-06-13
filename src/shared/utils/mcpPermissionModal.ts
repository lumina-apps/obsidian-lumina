import { App, Modal, Setting } from 'obsidian';
import { t } from '../locales/helpers';

export class McpPermissionModal extends Modal {
	private serverName: string;
	private toolName: string;
	private args: unknown;
	private resolvePromise: ((value: boolean) => void) | null = null;
	private responded = false;

	constructor(app: App, serverName: string, toolName: string, args: unknown) {
		super(app);
		this.serverName = serverName;
		this.toolName = toolName;
		this.args = args;
	}

	waitForResponse(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: t('settings.mcp.permission.title') });

		const descEl = contentEl.createEl('p');
		const descText = t('settings.mcp.permission.desc', {
			server: this.serverName,
			tool: this.toolName
		});

		// Replace newlines with <br> or paragraphs
		const lines = descText.split('\n');
		lines.forEach(line => {
			descEl.createEl('span', { text: line });
			descEl.createEl('br');
		});

		contentEl.createEl('h4', { text: t('settings.mcp.permission.args'), cls: 'mcp-permission-args-title' });
		
		const preEl = contentEl.createEl('pre', { cls: 'mcp-permission-args' });
		preEl.createEl('code', { text: JSON.stringify(this.args, null, 2) });
		
		// Style the pre element a bit so it looks nice in Obsidian
		preEl.style.maxHeight = '200px';
		preEl.style.overflow = 'auto';
		preEl.style.backgroundColor = 'var(--background-secondary)';
		preEl.style.padding = '10px';
		preEl.style.borderRadius = '5px';

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(t('settings.mcp.permission.reject'))
					.setWarning()
					.onClick(() => {
						this.respond(false);
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(t('settings.mcp.permission.approve'))
					.setCta()
					.onClick(() => {
						this.respond(true);
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// If user closes modal by clicking outside or pressing ESC
		if (!this.responded) {
			this.respond(false);
		}
	}

	private respond(value: boolean) {
		if (this.responded) return;
		this.responded = true;
		if (this.resolvePromise) {
			this.resolvePromise(value);
		}
		this.close();
	}
}
