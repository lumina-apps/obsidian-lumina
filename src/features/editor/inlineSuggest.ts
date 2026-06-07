import {
	Editor,
	EditorSuggest,
	MarkdownView,
	Notice,
	TFile,
} from 'obsidian';
import type {
	EditorPosition,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
} from 'obsidian';
import type LuminaPlugin from '../../main';
import type { QuickAction } from '../../shared/types/settings.types';
import { t } from '../../shared/locales/helpers';

export class InlineAISuggest extends EditorSuggest<QuickAction> {
	private plugin: LuminaPlugin;

	constructor(plugin: LuminaPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile
	): EditorSuggestTriggerInfo | null {
		const trigger = this.plugin.settings.chat.inlineTrigger || '/ai';
		const line = editor.getLine(cursor.line);
		const sub = line.substring(0, cursor.ch);

		// 트리거(예: /ai)로 끝나면 제안 시작
		if (sub.endsWith(trigger)) {
			return {
				start: { line: cursor.line, ch: cursor.ch - trigger.length },
				end: cursor,
				query: '',
			};
		}
		
		// 트리거 뒤에 텍스트가 있으면 필터 쿼리로 인식
		const escapedTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const match = sub.match(new RegExp(`${escapedTrigger}(.*)$`));
		if (match) {
			return {
				start: { line: cursor.line, ch: match.index! },
				end: cursor,
				query: match[1],
			};
		}

		return null;
	}

	getSuggestions(context: EditorSuggestContext): QuickAction[] {
		const { quickActionProviderId, quickActionModelId } = this.plugin.settings.connections;
		if (!quickActionProviderId || !quickActionModelId) {
			return [{
				id: '__unconfigured__',
				name: t('uiMessages.qaNotConfigured'),
				prompt: '',
				actionType: 'replace'
			}];
		}

		const actions = this.plugin.settings.chat.quickActions || [];
		const lowerQuery = context.query.trim().toLowerCase();
		if (!lowerQuery) {
			return actions;
		}
		return actions.filter((a) => a.name.toLowerCase().includes(lowerQuery));
	}

	renderSuggestion(action: QuickAction, el: HTMLElement): void {
		if (action.id === '__unconfigured__') {
			el.createEl('span', { text: `⚠️ ${action.name}`, cls: 'lumina-inline-suggest-name' });
			el.createEl('small', {
				text: t('common.settings'),
				cls: 'lumina-inline-suggest-type',
				attr: { style: 'color: var(--text-error); margin-left: 8px;' }
			});
			return;
		}

		el.createEl('span', { text: `✨ ${action.name}`, cls: 'lumina-inline-suggest-name' });
		el.createEl('small', {
			text: action.actionType === 'replace' ? t('uiMessages.inlineReplace') : action.actionType === 'append' ? t('uiMessages.inlineAppend') : t('uiMessages.inlineSend'),
			cls: 'lumina-inline-suggest-type',
			attr: { style: 'color: var(--text-muted); margin-left: 8px;' }
		});
	}

	async selectSuggestion(action: QuickAction, evt: MouseEvent | KeyboardEvent): Promise<void> {
		if (!this.context) return;
		const { editor, start, end } = this.context;
		
		// 트리거 문자열 제거
		editor.replaceRange('', start, end);
		
		if (action.id === '__unconfigured__') {
			// @ts-ignore
			this.plugin.app.setting.open();
			// @ts-ignore
			this.plugin.app.setting.openTabById(this.plugin.manifest.id);
			return;
		}
		
		const lineContent = editor.getLine(start.line);
		let selection = editor.getSelection();

		// 선택된 텍스트가 없을 때 컨텍스트 추론
		if (!selection) {
			if (lineContent.trim() === '') {
				// 빈 줄일 경우: 알림 띄우고 중단
				new Notice(t('uiMessages.inlineEmpty'));
				return;
			} else {
				// 같은 줄에 텍스트가 있을 경우: 해당 줄을 컨텍스트로 사용
				editor.setSelection({ line: start.line, ch: 0 }, { line: start.line, ch: lineContent.length });
			}
		}

		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			await this.plugin.quickActionHandler.executeAction(action, editor, view);
			
			// 덧붙이기(append) 모드 등일 때 전체가 선택되어 있으면 UX가 좋지 않으므로
			// 실행 완료 후 커서를 문서의 끝이나 적절한 위치로 옮길 수 있습니다.
			// 단, QuickActionHandler가 비동기로 동작하고 replaceSelection을 사용하므로,
			// 선택 영역이 처리 결과로 대체되면서 자연스럽게 커서가 끝으로 이동합니다.
		}
	}
}
