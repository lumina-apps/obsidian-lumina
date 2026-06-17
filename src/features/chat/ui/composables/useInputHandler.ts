import { tick } from "svelte";
import type LuminaPlugin from "../../../../main";
import type { ContextAttachment } from "../../../../shared/types/chat.types";
import type { SlashCommand } from "../../types/slashCommand.types";
import { detectMention, detectSlashCommand } from "../../utils/inputUtils";
import { resizeTextarea } from "../../utils/textareaUtils";

/**
 * 키 입력 시 전송 처리 및 슬래시/컨텍스트 셀렉터 키 중재를 담당합니다.
 */
export interface KeydownContext {
	plugin: LuminaPlugin;
	showSlashSelector: boolean;
	showContextSelector: boolean;
	onSendMessage: () => void;
}

export function createKeydownHandler(ctx: KeydownContext): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		const { plugin, showSlashSelector, showContextSelector, onSendMessage } = ctx;

		// 셀렉터가 열려 있으면 Enter 방지 후 반환 (Selector 컴포넌트가 처리)
		if (showSlashSelector && ["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) {
			if (e.key === "Enter") e.preventDefault();
			return;
		}

		if (showContextSelector && ["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) {
			if (e.key === "Enter") e.preventDefault();
			return;
		}

		const sendKey = plugin.settings.chat.sendKey;
		const isComposing = e.isComposing || e.keyCode === 229;

		if (sendKey === "enter" && e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (isComposing) {
				setTimeout(() => onSendMessage(), 50);
			} else {
				onSendMessage();
			}
		} else if (sendKey === "ctrl_enter" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			if (isComposing) {
				setTimeout(() => onSendMessage(), 50);
			} else {
				onSendMessage();
			}
		}
	};
}

/**
 * textarea 입력 시 멘션(@), 슬래시(/) 명령어 감지 및 셀렉터 상태를 결정합니다.
 */
export interface InputHandlerContext {
	getTextareaEl: () => HTMLTextAreaElement | null;
	setShowContextSelector: (v: boolean) => void;
	setContextSearchQuery: (v: string) => void;
	setMentionStartIndex: (v: number) => void;
	setShowSlashSelector: (v: boolean) => void;
	setSlashSearchQuery: (v: string) => void;
	setSlashStartIndex: (v: number) => void;
}

export function createInputHandler(
	ctx: InputHandlerContext,
): () => void {
	return () => {
		const el = ctx.getTextareaEl();
		if (!el) return;
		resizeTextarea(el);

		const val = el.value;
		const cursor = el.selectionStart;

		const lastAt = val.lastIndexOf("@", cursor - 1);
		const lastSlash = val.lastIndexOf("/", cursor - 1);

		if (lastAt >= lastSlash) {
			const res = detectMention(val, cursor, lastAt);
			if (res.detected) {
				ctx.setShowContextSelector(true);
				ctx.setShowSlashSelector(false);
				ctx.setContextSearchQuery(res.query);
				ctx.setMentionStartIndex(res.startIndex);
				return;
			}
		} else {
			const res = detectSlashCommand(val, cursor, lastSlash);
			if (res.detected) {
				ctx.setShowSlashSelector(true);
				ctx.setShowContextSelector(false);
				ctx.setSlashSearchQuery(res.query);
				ctx.setSlashStartIndex(res.startIndex);
				return;
			}
		}

		ctx.setShowContextSelector(false);
		ctx.setShowSlashSelector(false);
	};
}

/**
 * @ 버튼 클릭 시 커서 위치에 "@"를 삽입합니다.
 */
export interface MentionInsertContext {
	getTextareaEl: () => HTMLTextAreaElement | null;
	getInputText: () => string;
	setInputText: (v: string) => void;
	afterInsert?: () => void;
}

export function createContextMentionInserter(
	ctx: MentionInsertContext,
): (e: MouseEvent) => void {
	return (e: MouseEvent) => {
		e.stopPropagation();
		const el = ctx.getTextareaEl();
		const cursor = el?.selectionStart ?? ctx.getInputText().length;
		const current = ctx.getInputText();
		const prefix = cursor > 0 && !/\s/.test(current[cursor - 1]) ? " @" : "@";
		const newInput = current.slice(0, cursor) + prefix + current.slice(cursor);
		ctx.setInputText(newInput);

		const newCursor = cursor + prefix.length;
		tick().then(() => {
			const el = ctx.getTextareaEl();
			if (el) {
				el.focus();
				el.selectionStart = newCursor;
				el.selectionEnd = newCursor;
				ctx.afterInsert?.();
			}
		});
	};
}

/**
 * 컨텍스트 선택 시: 중복 체크 후 attachments에 추가, 멘션 텍스트 제거.
 */
export interface ContextSelectContext {
	attachments: ContextAttachment[];
	setAttachments: (a: ContextAttachment[]) => void;
	mentionStartIndex: number;
	getTextareaEl: () => HTMLTextAreaElement | null;
	getInputText: () => string;
	setInputText: (v: string) => void;
	afterSelect?: () => void;
}

export function createContextSelectHandler(
	ctx: ContextSelectContext,
): (attachment: ContextAttachment) => void {
	return (attachment: ContextAttachment) => {
		const existing = ctx.attachments.find(
			(a) => a.path === attachment.path && a.type === attachment.type,
		);
		if (!existing) {
			ctx.setAttachments([...ctx.attachments, attachment]);
		}

		if (ctx.mentionStartIndex !== -1) {
			const el = ctx.getTextareaEl();
			if (el) {
				const val = ctx.getInputText();
				const before = val.slice(0, ctx.mentionStartIndex);
				const after = val.slice(el.selectionStart);
				ctx.setInputText(before + after);
			}
		}

		ctx.afterSelect?.();

		tick().then(() => ctx.getTextareaEl()?.focus());
	};
}

/**
 * 슬래시 명령어 선택 시: 슬래시 텍스트 제거 후 해당 명령어 실행.
 */
export interface SlashSelectContext {
	slashStartIndex: number;
	getTextareaEl: () => HTMLTextAreaElement | null;
	getInputText: () => string;
	setInputText: (v: string) => void;
	afterSelect?: () => void;
}

export function createSlashSelectHandler(
	ctx: SlashSelectContext,
): (cmd: SlashCommand) => void {
	return (cmd: SlashCommand) => {
		if (ctx.slashStartIndex !== -1) {
			const el = ctx.getTextareaEl();
			if (el) {
				const val = ctx.getInputText();
				const before = val.slice(0, ctx.slashStartIndex);
				const after = val.slice(el.selectionStart);
				ctx.setInputText(before + after);
			}
		}

		ctx.afterSelect?.();

		tick().then(() => {
			ctx.getTextareaEl()?.focus();
			cmd.action();
		});
	};
}