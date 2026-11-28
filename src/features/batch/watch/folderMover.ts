/**
 * folderMover.ts
 *
 * 안전한 볼트 내 폴더 이동 라우팅 및 충돌 방지 실행 유틸리티.
 * - 고정 폴더 이동 (`fixed`)
 * - 태그 기반 폴더 이동 (`by-tag`)
 * - 허용 폴더 화이트리스트 기반 AI 자동 분류 이동 (`ai-route`)
 * - 경로 순회(`..`), 시스템/제외 폴더, 소스 폴더 순환 이동 원천 차단
 */

import { App, TFile, normalizePath } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type {
	FolderMoveConfig,
	MoveConflictPolicy,
} from '../../../shared/types/batchWatch.types';
import type { ResponseFormatOptions } from '../../../shared/types/llm.types';
import { isExcluded } from '../../../shared/utils/exclusions';
import { ensureFolderExists, sanitizeFilePath } from '../../../shared/utils/fileUtils';
import { normalizeFrontmatterTags } from '../../../shared/utils/frontmatterSanitizer';
import {
	callBatchLlm,
	extractJsonObject,
	splitFrontmatterAndBody,
} from '../recipes/batchLlmHelper';

/** AI 폴더 분류 시 grammar 컴파일 과부하를 방지하기 위한 enum 최대 후보 개수 */
const FOLDER_ROUTE_MAX_ENUM_SIZE = 50;

/** AI 폴더 분류용 Structured Output 스키마를 후보 목록 크기에 맞춰 생성합니다. */
function buildFolderRouteResponseFormat(validCandidates: readonly string[]): ResponseFormatOptions {
	const folderProperty: Record<string, unknown> =
		validCandidates.length <= FOLDER_ROUTE_MAX_ENUM_SIZE
			? { type: 'string', enum: [...validCandidates, 'NONE'] }
			: { type: 'string' };

	return {
		type: 'json_schema',
		jsonSchema: {
			name: 'folder_route_classification',
			description: 'Classified destination folder path from allowed candidates or NONE, plus short reason',
			schema: {
				type: 'object',
				properties: {
					folder: folderProperty,
					reason: { type: 'string' },
				},
				required: ['folder', 'reason'],
				additionalProperties: false,
			},
			strict: true,
		},
	};
}

/** 폴더 이동 대상 계산 결과 */
export interface MoveResolutionResult {
	/** 최종 이동 목표 파일 경로 (이동 불필요/실패 시 null) */
	targetPath: string | null;
	/** 이동 사유 또는 AI 분류 설명 */
	reason?: string;
	/** 건너뛴 사유 코드 */
	skipReason?: string;
	/** 소모된 LLM 토큰 수 */
	tokensUsed: number;
}

/** 폴더 경로 정제 (선행/후행 슬래시 제거 및 특수문자/경로 순회 정제) */
export function sanitizeFolderPath(rawPath: string): string {
	const trimmed = rawPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	if (!trimmed || trimmed === '/') return '';
	const sanitized = sanitizeFilePath(trimmed, false).replace(/^\/+|\/+$/g, '');
	if (!sanitized || sanitized === '.' || sanitized === '/') return '';
	return normalizePath(sanitized);
}

/** 파일 경로에서 부모 폴더 경로 추출 (루트 파일이면 빈 문자열) */
export function getParentFolder(filePath: string): string {
	const norm = normalizePath(filePath);
	const lastSlash = norm.lastIndexOf('/');
	return lastSlash > 0 ? norm.slice(0, lastSlash) : '';
}

/**
 * 이동 대상 폴더가 안전한지 검증합니다.
 * 경로 순회(`..`), 시스템 설정 폴더(`.obsidian`), 제외 경로(`backups`, `chatHistory` 등),
 * 그리고 자동감시 소스 폴더 자기 자신으로의 순환 이동을 차단합니다.
 */
export function validateMoveDestination(
	rawFolderPath: string,
	opts?: {
		excludedPaths?: string[];
		configDir?: string;
		disallowedSourceFolder?: string;
		includeSubfolders?: boolean;
	},
): { valid: boolean; normalizedFolder: string; reason?: string } {
	const rawNormalized = rawFolderPath.trim().replace(/\\/g, '/');
	if (!rawNormalized || rawNormalized === '/') {
		return { valid: false, normalizedFolder: '', reason: 'empty-folder' };
	}

	const rawSegments = rawNormalized.split('/').filter((s) => s.length > 0);
	if (rawSegments.some((seg) => seg === '..' || seg === '.')) {
		return { valid: false, normalizedFolder: '', reason: 'path-traversal' };
	}
	if (rawSegments.some((seg) => seg.startsWith('.'))) {
		return { valid: false, normalizedFolder: '', reason: 'hidden-folder' };
	}

	const normalizedFolder = sanitizeFolderPath(rawNormalized);
	if (!normalizedFolder) {
		return { valid: false, normalizedFolder: '', reason: 'invalid-folder' };
	}

	const configDir = opts?.configDir?.trim();
	if (
		configDir &&
		(normalizedFolder === configDir || normalizedFolder.startsWith(`${configDir}/`))
	) {
		return { valid: false, normalizedFolder, reason: 'system-folder' };
	}

	const excluded = opts?.excludedPaths ?? [];
	if (
		isExcluded(normalizedFolder, excluded) ||
		isExcluded(`${normalizedFolder}/__check__.md`, excluded)
	) {
		return { valid: false, normalizedFolder, reason: 'excluded-folder' };
	}

	if (opts?.disallowedSourceFolder) {
		const normSrc = sanitizeFolderPath(opts.disallowedSourceFolder);
		if (normSrc) {
			if (normalizedFolder === normSrc) {
				return { valid: false, normalizedFolder, reason: 'self-loop-folder' };
			}
			if (opts.includeSubfolders && normalizedFolder.startsWith(`${normSrc}/`)) {
				return { valid: false, normalizedFolder, reason: 'self-loop-folder' };
			}
		}
	}

	return { valid: true, normalizedFolder };
}

/**
 * 대상 경로에 이미 파일이 있을 때 충돌 정책에 따라 최종 경로를 결정합니다.
 * - `skip`: null 반환
 * - `rename-suffix`: `이름 (1).md`, `이름 (2).md` ... 형태로 미사용 경로 탐색
 */
export function resolveConflictTargetPath(
	app: App,
	desiredPath: string,
	conflictPolicy: MoveConflictPolicy,
): string | null {
	const normDesired = normalizePath(desiredPath);
	const existing = app.vault.getAbstractFileByPath(normDesired);
	if (!existing) {
		return normDesired;
	}

	if (conflictPolicy === 'skip') {
		return null;
	}

	const lastSlash = normDesired.lastIndexOf('/');
	const dirPrefix = lastSlash > 0 ? `${normDesired.slice(0, lastSlash)}/` : '';
	const fileName = lastSlash > 0 ? normDesired.slice(lastSlash + 1) : normDesired;
	const lastDot = fileName.lastIndexOf('.');
	const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
	const extPart = lastDot > 0 ? fileName.slice(lastDot) : '';

	for (let i = 1; i <= 999; i++) {
		const candidate = normalizePath(`${dirPrefix}${baseName} (${i})${extPart}`);
		if (!app.vault.getAbstractFileByPath(candidate)) {
			return candidate;
		}
	}

	return null;
}

/** 노트에서 정규화된 소문자 태그 목록을 수집합니다. */
function collectNormalizedNoteTags(
	app: App,
	file: TFile,
	effectiveTags?: readonly string[],
): string[] {
	const result: string[] = [];
	const seen = new Set<string>();

	const pushTag = (raw: string) => {
		const cleaned = raw.trim().replace(/^#+/, '').toLowerCase();
		if (!cleaned || seen.has(cleaned)) return;
		seen.add(cleaned);
		result.push(cleaned);
	};

	for (const tag of effectiveTags ?? []) {
		pushTag(tag);
	}

	const cache = app.metadataCache?.getFileCache(file);
	for (const fmTag of normalizeFrontmatterTags(cache?.frontmatter?.tags)) {
		pushTag(fmTag);
	}
	for (const inline of cache?.tags ?? []) {
		pushTag(inline.tag);
	}

	return result;
}

/**
 * 폴더 이동 설정에 따라 목표 이동 경로를 계산합니다. (실제 이동은 수행하지 않음)
 */
export async function resolveMoveTargetPath(
	app: App,
	plugin: LuminaPlugin,
	file: TFile,
	config: FolderMoveConfig,
	opts?: {
		effectiveTags?: readonly string[];
		excludedPaths?: string[];
		providerId?: string;
		modelId?: string;
		minContentLength?: number;
		disallowedSourceFolder?: string;
		includeSubfolders?: boolean;
		signal?: AbortSignal;
	},
): Promise<MoveResolutionResult> {
	if (config.mode === 'none') {
		return { targetPath: null, skipReason: 'disabled', tokensUsed: 0 };
	}

	const validationOpts = {
		excludedPaths: opts?.excludedPaths ?? [],
		configDir: app.vault?.configDir,
		disallowedSourceFolder: opts?.disallowedSourceFolder,
		includeSubfolders: opts?.includeSubfolders,
	};

	let resolvedFolder = '';
	let reason: string | undefined;
	let tokensUsed = 0;

	if (config.mode === 'fixed') {
		const check = validateMoveDestination(config.fixedTargetFolder, validationOpts);
		if (!check.valid) {
			return {
				targetPath: null,
				skipReason: check.reason ?? 'invalid-target',
				tokensUsed: 0,
			};
		}
		resolvedFolder = check.normalizedFolder;
	} else if (config.mode === 'by-tag') {
		const noteTags = collectNormalizedNoteTags(app, file, opts?.effectiveTags);
		for (const mapping of config.tagMappings) {
			const mappingTag = mapping.tag.trim().replace(/^#+/, '').toLowerCase();
			if (!mappingTag) continue;
			const matched = noteTags.some(
				(t) => t === mappingTag || t.startsWith(`${mappingTag}/`),
			);
			if (!matched) continue;

			const check = validateMoveDestination(mapping.targetFolder, validationOpts);
			if (check.valid) {
				resolvedFolder = check.normalizedFolder;
				reason = `#${mappingTag}`;
				break;
			}
		}

		if (!resolvedFolder && config.fallbackFolder.trim()) {
			const fallbackCheck = validateMoveDestination(config.fallbackFolder, validationOpts);
			if (fallbackCheck.valid) {
				resolvedFolder = fallbackCheck.normalizedFolder;
				reason = 'fallback';
			}
		}

		if (!resolvedFolder) {
			return { targetPath: null, skipReason: 'no-matching-tag', tokensUsed: 0 };
		}
	} else if (config.mode === 'ai-route') {
		const validCandidates: string[] = [];
		const seenLower = new Set<string>();
		for (const rawCandidate of config.aiCandidateFolders) {
			const check = validateMoveDestination(rawCandidate, validationOpts);
			if (!check.valid) continue;
			const lower = check.normalizedFolder.toLowerCase();
			if (seenLower.has(lower)) continue;
			seenLower.add(lower);
			validCandidates.push(check.normalizedFolder);
		}

		if (validCandidates.length === 0) {
			return { targetPath: null, skipReason: 'no-candidate-folders', tokensUsed: 0 };
		}

		const rawContent = await app.vault.read(file);
		const { body } = splitFrontmatterAndBody(rawContent);
		const trimmedBody = body.trim();
		const minLen = Math.max(10, opts?.minContentLength ?? 50);
		if (trimmedBody.length < minLen) {
			return { targetPath: null, skipReason: 'too-short', tokensUsed: 0 };
		}

		const noteTags = collectNormalizedNoteTags(app, file, opts?.effectiveTags);
		const candidateListText = validCandidates.map((c) => `- ${c}`).join('\n');
		const tagsText = noteTags.length > 0 ? noteTags.map((t) => `#${t}`).join(', ') : '(none)';

		const prompt = `Classify the following markdown note into the SINGLE most appropriate folder from the allowed candidate list below.
CRITICAL RULES:
1. You MUST pick an EXACT folder path from the "Allowed Candidate Folders" list, or "NONE" if none fit well.
2. NEVER invent, modify, or create any new folder path outside the list.
3. Write the brief "reason" in the SAME LANGUAGE as the note content.
4. Output ONLY a valid JSON object with no markdown fences or extra text:
{"folder": "<exact candidate path or NONE>", "reason": "<1 short sentence explaining why>"}

Allowed Candidate Folders:
${candidateListText}

Note Title: ${file.basename}
Current Path: ${file.path}
Note Tags: ${tagsText}
Note Content:
${trimmedBody.substring(0, 2000)}`;

		const llmResult = await callBatchLlm(
			plugin,
			{
				providerId: opts?.providerId ?? '',
				modelId: opts?.modelId ?? '',
			},
			file.path,
			'Folder Route',
			prompt,
			opts?.signal,
			400,
			{
				responseFormat: buildFolderRouteResponseFormat(validCandidates),
				reasoning: { effort: 'off' },
			},
		);
		tokensUsed = llmResult.tokensUsed;

		const parsed = extractJsonObject(llmResult.text);
		let rawPickedFolder = '';
		let parsedReason = '';
		if (typeof parsed === 'object' && parsed !== null) {
			const record = parsed as Record<string, unknown>;
			if (typeof record.folder === 'string') {
				rawPickedFolder = record.folder.trim();
			}
			if (typeof record.reason === 'string') {
				parsedReason = record.reason.trim();
			}
		}

		// 화이트리스트에 정확히 일치하는 후보만 허용 (LLM 환각 폴더 차단)
		const normalizedPicked = sanitizeFolderPath(rawPickedFolder).toLowerCase();
		const matchedCandidate =
			rawPickedFolder.toUpperCase() === 'NONE' || !normalizedPicked
				? undefined
				: validCandidates.find((c) => c.toLowerCase() === normalizedPicked);

		if (matchedCandidate) {
			resolvedFolder = matchedCandidate;
			reason = parsedReason || 'AI';
		} else if (config.fallbackFolder.trim()) {
			const fallbackCheck = validateMoveDestination(config.fallbackFolder, validationOpts);
			if (fallbackCheck.valid) {
				resolvedFolder = fallbackCheck.normalizedFolder;
				reason = parsedReason || 'fallback';
			}
		}

		if (!resolvedFolder) {
			return { targetPath: null, skipReason: 'no-matching-folder', tokensUsed };
		}
	}

	const currentFolder = getParentFolder(file.path);
	if (currentFolder === resolvedFolder) {
		return { targetPath: null, skipReason: 'already-in-target', tokensUsed };
	}

	const desiredPath = normalizePath(`${resolvedFolder}/${file.name}`);
	if (normalizePath(file.path) === desiredPath) {
		return { targetPath: null, skipReason: 'already-in-target', tokensUsed };
	}

	const finalPath = resolveConflictTargetPath(app, desiredPath, config.conflictPolicy);
	if (!finalPath) {
		return { targetPath: null, skipReason: 'target-exists', tokensUsed };
	}

	return {
		targetPath: finalPath,
		reason,
		tokensUsed,
	};
}

/**
 * 사전 검증과 폴더 자동 생성 후 `fileManager.renameFile`을 이용해 안전하게 파일을 이동합니다.
 */
export async function executeSafeFileMove(
	app: App,
	file: TFile,
	targetPath: string,
	opts?: {
		conflictPolicy?: MoveConflictPolicy;
		createFolderIfMissing?: boolean;
		excludedPaths?: string[];
	},
): Promise<{ movedFromPath: string; movedToPath: string } | null> {
	if (typeof app.fileManager?.renameFile !== 'function') {
		throw new Error('Obsidian fileManager.renameFile is unavailable.');
	}

	const targetFolder = getParentFolder(targetPath);
	const destCheck = validateMoveDestination(targetFolder, {
		excludedPaths: opts?.excludedPaths ?? [],
		configDir: app.vault?.configDir,
	});
	if (!destCheck.valid) {
		throw new Error(`Invalid move destination folder: ${targetFolder} (${destCheck.reason ?? 'invalid'})`);
	}

	const finalPath = resolveConflictTargetPath(
		app,
		normalizePath(targetPath),
		opts?.conflictPolicy ?? 'rename-suffix',
	);
	if (!finalPath) {
		return null;
	}

	const movedFromPath = file.path;
	if (normalizePath(movedFromPath) === finalPath) {
		return null;
	}

	if (opts?.createFolderIfMissing !== false) {
		await ensureFolderExists(app, finalPath);
	}

	await app.fileManager.renameFile(file, finalPath);
	return { movedFromPath, movedToPath: finalPath };
}
