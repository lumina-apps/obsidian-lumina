import { App, TFile, TFolder } from "obsidian";
import type { ContextAttachment } from "../../../shared/types/chat.types";
import { estimateTokens } from "../../../shared/utils/tokenEstimator";
import { isExcluded } from "../../../shared/utils/exclusions";

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
	systemPrompt?: string;
	getFileSize?: (path: string) => number | undefined;
	getFolderSize?: (path: string, maxBytes?: number) => { size: number; isOverLimit: boolean } | number | undefined;
	maxTokenThreshold?: number;
	/** 프로바이더별 텍스트/이미지 토큰 추정 가중치 적용용 타입 */
	providerType?: string;
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
	excludedPaths?: string[],
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
		if (depth > 1 && excludedPaths?.length && isExcluded(f.path, excludedPaths)) return;
		visited.add(f.path);

		for (const child of f.children) {
			if (isOverLimit) break;
			if (depth > 1 && excludedPaths?.length && isExcluded(child.path, excludedPaths)) continue;
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

export const IMAGE_TOKEN_ESTIMATE = 1_600;
const IMAGE_EXTENSIONS_SET = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const BINARY_DOC_EXTENSIONS_SET = new Set(["pdf", "docx", "xlsx", "xls", "pptx", "epub"]);

/**
 * 프로바이더별 공식 비전 토큰 산출 기준에 따른 이미지당 예상 토큰을 반환합니다.
 * - OpenAI (`openai`, `cli-codex`): High Detail 4타일 기준 85 + 170 * 4 = 765
 * - Google Gemini (`google`, `cli-antigravity`): 타일(768px) 기준 258 * 3 = 774
 * - Anthropic Claude 및 기본값: 1568px 리사이즈 상한 기준 1,600
 */
export function getImageTokenEstimate(providerType?: string): number {
	if (!providerType) return IMAGE_TOKEN_ESTIMATE;
	const normalized = providerType.toLowerCase();
	if (normalized === "openai" || normalized === "cli-codex") {
		return 765;
	}
	if (normalized === "google" || normalized === "cli-antigravity") {
		return 774;
	}
	return IMAGE_TOKEN_ESTIMATE;
}

/**
 * 파일 크기(바이트)와 확장자를 기반으로 대략적인 텍스트 토큰을 추정합니다.
 * 압축 컨테이너 기반 바이너리 문서(PDF/Office)는 원시 바이트 대비 실제 추출 텍스트 비중이 낮으므로 보정합니다.
 */
function estimateTokensFromFileSize(size: number, ext: string): number {
	if (BINARY_DOC_EXTENSIONS_SET.has(ext)) {
		return Math.min(Math.ceil(size / 12), 30_000);
	}
	return Math.ceil(size / 3);
}

export function estimateInputTokensDetails(options: EstimateInputTokensOptions): EstimatedTokensResult {
	const {
		inputText,
		attachments,
		includeActiveNote,
		activeFileInfo,
		systemPrompt,
		getFileSize,
		getFolderSize,
		maxTokenThreshold = 100_000,
		providerType,
	} = options;

	const imageTokenEstimate = getImageTokenEstimate(providerType);
	let tokens = 0;
	let isOverLimit = false;

	if (inputText.trim()) {
		tokens += estimateTokens(inputText, providerType);
	}

	for (const att of attachments) {
		if (tokens >= maxTokenThreshold) {
			isOverLimit = true;
			break;
		}

		if (att.content) {
			if (att.content.startsWith("data:image/")) {
				tokens += imageTokenEstimate;
			} else {
				tokens += estimateTokens(att.content, providerType);
			}
		} else if (att.path && (att.type === "file" || att.type === "active_note" || att.type === "canvas")) {
			const ext = att.path.split(".").pop()?.toLowerCase() || "";
			if (IMAGE_EXTENSIONS_SET.has(ext)) {
				tokens += imageTokenEstimate;
			} else {
				const size = getFileSize ? getFileSize(att.path) : undefined;
				if (typeof size === "number") {
					tokens += estimateTokensFromFileSize(size, ext);
				}
			}
		} else if (att.type === "url") {
			tokens += 1000;
		} else if (att.type === "tag") {
			tokens += 500;
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
			const ext = activeFileInfo.path.split(".").pop()?.toLowerCase() || "";
			if (IMAGE_EXTENSIONS_SET.has(ext)) {
				tokens += imageTokenEstimate;
			} else {
				tokens += estimateTokensFromFileSize(activeFileInfo.size, ext);
			}
		}
	}

	if (tokens > 0 && systemPrompt?.trim()) {
		tokens += estimateTokens(systemPrompt, providerType);
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
