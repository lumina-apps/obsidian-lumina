/**
 * 볼트 내 마크다운 고아노트 스캐너.
 * - `metadataCache.resolvedLinks` 기반 인링크/아웃링크 집계
 * - `.canvas` 파일 내 파일 노드 참조 캐싱 파싱
 * - 보호 기간(gracePeriod), 시스템 제외 경로, 무시 경로/폴더/태그, 빈 노트, 정렬 지원
 */

import { App, TFile, normalizePath } from 'obsidian';
import { debugLogger } from '../../../shared/debugLogger';
import type {
	OrphanFilterConfig,
	OrphanNoteItem,
	OrphanSortKey,
} from '../../../shared/types/orphan.types';
import { isExcluded } from '../../../shared/utils/exclusions';
import {
	MS_PER_DAY,
	buildVaultLinkCounts,
	collectNormalizedTagsForFile,
	hasAnyIgnoredTag,
	isOrphanByCounts,
	matchesAnyFolderPrefix,
} from '../../../shared/utils/orphanUtils';
import { getParentFolder } from '../watch/folderMover';

/** 스캔 결과 요약 */
export interface OrphanScanResult {
	items: OrphanNoteItem[];
	totalMarkdown: number;
	ignoredCount: number;
}

/** .canvas 파일별 파싱 캐시 (mtime 변경 시에만 재파싱) */
const canvasRefCache = new Map<string, { mtime: number; refs: Set<string> }>();

/**
 * `.canvas` 파일 참조 캐시를 비웁니다. (테스트 및 플러그인 정리용)
 */
export function clearCanvasRefCache(): void {
	canvasRefCache.clear();
}

/**
 * 볼트 내 `.canvas` 파일들을 읽어 참조 중인 마크다운 경로 집합을 수집합니다.
 */
export async function collectCanvasReferencedPaths(app: App): Promise<Set<string>> {
	const referenced = new Set<string>();
	const allFiles = app.vault?.getFiles?.();
	if (!Array.isArray(allFiles) || allFiles.length === 0) {
		canvasRefCache.clear();
		return referenced;
	}

	const canvasFiles = allFiles.filter(
		(f): f is TFile => f instanceof TFile && f.extension?.toLowerCase() === 'canvas',
	);
	const activeCanvasPaths = new Set(canvasFiles.map((f) => normalizePath(f.path)));

	// 삭제된 canvas 캐시 엔트리 정리
	for (const cachedPath of canvasRefCache.keys()) {
		if (!activeCanvasPaths.has(cachedPath)) {
			canvasRefCache.delete(cachedPath);
		}
	}

	for (const canvasFile of canvasFiles) {
		const normCanvasPath = normalizePath(canvasFile.path);
		const mtime = canvasFile.stat?.mtime ?? 0;
		const cached = canvasRefCache.get(normCanvasPath);
		if (cached && cached.mtime === mtime) {
			for (const ref of cached.refs) referenced.add(ref);
			continue;
		}

		const refs = new Set<string>();
		try {
			const raw = await (app.vault.cachedRead?.(canvasFile) ?? app.vault.read(canvasFile));
			const parsed = JSON.parse(raw) as unknown;
			if (typeof parsed === 'object' && parsed !== null && 'nodes' in parsed) {
				const nodes = (parsed as { nodes?: unknown }).nodes;
				if (Array.isArray(nodes)) {
					for (const node of nodes) {
						if (
							typeof node === 'object' &&
							node !== null &&
							(node as { type?: unknown }).type === 'file' &&
							typeof (node as { file?: unknown }).file === 'string'
						) {
							const refPath = normalizePath((node as { file: string }).file);
							if (refPath) {
								refs.add(refPath);
								referenced.add(refPath);
							}
						}
					}
				}
			}
			canvasRefCache.set(normCanvasPath, { mtime, refs });
		} catch (err) {
			debugLogger.logWarn('batch', `Canvas parse skipped (${normCanvasPath}): ${String(err)}`);
			canvasRefCache.set(normCanvasPath, { mtime, refs });
		}
	}

	return referenced;
}

/**
 * 메타데이터 캐시 및 파일 크기로 빈 노트(프론트매터만 있거나 0바이트) 여부를 판정합니다.
 */
function isEmptyNoteFile(app: App, file: TFile): boolean {
	if ((file.stat?.size ?? 0) === 0) {
		return true;
	}
	const cache = app.metadataCache?.getFileCache?.(file);
	const sections = cache?.sections;
	if (!sections || sections.length === 0) {
		return false;
	}
	// 본문 섹션 없이 YAML 프론트매터 섹션만 있는 경우
	return sections.every((sec) => sec.type === 'yaml');
}

function sortOrphanItems(items: OrphanNoteItem[], sortBy: OrphanSortKey): void {
	items.sort((a, b) => {
		switch (sortBy) {
			case 'mtime-asc':
				return a.mtime - b.mtime || a.path.localeCompare(b.path);
			case 'name-asc':
				return a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path);
			case 'size-asc':
				return a.size - b.size || a.path.localeCompare(b.path);
			case 'mtime-desc':
			default:
				return b.mtime - a.mtime || a.path.localeCompare(b.path);
		}
	});
}

/**
 * 볼트 내 마크다운 노트를 스캔해 필터 조건에 맞는 고아노트 목록을 반환합니다.
 */
export async function scanOrphanNotes(
	app: App,
	config: OrphanFilterConfig,
	nowMs: number = Date.now(),
): Promise<OrphanScanResult> {
	const markdownFiles = app.vault?.getMarkdownFiles?.() ?? [];
	const totalMarkdown = markdownFiles.length;
	if (totalMarkdown === 0) {
		return { items: [], totalMarkdown: 0, ignoredCount: 0 };
	}

	const { inlinks, outlinks } = buildVaultLinkCounts(app);
	const canvasRefs = config.includeCanvasRefs
		? await collectCanvasReferencedPaths(app)
		: new Set<string>();

	const graceMs = Math.max(0, config.gracePeriodDays) * MS_PER_DAY;
	const ignoredSet = new Set(config.ignoredPaths.map((p) => normalizePath(p)));
	const normFolderFilter = config.folderFilter.trim()
		? normalizePath(config.folderFilter.trim().replace(/^\/+|\/+$/g, ''))
		: '';
	const searchLower = config.searchQuery.trim().toLowerCase();

	const items: OrphanNoteItem[] = [];
	let ignoredCount = 0;

	for (const file of markdownFiles) {
		const normPath = normalizePath(file.path);
		if (isExcluded(normPath, config.excludedPaths)) continue;
		if (matchesAnyFolderPrefix(normPath, config.ignoredFolders)) continue;
		if (graceMs > 0 && nowMs - (file.stat?.mtime ?? 0) < graceMs) continue;
		if (hasAnyIgnoredTag(app, file, config.ignoredTags)) continue;

		const rawInlinks = inlinks.get(normPath) ?? 0;
		const inlinkCount = canvasRefs.has(normPath) ? rawInlinks + 1 : rawInlinks;
		const outlinkCount = outlinks.get(normPath) ?? 0;

		if (!isOrphanByCounts(inlinkCount, outlinkCount, config.mode)) {
			continue;
		}

		const isIgnored = ignoredSet.has(normPath);
		if (isIgnored) {
			ignoredCount++;
			if (!config.showIgnored) continue;
		}

		const isEmpty = isEmptyNoteFile(app, file);
		if (config.emptyOnly && !isEmpty) continue;

		if (
			normFolderFilter &&
			normPath !== normFolderFilter &&
			!normPath.startsWith(`${normFolderFilter}/`)
		) {
			continue;
		}

		if (
			searchLower &&
			!normPath.toLowerCase().includes(searchLower) &&
			!file.basename.toLowerCase().includes(searchLower)
		) {
			continue;
		}

		items.push({
			path: normPath,
			basename: file.basename,
			folder: getParentFolder(normPath),
			mtime: file.stat?.mtime ?? 0,
			size: file.stat?.size ?? 0,
			inlinkCount,
			outlinkCount,
			isEmpty,
			isIgnored,
			tags: collectNormalizedTagsForFile(app, file),
		});
	}

	sortOrphanItems(items, config.sortBy);
	return { items, totalMarkdown, ignoredCount };
}
