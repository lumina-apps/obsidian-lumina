import { App, Modal, TFile } from 'obsidian';
import { diffLines, type Change } from 'diff';
import type { CliFileEditLog } from '../../../../shared/types/cliAgent.types';
import { toVaultRelativePath } from '../../../../shared/utils/fileUtils';
import { t } from '../../../../shared/locales/helpers';
import { debugLogger } from '../../../../shared/debugLogger';
import { computeInlineDiff, type InlineSegment } from '../../../../shared/utils/inlineDiff';

export class CliDiffModal extends Modal {
	private fileEdit: CliFileEditLog;

	constructor(app: App, fileEdit: CliFileEditLog) {
		super(app);
		this.fileEdit = fileEdit;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lumina-cli-diff-modal');

		const relPath = toVaultRelativePath(this.app, this.fileEdit.path);

		// 1. 헤더 영역
		const headerEl = contentEl.createDiv({ cls: 'lumina-cli-diff-modal__header' });
		headerEl.createEl('h3', { text: t('settings.cli.diffModalTitle') || 'File Changes (Diff)' });

		const metaEl = headerEl.createDiv({ cls: 'lumina-cli-diff-modal__meta' });
		metaEl.createSpan({
			cls: `lumina-cli-diff-modal__badge is-${this.fileEdit.action}`,
			text: this.fileEdit.action.toUpperCase(),
		});
		metaEl.createSpan({
			cls: 'lumina-cli-diff-modal__path',
			text: relPath || this.fileEdit.path,
		});

		// 2. Diff 계산
		let before = this.fileEdit.beforeContent ?? '';
		let after = this.fileEdit.afterContent ?? '';

		if (!after && this.fileEdit.action !== 'delete') {
			const file = this.app.vault.getAbstractFileByPath(relPath);
			if (file instanceof TFile) {
				try {
					after = await this.app.vault.read(file);
				} catch (e) {
					debugLogger.logWarn('cli-agent', `Failed to read after content: ${e}`);
				}
			}
		}

		let changes: Change[] = [];
		if (this.fileEdit.diff) {
			changes = [{ value: this.fileEdit.diff, added: false, removed: false, count: 1 }];
		} else {
			changes = diffLines(before, after);
		}

		let addedCount = 0;
		let removedCount = 0;
		for (const ch of changes) {
			if (ch.added) addedCount += ch.count ?? 1;
			if (ch.removed) removedCount += ch.count ?? 1;
		}

		const statsEl = headerEl.createDiv({ cls: 'lumina-cli-diff-modal__stats' });
		if (addedCount > 0) {
			statsEl.createSpan({ cls: 'lumina-cli-diff-modal__stat-add', text: `+${addedCount}` });
		}
		if (removedCount > 0) {
			statsEl.createSpan({ cls: 'lumina-cli-diff-modal__stat-rem', text: `-${removedCount}` });
		}

		// 3. Diff 본문 렌더링
		const containerEl = contentEl.createDiv({ cls: 'lumina-cli-diff-container' });

		if (changes.length === 0 || (changes.length === 1 && !changes[0].added && !changes[0].removed && !changes[0].value.trim())) {
			containerEl.createDiv({
				cls: 'lumina-cli-diff-empty',
				text: 'No differences detected or file is empty.',
			});
			return;
		}

		const linesEl = containerEl.createDiv({ cls: 'lumina-cli-diff-lines' });

		// 인접한 삭제/추가 블록 쌍에 대해 줄별 인라인 diff 세그먼트 계산
		const inlineMap = new Map<number, (InlineSegment[] | null)[]>();
		for (let i = 0; i < changes.length - 1; i++) {
			if (changes[i].removed && changes[i + 1].added) {
				const inline = computeInlineDiff(changes[i].value, changes[i + 1].value);
				inlineMap.set(i, inline.removed);
				inlineMap.set(i + 1, inline.added);
			}
		}

		for (let chIdx = 0; chIdx < changes.length; chIdx++) {
			const ch = changes[chIdx];
			const lineClass = ch.added
				? 'lumina-cli-diff-line is-added'
				: ch.removed
					? 'lumina-cli-diff-line is-removed'
					: 'lumina-cli-diff-line';
			const marker = ch.added ? '+' : ch.removed ? '-' : ' ';
			const lines = ch.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
			const inlineLines = inlineMap.get(chIdx);
			const inlineCls = ch.added ? 'lumina-diff-inline-added' : 'lumina-diff-inline-removed';

			for (let i = 0; i < lines.length; i++) {
				if (i === lines.length - 1 && lines[i] === '') continue;
				const lineEl = linesEl.createDiv({ cls: lineClass });
				lineEl.createSpan({ cls: 'lumina-cli-diff-marker', text: marker });

				const segments = inlineLines?.[i];
				if (segments && segments.length > 0) {
					const textSpan = lineEl.createSpan({ cls: 'lumina-cli-diff-text' });
					for (const seg of segments) {
						if (seg.changed) {
							textSpan.createSpan({ cls: inlineCls, text: seg.text });
						} else {
							textSpan.appendChild(document.createTextNode(seg.text));
						}
					}
				} else {
					lineEl.createSpan({ cls: 'lumina-cli-diff-text', text: lines[i] });
				}
			}
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

