import { Notice } from "obsidian";
import type { ContextAttachment } from "../../../shared/types/chat.types";
import type LuminaPlugin from "../../../main";
import { debugLogger } from "../../../shared/debugLogger";

import { resizeImageDataUrl, MAX_ATTACHMENT_FILE_SIZE } from "./imageUtils";

export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
export const TEXT_EXTS = new Set([
	"md", "markdown", "txt", "csv", "json", "jsonl", "html", "htm",
	"yaml", "yml", "py", "ts", "tsx", "js", "jsx", "svelte", "vue",
	"css", "sh", "sql", "xml", "rs", "go", "java", "c", "cpp", "h",
	"rb", "php", "log", "toml", "ini", "kt", "swift"
]);
export const DOC_EXTS = new Set(["pdf", "docx", "xlsx", "xls", "pptx", "epub"]);

export const FILE_INPUT_ACCEPT = Array.from([
	...IMAGE_EXTS,
	...TEXT_EXTS,
	...DOC_EXTS,
]).map((ext) => `.${ext}`).join(",");

export function getImageMimeType(ext: string): string {
	const lower = ext.toLowerCase();
	if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
	if (lower === "png") return "image/png";
	if (lower === "webp") return "image/webp";
	if (lower === "gif") return "image/gif";
	return `image/${lower}`;
}

export async function readImageAsDataURL(file: File, ext?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = async () => {
			let result = reader.result as string;
			if (typeof result === "string" && !result.startsWith("data:image/") && ext) {
				const mime = getImageMimeType(ext);
				result = result.replace(/^data:[^;]*/, `data:${mime}`);
			}
			try {
				const resized = await resizeImageDataUrl(result);
				resolve(resized);
			} catch {
				resolve(result);
			}
		};
		reader.onerror = () => reject(reader.error ?? new Error(`Failed to read image: ${file.name}`));
		reader.onabort = () => reject(new Error(`Image reading aborted: ${file.name}`));
		reader.readAsDataURL(file);
	});
}

export async function readTextFile(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
		return text.replace(/^\uFEFF/, "");
	} catch {
		try {
			const text = new TextDecoder("euc-kr").decode(buffer);
			return text.replace(/^\uFEFF/, "");
		} catch {
			return new TextDecoder().decode(buffer).replace(/^\uFEFF/, "");
		}
	}
}

export async function readBinaryDocument(
	file: File,
	ext: string,
	plugin?: LuminaPlugin,
	t?: (key: string, vars?: Record<string, string>) => string,
): Promise<string | null> {
	if (!plugin?.embeddingWorker) {
		debugLogger.logWarn('file_attachment', `Worker not ready to parse binary file: ${file.name}`);
		if (t) new Notice(t('uiMessages.attachWorkerNotReady'));
		return null;
	}
	const buffer = await file.arrayBuffer();
	return plugin.embeddingWorker.parse(buffer, ext);
}

export async function readFileContent(
	file: File, 
	ext: string, 
	t: (key: string, vars?: Record<string, string>) => string,
	plugin?: LuminaPlugin
): Promise<string | null> {
	if (file.size > MAX_ATTACHMENT_FILE_SIZE) {
		debugLogger.logWarn('file_attachment', `File exceeds max limit (20MB): ${file.name}`);
		new Notice(t('uiMessages.attachFileTooLarge', { max: '20MB', file: file.name }));
		return null;
	}

	let content: string | null = null;
	if (IMAGE_EXTS.has(ext)) {
		content = await readImageAsDataURL(file, ext);
	} else if (TEXT_EXTS.has(ext)) {
		content = await readTextFile(file);
	} else if (DOC_EXTS.has(ext)) {
		content = await readBinaryDocument(file, ext, plugin, t);
	} else {
		new Notice(t('uiMessages.unsupportedFileType', { ext }));
		return null;
	}

	if (content === null) {
		return null;
	}

	if (!content.trim()) {
		debugLogger.logWarn('file_attachment', `File content is empty: ${file.name}`);
		new Notice(t('uiMessages.attachFileEmpty', { file: file.name }));
		return null;
	}

	return content;
}

export function extractFileFromEntry(entry: File | DataTransferItem): File | null {
	if (entry instanceof File) return entry;
	if ("getAsFile" in entry && entry.kind === "file") {
		return entry.getAsFile();
	}
	return null;
}

export async function processFiles(
	files: FileList | File[] | DataTransferItemList,
	existingAttachments: ContextAttachment[],
	t: (key: string, vars?: Record<string, string>) => string,
	plugin?: LuminaPlugin
): Promise<ContextAttachment[]> {
	const newAttachments: ContextAttachment[] = [];

	for (let i = 0; i < files.length; i++) {
		const file = extractFileFromEntry(files[i]);
		if (!file) continue;

		const ext = file.name.split(".").pop()?.toLowerCase() || "";

		// Check if already exists
		if (
			existingAttachments.find((a) => a.name === file.name && a.type === "external_file") ||
			newAttachments.find((a) => a.name === file.name && a.type === "external_file")
		) {
			new Notice(t('uiMessages.attachDuplicate', { file: file.name }));
			continue;
		}

		try {
			const content = await readFileContent(file, ext, t, plugin);
			if (content === null) continue;

			newAttachments.push({
				type: "external_file",
				path: "",
				name: file.name,
				content,
			});
		} catch (error) {
			debugLogger.logError('file_attachment', error instanceof Error ? error : new Error(String(error)));
			new Notice(t('uiMessages.attachFileFailed', { file: file.name }));
		}
	}

	return newAttachments;
}

/**
 * 붙여넣기된 파일의 이름을 보정합니다. (클립보드 이미지 등)
 */
export function normalizePastedFile(file: File): File {
	const ext = file.type.split("/")[1] || "png";
	if (file.name === "image.png" || !file.name.includes(".")) {
		return new File([file], `Pasted_Image_${Date.now()}.${ext}`, {
			type: file.type,
		});
	}
	return file;
}

export function getAttachmentIcon(type: string): string {
	switch (type) {
		case "file": return "file-text";
		case "folder": return "folder";
		case "active_note": return "file-edit";
		case "selection": return "mouse-pointer-2";
		case "canvas": return "layout";
		case "tag": return "hash";
		case "url": return "globe";
		case "external_file": return "paperclip";
		default: return "file";
	}
}
