import { App, TFile, TFolder } from "obsidian";
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
	getFolderSize?: (path: string, maxBytes?: number) => { size: number; isOverLimit: boolean } | number | undefined;
	maxTokenThreshold?: number;
}

export interface EstimatedTokensResult {
	tokens: number;
	isOverLimit: boolean;
	displayText: string;
}

/**
 * 메모리 내 TFolder 트리 순회를 통해 하위 .md 파일들의 크기를 합산한다.
 * maxBytes 도달 시 즉시 순회를 중단(short-circuit)하여 UI 버벅임을 방지한다.
 */
export function calculateFolderSize(
	app: App,
	folderPath: string,
	maxBytes: number = 300_000,
	maxDepth: number = 15,
): { size: number; isOverLimit: boolean } {
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		return { size: 0, isOverLimit: false };
	}

	let totalSize = 0;
	let isOverLimit = false;
	const visited = new Set<string>();

	function traverse(f: TFolder, depth: number) {
		if (isOverLimit || depth > maxDepth) return;
		if (visited.has(f.path)) return;
		visited.add(f.path);

		for (const child of f.children) {
			if (isOverLimit) break;
			if (child instanceof TFile && child.extension === "md") {
				totalSize += child.stat.size;
				if (totalSize >= maxBytes) {
					isOverLimit = true;
					break;
				}
			} else if (child instanceof TFolder) {
				traverse(child, depth + 1);
			}
		}
	}

	traverse(folder, 1);
	return { size: totalSize, isOverLimit };
}

export function estimateInputTokensDetails(options: EstimateInputTokensOptions): EstimatedTokensResult {
	const {
		inputText,
		attachments,
		includeActiveNote,
		activeFileInfo,
		getFileSize,
		getFolderSize,
		maxTokenThreshold = 100_000,
	} = options;

	let tokens = 0;
	let isOverLimit = false;

	if (inputText.trim()) {
		tokens += estimateTokens(inputText);
	}

	for (const att of attachments) {
		if (tokens >= maxTokenThreshold) {
			isOverLimit = true;
			break;
		}

		if (att.content) {
			tokens += estimateTokens(att.content);
		} else if (att.path && (att.type === "file" || att.type === "active_note")) {
			const size = getFileSize ? getFileSize(att.path) : undefined;
			if (typeof size === "number") {
				tokens += Math.ceil(size / 3);
			}
		} else if (att.path && att.type === "folder") {
			if (getFolderSize) {
				const remainingTokens = Math.max(0, maxTokenThreshold - tokens);
				const maxBytes = remainingTokens * 3;
				const res = getFolderSize(att.path, maxBytes);
				if (typeof res === "number") {
					tokens += Math.ceil(res / 3);
				} else if (res && typeof res.size === "number") {
					tokens += Math.ceil(res.size / 3);
					if (res.isOverLimit) {
						isOverLimit = true;
					}
				}
			}
		}
	}

	if (!isOverLimit && includeActiveNote && activeFileInfo) {
		const alreadyIncluded = attachments.some(
			(att) => att.type === "active_note" || (att.type === "file" && att.path === activeFileInfo.path),
		);
		if (!alreadyIncluded) {
			tokens += Math.ceil(activeFileInfo.size / 3);
		}
	}

	if (tokens >= maxTokenThreshold) {
		isOverLimit = true;
	}

	const displayText = isOverLimit
		? "> 100k tokens"
		: tokens > 0
			? `~${tokens.toLocaleString()} tokens`
			: "";

	return {
		tokens,
		isOverLimit,
		displayText,
	};
}

export function calculateEstimatedInputTokens(options: EstimateInputTokensOptions): number {
	return estimateInputTokensDetails(options).tokens;
}
