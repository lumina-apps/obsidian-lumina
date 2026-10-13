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
		// Live FileList must be cloned to Array before clearing input.value
		const files = Array.from(target.files);
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
		e.stopPropagation();
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			void handleFiles(Array.from(files), ctx);
			return;
		}

		// 옵시디언 내부 파일 탐색기 또는 에디터에서 드래그한 경우 지원 ([[노트명]], obsidian:// URL, 파일 경로)
		const text = e.dataTransfer?.getData("text/plain")?.trim();
		if (text && ctx.plugin?.app) {
			const app = ctx.plugin.app;
			const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
			let addedAny = false;

			for (let line of lines) {
				// 1) obsidian:// URL 처리 (파일 탐색기 드래그 시)
				if (line.startsWith("obsidian://")) {
					try {
						const parsed = new URL(line);
						const fileParam = parsed.searchParams.get("file");
						if (fileParam) {
							line = decodeURIComponent(fileParam);
						}
					} catch {
						const match = line.match(/file=([^&]+)/);
						if (match) line = decodeURIComponent(match[1]);
					}
				}

				// 2) [[wikilink]] 또는 파일 경로 정규화
				const linkpath = line.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
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
						addedAny = true;
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
						addedAny = true;
					}
				}
			}

			if (addedAny) {
				window.setTimeout(() => ctx.onResizeTextarea(), 0);
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

		const html = clipboardData.getData("text/html") || "";
		const hasPlainText = Boolean(clipboardData.getData("text/plain")?.trim());
		// MS Office(Excel/Word) 셀 복사 시 가상 렌더링 이미지 대신 텍스트를 우선하기 위한 전용 서명 검사
		const isOfficeCellCopy = hasPlainText && (
			html.includes("urn:schemas-microsoft-com:office") ||
			html.includes("mso-") ||
			/<table[^>]*>/i.test(html)
		);

		const files: File[] = [];
		if (clipboardData.files && clipboardData.files.length > 0) {
			for (let i = 0; i < clipboardData.files.length; i++) {
				files.push(normalizePastedFile(clipboardData.files[i]));
			}
		} else if (clipboardData.items) {
			const items = clipboardData.items;
			for (let i = 0; i < items.length; i++) {
				if (items[i].kind === "file") {
					const file = items[i].getAsFile();
					if (file) {
						files.push(normalizePastedFile(file));
					}
				}
			}
		}

		if (files.length > 0) {
			// 실제 Office 표/셀 복사인 경우에만 가상 이미지 첨부 무시
			if (isOfficeCellCopy && files.every((f) => f.name.startsWith("Pasted_Image_") || f.name === "image.png")) {
				return;
			}
			e.preventDefault?.();
			e.stopPropagation?.();
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