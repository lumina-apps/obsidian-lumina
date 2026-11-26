/**
 * 고아노트 연결·이동·휴지통·AI 문맥 삽입·MOC 편입 액션 서비스.
 * 모든 파일 변경은 원본 스냅샷을 반환하여 Batch Studio 히스토리·원클릭 롤백을 지원합니다.
 */

import { App, TFile, normalizePath } from 'obsidian';
import type LuminaPlugin from '../../../main';
import {
	buildMocContent,
	type MocFileEntry,
	type MocGroupBy,
} from '../../../core/mcp/server/handlers/utils/mocUtils';
import { addBatchHistoryEntry } from '../../../core/store/batchStore';
import type { BatchSnapshotEntry } from '../../../shared/types/batch.types';
import type {
	OrphanAiLinkProposal,
	OrphanLinkDirection,
} from '../../../shared/types/orphan.types';
import { ensureFolderExists, sanitizeFilePath } from '../../../shared/utils/fileUtils';
import { collectNormalizedTagsForFile } from '../../../shared/utils/orphanUtils';
import { callBatchLlm, extractJsonObject } from '../recipes/batchLlmHelper';
import {
	executeSafeFileMove,
	getParentFolder,
	validateMoveDestination,
} from '../watch/folderMover';

/** 단일 위키링크 삽입 결과 */
export interface WikiLinkInsertResult {
	modifiedPath: string;
	skipped: boolean;
	snapshot?: BatchSnapshotEntry;
}

/**
 * 볼트 내 동일 basename 중복 여부를 확인해 충돌 없는 위키링크(`[[이름]]` 또는 `[[경로|이름]]`)를 생성합니다.
 */
export function buildSafeWikiLink(app: App, targetFile: TFile): string {
	const files = app.vault?.getMarkdownFiles?.() ?? [];
	let sameNameCount = 0;
	for (const f of files) {
		if (f.basename.toLowerCase() === targetFile.basename.toLowerCase()) {
			sameNameCount++;
		}
	}
	const pathNoExt = normalizePath(targetFile.path).replace(/\.md$/i, '');
	if (sameNameCount > 1) {
		return `[[${pathNoExt}|${targetFile.basename}]]`;
	}
	return `[[${targetFile.basename}]]`;
}

/**
 * 본문에 대상 노트를 가리키는 위키링크가 이미 존재하는지 확인합니다.
 */
export function hasWikiLinkToTarget(content: string, targetFile: TFile): boolean {
	const pathNoExt = normalizePath(targetFile.path).replace(/\.md$/i, '');
	const escapedName = targetFile.basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const escapedPath = pathNoExt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(`\\[\\[(?:${escapedPath}|${escapedName})(?:#[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]`, 'i');
	return pattern.test(content);
}

/**
 * 문서 본문에 `## Related` 섹션이 있으면 해당 섹션 끝에, 없으면 문서 맨 아래에 링크 불릿을 삽입합니다.
 */
export function appendLinkToRelatedSection(content: string, wikilink: string): string {
	const bullet = `- ${wikilink}`;
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const headingIdx = lines.findIndex((line) => /^##\s+Related\s*$/i.test(line.trim()));

	if (headingIdx >= 0) {
		let insertAt = headingIdx + 1;
		while (insertAt < lines.length && !/^#{1,6}\s+/.test(lines[insertAt])) {
			insertAt++;
		}
		// 섹션 마지막 비어 있지 않은 줄 바로 아래 삽입
		while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === '') {
			insertAt--;
		}
		lines.splice(insertAt, 0, bullet);
		return lines.join('\n');
	}

	const trimmedEnd = content.replace(/\s+$/, '');
	if (!trimmedEnd) {
		return `## Related\n${bullet}\n`;
	}
	return `${trimmedEnd}\n\n## Related\n${bullet}\n`;
}

/**
 * 무료 개별 / Pro 일괄 위키링크 삽입을 실행하고 롤백용 스냅샷을 반환합니다.
 */
export async function insertOrphanWikiLink(
	app: App,
	orphanFile: TFile,
	targetFile: TFile,
	direction: OrphanLinkDirection,
): Promise<WikiLinkInsertResult> {
	const hostFile = direction === 'from-orphan' ? orphanFile : targetFile;
	const linkedFile = direction === 'from-orphan' ? targetFile : orphanFile;

	const originalRawContent = await app.vault.read(hostFile);
	if (hasWikiLinkToTarget(originalRawContent, linkedFile)) {
		return { modifiedPath: hostFile.path, skipped: true };
	}

	const wikilink = buildSafeWikiLink(app, linkedFile);
	const nextContent = appendLinkToRelatedSection(originalRawContent, wikilink);
	await app.vault.modify(hostFile, nextContent);

	return {
		modifiedPath: hostFile.path,
		skipped: false,
		snapshot: {
			path: hostFile.path,
			originalRawContent,
		},
	};
}

/**
 * 선택한 고아노트들을 안전한 아카이브 폴더로 이동하고 롤백 스냅샷을 반환합니다.
 */
export async function archiveOrphanFiles(
	app: App,
	files: readonly TFile[],
	archiveFolder: string,
	excludedPaths: string[] = [],
): Promise<{ movedCount: number; snapshots: BatchSnapshotEntry[] }> {
	const check = validateMoveDestination(archiveFolder, {
		excludedPaths,
		configDir: app.vault?.configDir,
	});
	if (!check.valid) {
		throw new Error(`Invalid archive folder: ${archiveFolder} (${check.reason ?? 'invalid'})`);
	}

	const snapshots: BatchSnapshotEntry[] = [];
	for (const file of files) {
		const originalRawContent = await app.vault.read(file);
		const targetPath = normalizePath(`${check.normalizedFolder}/${file.name}`);
		if (getParentFolder(file.path) === check.normalizedFolder) {
			continue;
		}
		const moved = await executeSafeFileMove(app, file, targetPath, {
			conflictPolicy: 'rename-suffix',
			createFolderIfMissing: true,
			excludedPaths,
		});
		if (moved) {
			snapshots.push({
				path: moved.movedFromPath,
				originalRawContent,
				movedFromPath: moved.movedFromPath,
				movedToPath: moved.movedToPath,
			});
		}
	}

	return { movedCount: snapshots.length, snapshots };
}

/**
 * 선택한 고아노트들을 영구 삭제 대신 사용자 삭제 설정을 존중하는 휴지통(`fileManager.trashFile`)으로 이동하고 롤백 스냅샷을 반환합니다.
 */
export async function trashOrphanFiles(
	app: App,
	files: readonly TFile[],
): Promise<{ trashedCount: number; snapshots: BatchSnapshotEntry[] }> {
	const snapshots: BatchSnapshotEntry[] = [];
	for (const file of files) {
		const originalRawContent = await app.vault.read(file);
		await app.fileManager.trashFile(file);
		snapshots.push({
			path: file.path,
			originalRawContent,
			trashed: true,
		});
	}
	return { trashedCount: snapshots.length, snapshots };
}

/**
 * Pro 전용: LLM을 이용해 대상 노트의 문맥에 어울리는 위치를 찾아 위키링크 삽입안을 생성합니다.
 */
export async function proposeAiContextualLink(
	app: App,
	plugin: LuminaPlugin,
	orphanFile: TFile,
	targetFile: TFile,
	direction: OrphanLinkDirection,
	opts?: { providerId?: string; modelId?: string; signal?: AbortSignal },
): Promise<OrphanAiLinkProposal> {
	const hostFile = direction === 'from-orphan' ? orphanFile : targetFile;
	const linkedFile = direction === 'from-orphan' ? targetFile : orphanFile;

	const beforeContent = await app.vault.read(hostFile);
	const linkedContent = await app.vault.read(linkedFile);
	const wikilink = buildSafeWikiLink(app, linkedFile);

	if (hasWikiLinkToTarget(beforeContent, linkedFile)) {
		return {
			orphanPath: orphanFile.path,
			targetPath: targetFile.path,
			direction,
			modifiedFilePath: hostFile.path,
			beforeContent,
			afterContent: beforeContent,
			reason: 'Already linked',
			tokensUsed: 0,
		};
	}

	const prompt = `You are helping connect an orphan Obsidian note into the user's knowledge graph.
Insert the EXACT wikilink "${wikilink}" naturally into the Host Note below by modifying ONE existing line (or picking an existing line to append the link below), without altering any unrelated content.

CRITICAL RULES:
1. "anchorLine" MUST be an EXACT, verbatim single line from the Host Note.
2. "replacementLine" MUST contain "${wikilink}" verbatim and preserve the original meaning and language of the Host Note.
3. "reason" must be a brief 1-sentence explanation in the SAME language as the Host Note.
4. Output ONLY a valid JSON object:
{"anchorLine": "<exact line from host note>", "replacementLine": "<updated line containing ${wikilink}>", "reason": "<short reason>"}

Linked Note Title: ${linkedFile.basename}
Linked Note Excerpt:
${linkedContent.slice(0, 1200)}

Host Note Title: ${hostFile.basename}
Host Note Content:
${beforeContent.slice(0, 2500)}`;

	const llmResult = await callBatchLlm(
		plugin,
		{
			providerId: opts?.providerId ?? '',
			modelId: opts?.modelId ?? '',
		},
		hostFile.path,
		'Orphan Contextual Link',
		prompt,
		opts?.signal,
		500,
	);

	let anchorLine = '';
	let replacementLine = '';
	let reason = '';
	try {
		const parsed = extractJsonObject(llmResult.text);
		if (typeof parsed === 'object' && parsed !== null) {
			const rec = parsed as Record<string, unknown>;
			if (typeof rec.anchorLine === 'string') anchorLine = rec.anchorLine;
			if (typeof rec.replacementLine === 'string') replacementLine = rec.replacementLine;
			if (typeof rec.reason === 'string') reason = rec.reason.trim();
		}
	} catch {
		// 파싱 실패 시 아래 안전 폴백으로 처리
	}

	const normalizedHost = beforeContent.replace(/\r\n/g, '\n');
	const lines = normalizedHost.split('\n');
	const trimmedAnchor = anchorLine.trim();
	const matchIdx =
		trimmedAnchor.length > 0
			? lines.findIndex((line) => line.trim() === trimmedAnchor)
			: -1;

	let afterContent: string;
	if (matchIdx >= 0 && replacementLine.includes(wikilink)) {
		lines[matchIdx] = replacementLine;
		afterContent = lines.join('\n');
	} else {
		afterContent = appendLinkToRelatedSection(beforeContent, wikilink);
		if (!reason) reason = 'Added under Related section';
	}

	return {
		orphanPath: orphanFile.path,
		targetPath: targetFile.path,
		direction,
		modifiedFilePath: hostFile.path,
		beforeContent,
		afterContent,
		reason: reason || 'Contextual link suggested',
		tokensUsed: llmResult.tokensUsed,
	};
}

/**
 * AI 문맥 링크 제안을 실제 파일에 반영하고 스냅샷을 반환합니다.
 */
export async function applyAiContextualLinkProposal(
	app: App,
	proposal: OrphanAiLinkProposal,
): Promise<BatchSnapshotEntry | null> {
	if (proposal.beforeContent === proposal.afterContent) return null;
	const file = app.vault.getAbstractFileByPath(proposal.modifiedFilePath);
	if (!(file instanceof TFile)) {
		throw new Error(`File not found: ${proposal.modifiedFilePath}`);
	}
	const originalRawContent = await app.vault.read(file);
	await app.vault.modify(file, proposal.afterContent);
	return {
		path: file.path,
		originalRawContent,
	};
}

/**
 * Pro 전용: 선택한 고아노트들을 새 MOC 파일로 묶거나 기존 MOC 하단에 누락된 링크를 추가합니다.
 */
export async function createOrAppendOrphanMoc(
	app: App,
	orphanFiles: readonly TFile[],
	rawMocPath: string,
	title: string,
	groupBy: MocGroupBy = 'folder',
	excludedPaths: string[] = [],
): Promise<{ mocPath: string; created: boolean; addedCount: number; snapshot?: BatchSnapshotEntry }> {
	if (orphanFiles.length === 0) {
		throw new Error('At least one orphan note is required.');
	}

	let normInput = rawMocPath.trim();
	if (!normInput) {
		throw new Error('MOC path is required.');
	}
	if (!normInput.toLowerCase().endsWith('.md')) {
		normInput += '.md';
	}
	const mocPath = sanitizeFilePath(normalizePath(normInput), true, app);
	const parentFolder = getParentFolder(mocPath);
	if (parentFolder) {
		const check = validateMoveDestination(parentFolder, {
			excludedPaths,
			configDir: app.vault?.configDir,
		});
		if (!check.valid) {
			throw new Error(`Invalid MOC folder: ${parentFolder} (${check.reason ?? 'invalid'})`);
		}
	}

	const existing = app.vault.getAbstractFileByPath(mocPath);
	if (existing instanceof TFile) {
		const originalRawContent = await app.vault.read(existing);
		const linesToAdd: string[] = [];
		for (const orphan of orphanFiles) {
			if (!hasWikiLinkToTarget(originalRawContent, orphan)) {
				linesToAdd.push(`- ${buildSafeWikiLink(app, orphan)}`);
			}
		}
		if (linesToAdd.length === 0) {
			return { mocPath, created: false, addedCount: 0 };
		}
		const trimmed = originalRawContent.replace(/\s+$/, '');
		const nextContent = `${trimmed}\n${linesToAdd.join('\n')}\n`;
		await app.vault.modify(existing, nextContent);
		return {
			mocPath,
			created: false,
			addedCount: linesToAdd.length,
			snapshot: {
				path: mocPath,
				originalRawContent,
			},
		};
	}

	const allMarkdownFiles = app.vault?.getMarkdownFiles?.() ?? [];
	const allBasenames = allMarkdownFiles.map((f) => f.basename);
	const entries: MocFileEntry[] = orphanFiles.map((f) => {
		const tags = collectNormalizedTagsForFile(app, f);
		return {
			path: normalizePath(f.path),
			basename: f.basename,
			firstTag: tags[0] ? `#${tags[0]}` : '',
		};
	});

	const mocTitle = title.trim() || 'Orphan Notes MOC';
	const content = buildMocContent(mocTitle, entries, groupBy, allBasenames);
	await ensureFolderExists(app, mocPath);
	await app.vault.create(mocPath, content);

	return {
		mocPath,
		created: true,
		addedCount: orphanFiles.length,
	};
}

/**
 * 고아노트 처리 작업 스냅샷을 Batch Studio 공통 히스토리에 기록합니다.
 */
export function recordOrphanHistory(
	snapshots: readonly BatchSnapshotEntry[],
	actionLabel: string,
): void {
	if (snapshots.length === 0) return;
	addBatchHistoryEntry({
		id: crypto.randomUUID(),
		timestamp: Date.now(),
		recipeId: 'autolink',
		appliedCount: snapshots.length,
		rolledBack: false,
		snapshots: [...snapshots],
		source: 'orphan',
		actionLabel,
	});
}
