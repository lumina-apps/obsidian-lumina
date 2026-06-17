import type LuminaPlugin from "../../../../main";
import type { ContextAttachment } from "../../../../shared/types/chat.types";
import {
	processFiles,
	normalizePastedFile,
} from "../../utils/fileAttachmentUtils";

/**
 * 파일 첨부 관련 컨텍스트입니다.
 */
export interface FileAttachmentContext {
	plugin: LuminaPlugin;
	attachments: ContextAttachment[];
	setAttachments: (a: ContextAttachment[]) => void;
	t: (key: string, vars?: Record<string, string>) => string;
	onResizeTextarea: () => void;
}

/**
 * 파일 선택 input 클릭 트리거
 */
export function createFileInputTrigger(
	getFileInputEl: () => HTMLInputElement | null,
): () => void {
	return () => {
		const el = getFileInputEl();
		if (el) el.click();
	};
}

/**
 * input[type=file] change 이벤트 핸들러
 */
export function createFileSelectHandler(
	ctx: FileAttachmentContext,
): (e: Event) => void {
	return async (e: Event) => {
		const target = e.target as HTMLInputElement;
		if (!target.files || target.files.length === 0) return;
		await handleFiles(target.files, ctx);
		target.value = "";
	};
}

/**
 * drop 이벤트 핸들러
 */
export function createDropHandler(
	ctx: FileAttachmentContext,
): (e: DragEvent) => void {
	return async (e: DragEvent) => {
		e.preventDefault();
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			await handleFiles(files, ctx);
		}
	};
}

/**
 * dragover 이벤트 핸들러 (기본 동작 방지)
 */
export function createDragOverHandler(): (e: DragEvent) => void {
	return (e: DragEvent) => {
		e.preventDefault();
	};
}

/**
 * 붙여넣기 이벤트 핸들러
 */
export function createPasteHandler(
	ctx: FileAttachmentContext,
): (e: ClipboardEvent) => void {
	return async (e: ClipboardEvent) => {
		const items = e.clipboardData?.items;
		if (!items) return;

		const files: File[] = [];
		for (let i = 0; i < items.length; i++) {
			if (items[i].kind === "file") {
				const file = items[i].getAsFile();
				if (file) {
					files.push(normalizePastedFile(file));
				}
			}
		}

		if (files.length > 0) {
			await handleFiles(files, ctx);
		}
	};
}

/**
 * 첨부파일 제거
 */
export function createRemoveAttachment(
	attachments: ContextAttachment[],
	setAttachments: (a: ContextAttachment[]) => void,
): (index: number) => void {
	return (index: number) => {
		setAttachments(attachments.filter((_, i) => i !== index));
	};
}

/**
 * 파일 처리 공통 로직 (processFiles 호출 → attachments 업데이트)
 */
async function handleFiles(
	files: FileList | File[],
	ctx: FileAttachmentContext,
): Promise<void> {
	const { plugin, attachments, setAttachments, t, onResizeTextarea } = ctx;
	const newAtts = await processFiles(files, attachments, t, plugin);
	if (newAtts.length > 0) {
		setAttachments([...attachments, ...newAtts]);
		// tick().then(() => resizeTextarea()) 와 동일하게
		setTimeout(() => onResizeTextarea(), 0);
	}
}