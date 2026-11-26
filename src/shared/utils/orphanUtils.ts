/**
 * 고아노트(Orphan Note) 판별·링크 그래프 집계·경량 카운트 공통 유틸리티.
 * `features/batch`와 `features/rag` 사이 교차 의존성 없이 양쪽에서 안전하게 재사용합니다.
 */

import { App, TFile, normalizePath } from 'obsidian';
import type { OrphanDetectionMode, OrphanNotesPreferences } from '../types/orphan.types';
import { isExcluded } from './exclusions';
import { normalizeFrontmatterTags } from './frontmatterSanitizer';

/** 1일 밀리초 상수 */
export const MS_PER_DAY = 86_400_000;

/** 기본 고아노트 환경설정 */
export const DEFAULT_ORPHAN_PREFERENCES: OrphanNotesPreferences = {
	mode: 'isolated',
	gracePeriodDays: 7,
	includeCanvasRefs: true,
	archiveFolder: 'Archive/Orphans',
	ignoredPaths: [],
	ignoredFolders: [],
	ignoredTags: [],
};

/** 볼트 링크 그래프 집계 결과 */
export interface VaultLinkCounts {
	inlinks: Map<string, number>;
	outlinks: Map<string, number>;
}

/** 경량 고아노트 카운트 옵션 */
export interface FastOrphanCountOptions {
	mode?: OrphanDetectionMode;
	gracePeriodDays?: number;
	excludedPaths?: readonly string[];
	ignoredPaths?: readonly string[];
	ignoredFolders?: readonly string[];
	ignoredTags?: readonly string[];
	nowMs?: number;
}

/**
 * `metadataCache.resolvedLinks`를 순회해 각 노트의 인링크·아웃링크 개수를 O(V+E)로 집계합니다.
 * 자기 참조 링크(self-link)는 고아 판별에서 연결로 인정하지 않기 위해 제외합니다.
 */
export function buildVaultLinkCounts(app: App): VaultLinkCounts {
	const inlinks = new Map<string, number>();
	const outlinks = new Map<string, number>();
	const resolvedLinks = app.metadataCache?.resolvedLinks;
	if (!resolvedLinks || typeof resolvedLinks !== 'object') {
		return { inlinks, outlinks };
	}

	for (const [sourceRaw, targets] of Object.entries(resolvedLinks)) {
		if (!targets || typeof targets !== 'object') continue;
		const source = normalizePath(sourceRaw);
		let outCount = 0;

		for (const [targetRaw, linkCount] of Object.entries(targets)) {
			if (typeof linkCount !== 'number' || linkCount <= 0) continue;
			const target = normalizePath(targetRaw);
			if (target === source) continue;
			outCount += linkCount;
			inlinks.set(target, (inlinks.get(target) ?? 0) + linkCount);
		}

		if (outCount > 0) {
			outlinks.set(source, (outlinks.get(source) ?? 0) + outCount);
		}
	}

	return { inlinks, outlinks };
}

/**
 * 인링크·아웃링크 개수와 판별 모드로 고아노트 여부를 결정합니다.
 */
export function isOrphanByCounts(
	inlinkCount: number,
	outlinkCount: number,
	mode: OrphanDetectionMode,
): boolean {
	if (mode === 'no-backlinks') {
		return inlinkCount === 0;
	}
	return inlinkCount === 0 && outlinkCount === 0;
}

/**
 * 파일 경로가 지정된 폴더 프리픽스 목록 중 하나에 속하는지 확인합니다.
 */
export function matchesAnyFolderPrefix(
	filePath: string,
	folders: readonly string[],
): boolean {
	if (!folders || folders.length === 0) return false;
	const normFile = normalizePath(filePath);

	for (const rawFolder of folders) {
		const trimmed = rawFolder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		if (!trimmed) continue;
		const normFolder = normalizePath(trimmed);
		if (normFile === normFolder || normFile.startsWith(`${normFolder}/`)) {
			return true;
		}
	}
	return false;
}

/**
 * 파일에서 정규화된 태그 목록(프론트매터 + 본문 인라인 태그)을 중복 없이 추출합니다.
 */
export function collectNormalizedTagsForFile(app: App, file: TFile): string[] {
	const cache = app.metadataCache?.getFileCache?.(file);
	if (!cache) return [];

	const seen = new Set<string>();
	const result: string[] = [];

	const addTag = (raw: string) => {
		const cleaned = raw.trim().replace(/^#+/, '').trim();
		if (!cleaned) return;
		const lower = cleaned.toLowerCase();
		if (seen.has(lower)) return;
		seen.add(lower);
		result.push(cleaned);
	};

	for (const fmTag of normalizeFrontmatterTags(cache.frontmatter?.tags)) {
		addTag(fmTag);
	}
	for (const inline of cache.tags ?? []) {
		if (inline && typeof inline.tag === 'string') {
			addTag(inline.tag);
		}
	}

	return result;
}

/**
 * 파일이 무시 대상 태그(하위 태그 포함) 중 하나라도 가지고 있는지 검사합니다.
 */
export function hasAnyIgnoredTag(
	app: App,
	file: TFile,
	ignoredTags: readonly string[],
): boolean {
	if (!ignoredTags || ignoredTags.length === 0) return false;
	const normalizedIgnored = ignoredTags
		.map((t) => t.trim().replace(/^#+/, '').toLowerCase())
		.filter((t) => t.length > 0);
	if (normalizedIgnored.length === 0) return false;

	const fileTags = collectNormalizedTagsForFile(app, file).map((t) => t.toLowerCase());
	if (fileTags.length === 0) return false;

	return fileTags.some((tag) =>
		normalizedIgnored.some((ignored) => tag === ignored || tag.startsWith(`${ignored}/`)),
	);
}

/**
 * 설정된 환경설정 객체에 누락 필드가 있을 때 기본값을 병합해 반환합니다.
 */
export function resolveOrphanPreferences(
	prefs?: Partial<OrphanNotesPreferences> | null,
): OrphanNotesPreferences {
	return {
		mode: prefs?.mode === 'no-backlinks' ? 'no-backlinks' : 'isolated',
		gracePeriodDays:
			typeof prefs?.gracePeriodDays === 'number' && Number.isFinite(prefs.gracePeriodDays)
				? Math.max(0, Math.floor(prefs.gracePeriodDays))
				: DEFAULT_ORPHAN_PREFERENCES.gracePeriodDays,
		includeCanvasRefs:
			typeof prefs?.includeCanvasRefs === 'boolean'
				? prefs.includeCanvasRefs
				: DEFAULT_ORPHAN_PREFERENCES.includeCanvasRefs,
		archiveFolder:
			typeof prefs?.archiveFolder === 'string' && prefs.archiveFolder.trim()
				? prefs.archiveFolder.trim()
				: DEFAULT_ORPHAN_PREFERENCES.archiveFolder,
		ignoredPaths: Array.isArray(prefs?.ignoredPaths) ? [...prefs.ignoredPaths] : [],
		ignoredFolders: Array.isArray(prefs?.ignoredFolders) ? [...prefs.ignoredFolders] : [],
		ignoredTags: Array.isArray(prefs?.ignoredTags) ? [...prefs.ignoredTags] : [],
	};
}

/**
 * 디스크 I/O 없이 메모리상의 마크다운 파일 목록과 `resolvedLinks`만으로
 * 고아노트 개수를 동기적으로 빠르게 집계합니다. (Smart Discovery 상단 배너용)
 */
export function countOrphanNotesFast(
	app: App,
	opts: FastOrphanCountOptions = {},
): number {
	const files = app?.vault?.getMarkdownFiles?.();
	if (!Array.isArray(files) || files.length === 0) {
		return 0;
	}

	const mode = opts.mode ?? DEFAULT_ORPHAN_PREFERENCES.mode;
	const graceDays =
		typeof opts.gracePeriodDays === 'number'
			? Math.max(0, opts.gracePeriodDays)
			: DEFAULT_ORPHAN_PREFERENCES.gracePeriodDays;
	const graceMs = graceDays * MS_PER_DAY;
	const nowMs = opts.nowMs ?? Date.now();
	const excludedPaths = opts.excludedPaths ? [...opts.excludedPaths] : [];
	const ignoredSet = new Set((opts.ignoredPaths ?? []).map((p) => normalizePath(p)));
	const ignoredFolders = opts.ignoredFolders ?? [];
	const ignoredTags = opts.ignoredTags ?? [];

	const { inlinks, outlinks } = buildVaultLinkCounts(app);

	let count = 0;
	for (const file of files) {
		const normPath = normalizePath(file.path);
		if (isExcluded(normPath, excludedPaths)) continue;
		if (ignoredSet.has(normPath)) continue;
		if (matchesAnyFolderPrefix(normPath, ignoredFolders)) continue;
		if (graceMs > 0 && nowMs - (file.stat?.mtime ?? 0) < graceMs) continue;
		if (hasAnyIgnoredTag(app, file, ignoredTags)) continue;

		const inCount = inlinks.get(normPath) ?? 0;
		const outCount = outlinks.get(normPath) ?? 0;
		if (isOrphanByCounts(inCount, outCount, mode)) {
			count++;
		}
	}

	return count;
}
