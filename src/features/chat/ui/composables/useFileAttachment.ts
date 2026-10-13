import { TFile, TFolder } from "obsidian";
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
	setIsProcessing?: (isProcessing: boolean) => void;
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
	return (e: Event) => {
		const target = e.target as HTMLInputElement;
		if (!target.files || target.files.length === 0) return;
		const files = target.files;
		target.value = "";
		void handleFiles(files, ctx);
	};
}

/**
 * drop 이벤트 핸들러
 */
export function createDropHandler(
	ctx: FileAttachmentContext,
): (e: DragEvent) => void {
	return (e: DragEvent) => {
		e.preventDefault();
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			void handleFiles(files, ctx);
			return;
		}

		// 옵시디언 내부 파일 탐색기에서 드래그한 경우 지원 ([[노트명]] 또는 파일 경로)
		const text = e.dataTransfer?.getData("text/plain")?.trim();
		if (text && ctx.plugin?.app) {
			const app = ctx.plugin.app;
			const linkpath = text.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
			const target = app.metadataCache.getFirstLinkpathDest(linkpath, "") ??
				app.vault.getAbstractFileByPath(linkpath) ??
				app.vault.getAbstractFileByPath(`${linkpath}.md`);

			const isTFile = target instanceof TFile || (target && typeof target === "object" && "extension" in target);
			const isTFolder = target instanceof TFolder || (target && typeof target === "object" && "children" in target);

			if (isTFile) {
				const file = target as TFile;
				const isCanvas = file.extension === "canvas";
				const newAttachment: ContextAttachment = {
					type: isCanvas ? "canvas" : "file",
					path: file.path,
					name: file.extension === "md" ? file.basename : file.name,
				};
				const latest = ctx.attachments;
				if (!latest.some((a) => a.path === newAttachment.path)) {
					ctx.setAttachments([...latest, newAttachment]);
					window.setTimeout(() => ctx.onResizeTextarea(), 0);
				}
			} else if (isTFolder) {
				const folder = target as TFolder;
				const newAttachment: ContextAttachment = {
					type: "folder",
					path: folder.path,
					name: folder.name,
				};
				const latest = ctx.attachments;
				if (!latest.some((a) => a.path === newAttachment.path)) {
					ctx.setAttachments([...latest, newAttachment]);
					window.setTimeout(() => ctx.onResizeTextarea(), 0);
				}
			}
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
	return (e: ClipboardEvent) => {
		const clipboardData = e.clipboardData;
		if (!clipboardData) return;
		const items = clipboardData.items;
		if (!items) return;

		const hasPlainText = Boolean(clipboardData.getData("text/plain")?.trim());

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
			// Office 앱(Excel/Word 등)에서 셀 복사 시 text/plain과 가상 렌더링 image.png가 동시에 들어오는 경우
			// 텍스트 붙여넣기를 우선하고 가상 이미지 첨부는 무시
			if (hasPlainText && files.every((f) => f.name.startsWith("Pasted_Image_") || f.name === "image.png")) {
				return;
			}
			e.preventDefault?.();
			void handleFiles(files, ctx);
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
export async function handleFiles(
	files: FileList | File[],
	ctx: FileAttachmentContext,
): Promise<void> {
	const { plugin, setAttachments, t, onResizeTextarea, setIsProcessing } = ctx;
	setIsProcessing?.(true);
	try {
		const currentBefore = ctx.attachments;
		const newAtts = await processFiles(files, currentBefore, t, plugin);
		if (newAtts.length > 0) {
			const latest = ctx.attachments;
			const deduped = newAtts.filter(
				(n) => !latest.some((a) => a.type === "external_file" && a.name === n.name),
			);
			if (deduped.length > 0) {
				setAttachments([...latest, ...deduped]);
				// tick().then(() => resizeTextarea()) 와 동일하게
				window.setTimeout(() => onResizeTextarea(), 0);
			}
		}
	} finally {
		setIsProcessing?.(false);
	}
}