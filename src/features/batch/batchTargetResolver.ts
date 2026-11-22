/**
 * batchTargetResolver.ts
 *
 * 볼트 내 마크다운 노트를 필터링(폴더·태그·최소 글자수·스마트 스킵)하고,
 * 예상 토큰/소요 시간 산출 및 줄 단위 Diff 계산을 담당합니다.
 */

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { diffLines } from 'diff';
import type {
	BatchDiffLine,
	BatchRecipeId,
	BatchRecipeOptions,
	BatchScopeConfig,
} from '../../shared/types/batch.types';
import { isExcluded } from '../../shared/utils/exclusions';
import { normalizeFrontmatterTags } from '../../shared/utils/frontmatterSanitizer';
import { estimateTokens } from '../../shared/utils/tokenEstimator';

/** 타겟 필터링 결과 */
export interface TargetResolutionResult {
	/** 최종 작업 대상 파일 목록 (경로 오름차순) */
	matched: TFile[];
	/** 스마트 필터/조건으로 제외된 파일 수 */
	skippedCount: number;
	/** 볼트 내 전체 마크다운 파일 수 */
	totalScanned: number;
}

/** 배치 리소스 예상치 */
export interface BatchResourceEstimate {
	estimatedTokens: number;
	estimatedSeconds: number;
}

/**
 * 볼트 내 모든 폴더 경로 목록을 정렬하여 반환합니다. (루트 제외)
 */
export function listVaultFolders(app: App): string[] {
	const folders = new Set<string>();
	const allLoaded = app.vault.getAllLoadedFiles?.() ?? [];
	for (const entry of allLoaded) {
		if (entry instanceof TFolder && entry.path && entry.path !== '/') {
			const norm = normalizePath(entry.path);
			if (!isExcluded(norm, [])) {
				folders.add(norm);
			}
		}
	}
	// getAllLoadedFiles가 모킹되지 않은 환경에서는 마크다운 파일 경로에서 상위 폴더를 추론
	if (folders.size === 0) {
		for (const file of app.vault.getMarkdownFiles()) {
			const lastSlash = file.path.lastIndexOf('/');
			if (lastSlash > 0) {
				const folder = normalizePath(file.path.slice(0, lastSlash));
				if (!isExcluded(folder, [])) {
					folders.add(folder);
				}
			}
		}
	}
	return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

/**
 * 파일이 지정된 폴더 경로 하위에 속하는지 검사합니다.
 */
function matchesFolderScope(filePath: string, folderPath: string): boolean {
	const trimmed = folderPath.trim();
	if (!trimmed || trimmed === '/') return true;
	const normFolder = normalizePath(trimmed);
	const normFile = normalizePath(filePath);
	return normFile.startsWith(`${normFolder}/`);
}

/**
 * 파일이 지정된 태그 필터를 만족하는지 검사합니다. (프론트매터 + 인라인 태그 모두 검사)
 */
function matchesTagFilter(app: App, file: TFile, rawTagFilter: string): boolean {
	const target = rawTagFilter.trim().replace(/^#+/, '').toLowerCase();
	if (!target) return true;

	const cache = app.metadataCache?.getFileCache(file);
	if (!cache) return false;

	const fmTags = normalizeFrontmatterTags(cache.frontmatter?.tags).map((t) => t.toLowerCase());
	const inlineTags = (cache.tags ?? []).map((t) => t.tag.replace(/^#+/, '').toLowerCase());
	const allTags = [...fmTags, ...inlineTags];

	return allTags.some((tag) => tag === target || tag.startsWith(`${target}/`));
}

/**
 * 메타데이터 캐시만으로 즉시 판별 가능한 스마트 스킵 여부를 확인합니다.
 */
function shouldSmartSkipFromCache(
	app: App,
	file: TFile,
	recipeId: BatchRecipeId,
	options: BatchRecipeOptions,
): boolean {
	const cache = app.metadataCache?.getFileCache(file);
	const fm: Record<string, unknown> | undefined = cache?.frontmatter;

	if (recipeId === 'frontmatter' && options.fmMergeMode === 'empty-only') {
		const hasTags = normalizeFrontmatterTags(fm?.tags).length > 0;
		const hasDesc = typeof fm?.description === 'string' && fm.description.trim().length > 0;
		const tagsSatisfied = !options.generateTags || hasTags;
		const descSatisfied = !options.generateDescription || hasDesc;
		return tagsSatisfied && descSatisfied;
	}

	if (recipeId === 'custom-prompt' && options.customOutputMode === 'frontmatter-key') {
		const key = options.customFrontmatterKey.trim();
		if (!key || !fm) return false;
		const existing = fm[key];
		if (Array.isArray(existing)) return existing.length > 0;
		return existing !== undefined && existing !== null && String(existing).trim().length > 0;
	}

	return false;
}

/**
 * 범위·태그·최소 길이·스마트 스킵 조건에 따라 배치 대상 마크다운 파일 목록을 계산합니다.
 */
export function resolveTargetFiles(
	app: App,
	config: BatchScopeConfig,
	recipeId: BatchRecipeId,
	options: BatchRecipeOptions,
	excludedPaths: string[] = [],
): TargetResolutionResult {
	const allFiles = app.vault.getMarkdownFiles();
	const matched: TFile[] = [];
	let skippedCount = 0;

	for (const file of allFiles) {
		// 백업/템플릿/채팅기록 등 시스템 제외 경로는 항상 보호
		if (isExcluded(file.path, excludedPaths)) {
			skippedCount++;
			continue;
		}

		// 폴더 범위 필터
		if (config.scopeMode === 'folder' && !matchesFolderScope(file.path, config.folderPath)) {
			skippedCount++;
			continue;
		}

		// 태그 필터
		if (config.tagFilter.trim() && !matchesTagFilter(app, file, config.tagFilter)) {
			skippedCount++;
			continue;
		}

		// 최소 크기(글자 수) 필터
		if (config.minContentLength > 0 && (file.stat?.size ?? 0) < config.minContentLength) {
			skippedCount++;
			continue;
		}

		// 스마트 스킵 (이미 속성이 채워진 노트 제외)
		if (config.skipIfAlreadyHasTarget && shouldSmartSkipFromCache(app, file, recipeId, options)) {
			skippedCount++;
			continue;
		}

		matched.push(file);
	}

	matched.sort((a, b) => a.path.localeCompare(b.path));

	return {
		matched,
		skippedCount,
		totalScanned: allFiles.length,
	};
}

/**
 * 대상 파일 수와 레시피 종류를 바탕으로 예상 소비 토큰과 소요 시간을 추산합니다.
 */
export function estimateBatchResources(
	files: readonly TFile[],
	recipeId: BatchRecipeId,
	providerType?: string,
): BatchResourceEstimate {
	if (files.length === 0) {
		return { estimatedTokens: 0, estimatedSeconds: 0 };
	}

	if (recipeId === 'autolink') {
		return {
			estimatedTokens: 0,
			estimatedSeconds: Math.max(1, Math.ceil(files.length * 0.05)),
		};
	}

	let totalTokens = 0;
	for (const file of files) {
		// 프롬프트에서 본문은 최대 3000자까지만 전송하므로 상한 적용
		const sampleChars = Math.min(Math.max(file.stat?.size ?? 800, 120), 3000);
		const placeholderText = 'a'.repeat(sampleChars);
		const inputTokens = estimateTokens(placeholderText, providerType) + 180;
		const outputTokens = recipeId === 'summary-callout' ? 180 : 140;
		totalTokens += inputTokens + outputTokens;
	}

	return {
		estimatedTokens: totalTokens,
		estimatedSeconds: Math.max(2, Math.ceil(files.length * 1.2)),
	};
}

/**
 * 변경 전/후 마크다운 텍스트를 줄 단위로 비교해 Diff 라인 배열을 생성합니다.
 */
export function computeLineDiff(beforeText: string, afterText: string): BatchDiffLine[] {
	const changes = diffLines(beforeText, afterText);
	const result: BatchDiffLine[] = [];

	for (const part of changes) {
		const normalized = part.value.replace(/\r\n/g, '\n');
		const lines = normalized.split('\n');
		// diffLines가 끝에 붙이는 마지막 빈 요소 제거
		if (lines.length > 0 && lines[lines.length - 1] === '') {
			lines.pop();
		}
		const type: BatchDiffLine['type'] = part.added
			? 'added'
			: part.removed
				? 'removed'
				: 'same';

		for (const line of lines) {
			result.push({ type, text: line });
		}
	}

	return result;
}
