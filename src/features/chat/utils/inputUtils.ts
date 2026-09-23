import type { ContextAttachment } from "../../../shared/types/chat.types";
import { estimateTokens } from "../../../shared/utils/tokenEstimator";

export function splitProviderModel(val: string): [string, string] {
	const idx = val.indexOf("::");
	if (idx === -1) return [val, ""];
	return [val.slice(0, idx), val.slice(idx + 2)];
}

export function detectMention(val: string, cursor: number, lastAt: number): { detected: boolean; query: string; startIndex: number } {
	if (lastAt === -1) return { detected: false, query: "", startIndex: -1 };
	if (lastAt !== 0 && !/\s/.test(val[lastAt - 1])) return { detected: false, query: "", startIndex: -1 };

	const query = val.slice(lastAt + 1, cursor);
	// 줄바꿈이 포함되었거나, @ 바로 뒤가 공백이거나, 너무 긴 쿼리는 멘션으로 보지 않음
	if (query.includes("\n") || query.startsWith(" ") || query.length > 50) {
		return { detected: false, query: "", startIndex: -1 };
	}

	return { detected: true, query, startIndex: lastAt };
}

export function detectSlashCommand(val: string, cursor: number, lastSlash: number): { detected: boolean; query: string; startIndex: number } {
	if (lastSlash === -1) return { detected: false, query: "", startIndex: -1 };
	if (lastSlash !== 0 && !/\s/.test(val[lastSlash - 1])) return { detected: false, query: "", startIndex: -1 };

	const query = val.slice(lastSlash + 1, cursor);
	if (query.includes("\n") || query.startsWith(" ")) {
		return { detected: false, query: "", startIndex: -1 };
	}

	const trimmed = query.trim();
	// 슬래시 명령어 내부의 공백(인자 형태) 또는 30자 초과는 명령어 목록 검색 대상에서 제외
	if (/\s/.test(trimmed) || trimmed.length > 30) {
		return { detected: false, query: "", startIndex: -1 };
	}

	return { detected: true, query: trimmed, startIndex: lastSlash };
}

export interface EstimateInputTokensOptions {
	inputText: string;
	attachments: ContextAttachment[];
	includeActiveNote?: boolean;
	activeFileInfo?: { path: string; size: number } | null;
	getFileSize?: (path: string) => number | undefined;
}

export function calculateEstimatedInputTokens(options: EstimateInputTokensOptions): number {
	const { inputText, attachments, includeActiveNote, activeFileInfo, getFileSize } = options;
	let tokens = 0;
	if (inputText.trim()) {
		tokens += estimateTokens(inputText);
	}
	for (const att of attachments) {
		if (att.content) {
			tokens += estimateTokens(att.content);
		} else if (att.path && (att.type === "file" || att.type === "active_note")) {
			const size = getFileSize ? getFileSize(att.path) : undefined;
			if (typeof size === "number") {
				tokens += Math.ceil(size / 3);
			}
		}
	}
	if (includeActiveNote && activeFileInfo) {
		const alreadyIncluded = attachments.some(
			(att) => att.type === "active_note" || (att.type === "file" && att.path === activeFileInfo.path),
		);
		if (!alreadyIncluded) {
			tokens += Math.ceil(activeFileInfo.size / 3);
		}
	}
	return tokens;
}
