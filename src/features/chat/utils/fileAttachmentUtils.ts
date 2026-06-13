import { Notice } from "obsidian";
import type { ContextAttachment } from "../../../shared/types/chat.types";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const TEXT_EXTS = new Set(["md", "txt", "csv", "json", "jsonl", "html", "htm"]);
const DOC_EXTS = new Set(["pdf", "docx", "xlsx", "xls"]);

export async function readImageAsDataURL(file: File): Promise<string> {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.readAsDataURL(file);
	});
}

export async function readTextFile(file: File): Promise<string> {
	return file.text();
}

export async function readBinaryDocument(file: File, ext: string): Promise<string> {
	const buffer = await file.arrayBuffer();
	const { DocumentParserRouter } = await import(
		"../../rag/parsers/DocumentParserRouter"
	);
	return DocumentParserRouter.parseBuffer(buffer, ext);
}

export async function readFileContent(
	file: File, 
	ext: string, 
	t: (key: string, vars?: Record<string, string>) => string
): Promise<string | null> {
	if (IMAGE_EXTS.has(ext)) {
		return readImageAsDataURL(file);
	}
	if (TEXT_EXTS.has(ext)) {
		return readTextFile(file);
	}
	if (DOC_EXTS.has(ext)) {
		return readBinaryDocument(file, ext);
	}
	new Notice(t('uiMessages.unsupportedFileType', { ext }));
	return null;
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
	t: (key: string, vars?: Record<string, string>) => string
): Promise<ContextAttachment[]> {
	const newAttachments: ContextAttachment[] = [];

	for (let i = 0; i < files.length; i++) {
		const file = extractFileFromEntry(files[i] as File | DataTransferItem);
		if (!file) continue;

		const ext = file.name.split(".").pop()?.toLowerCase() || "";

		// Check if already exists
		if (
			existingAttachments.find((a) => a.name === file.name && a.type === "external_file") ||
			newAttachments.find((a) => a.name === file.name && a.type === "external_file")
		) {
			continue;
		}

		try {
			const content = await readFileContent(file, ext, t);
			if (content === null) continue;

			newAttachments.push({
				type: "external_file",
				path: "",
				name: file.name,
				content,
			});
		} catch (error) {
			console.error("Failed to attach file:", error);
			new Notice(t('uiMessages.attachFileFailed', { file: file.name }));
		}
	}

	return newAttachments;
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
