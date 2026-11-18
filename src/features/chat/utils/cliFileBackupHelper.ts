import { TFile, normalizePath } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { debugLogger } from '../../../shared/debugLogger';
import {
	getVaultBasePath as getVaultBasePathUtil,
	toVaultRelativePath as toVaultRelativePathUtil,
} from '../../../shared/utils/fileUtils';
import {
	addCliFileEdit,
	getMessages,
	updateCliFileEdit,
} from '../../../core/store/chatStore';

/**
 * 볼트 파일 시스템 절대 경로를 반환합니다.
 */
export function getVaultBasePath(plugin: LuminaPlugin): string {
	return getVaultBasePathUtil(plugin.app);
}

/**
 * 입력된 파일 경로(절대 경로 또는 상대 경로)를 볼트 루트 기준 상대 경로로 정규화합니다.
 */
export function toVaultRelativePath(plugin: LuminaPlugin, inputPath: string): string {
	return toVaultRelativePathUtil(plugin.app, inputPath);
}

/**
 * 볼트 내 파일 내용을 안전하게 읽습니다.
 */
export async function getFileContentSafely(
	plugin: LuminaPlugin,
	filePath: string,
): Promise<string | null> {
	try {
		const relPath = toVaultRelativePath(plugin, filePath);
		const file = plugin.app.vault.getAbstractFileByPath(relPath);
		if (file instanceof TFile) {
			return await plugin.app.vault.read(file);
		}
	} catch (e) {
		debugLogger.logDebug('cli-agent', `Could not read file ${filePath}: ${e}`);
	}
	return null;
}

/**
 * CLI 파일 수정 전 원본 내용을 스냅샷 맵에 1회 기록합니다.
 * 파일이 존재하지 않으면 null을 기록해 신규 생성 파일과 구분합니다.
 */
export async function captureFileSnapshot(
	plugin: LuminaPlugin,
	fileSnapshots: Map<string, string | null>,
	rawPath: string,
): Promise<void> {
	const relPath = toVaultRelativePath(plugin, rawPath);
	if (!relPath || fileSnapshots.has(relPath)) return;

	const currentContent = await getFileContentSafely(plugin, relPath);
	fileSnapshots.set(relPath, currentContent);
	if (rawPath && rawPath !== relPath && !fileSnapshots.has(rawPath)) {
		fileSnapshots.set(rawPath, currentContent);
	}
}

/**
 * CLI 에이전트가 볼트 문서를 수정하거나 삭제할 때 수정 전 원본 백업을 생성합니다.
 * 한 턴 내에서 동일 파일이 여러 번 수정되더라도 최초 원본 기준으로 1회만 백업합니다.
 */
export async function backupCliEditedFile(
	plugin: LuminaPlugin,
	relPath: string,
	rawPath: string,
	action: 'create' | 'modify' | 'delete',
	fileSnapshots: Map<string, string | null>,
	backedUpPaths: Set<string>,
): Promise<void> {
	const targetPath = relPath || rawPath;
	if (!targetPath) return;

	const normalizedPath = normalizePath(targetPath);
	if (!normalizedPath) {
		return;
	}

	const { BACKUP_FOLDER, createBackup, createBackupFromContent } = await import('../../backup/backupManager');
	if (normalizedPath === BACKUP_FOLDER || normalizedPath.startsWith(`${BACKUP_FOLDER}/`)) {
		return;
	}
	if (backedUpPaths.has(normalizedPath)) {
		return;
	}

	const snapshot = fileSnapshots.has(relPath)
		? fileSnapshots.get(relPath)
		: fileSnapshots.get(rawPath);

	if (typeof snapshot === 'string') {
		backedUpPaths.add(normalizedPath);
		await createBackupFromContent(plugin.app, normalizedPath, snapshot);
		return;
	}

	// 수정 전 볼트에 존재하지 않았던 신규 생성 파일은 백업을 생략
	if (snapshot === null || action === 'create') {
		return;
	}

	// 사전 스냅샷 없이 file_edit 이벤트만 직접 수신된 경우(예: Codex/Antigravity) 기존 파일 백업 시도
	backedUpPaths.add(normalizedPath);
	await createBackup(plugin.app, normalizedPath);
}

/**
 * CLI 프로세스 종료 후 file_edit 이벤트가 누락되었거나 셸 명령 등으로 수정된 스냅샷 파일들의 디스크 변경을 대조해 백업 및 로그를 보강합니다.
 */
export async function reconcileSnapshotBackups(
	plugin: LuminaPlugin,
	assistantId: string,
	fileSnapshots: Map<string, string | null>,
	backedUpPaths: Set<string>,
): Promise<void> {
	const checkedSnapshotPaths = new Set<string>();
	for (const [snapshotKey, snapshot] of fileSnapshots.entries()) {
		if (typeof snapshot !== 'string') continue;
		const relPath = toVaultRelativePath(plugin, snapshotKey);
		if (!relPath) continue;
		const normalizedPath = normalizePath(relPath);
		if (!normalizedPath || checkedSnapshotPaths.has(normalizedPath)) continue;
		checkedSnapshotPaths.add(normalizedPath);

		if (backedUpPaths.has(normalizedPath)) continue;

		const currentContent = await getFileContentSafely(plugin, normalizedPath);
		if (currentContent === snapshot) continue;

		const action: 'modify' | 'delete' = currentContent === null ? 'delete' : 'modify';
		await backupCliEditedFile(
			plugin,
			normalizedPath,
			snapshotKey,
			action,
			fileSnapshots,
			backedUpPaths,
		);

		const latestMsg = getMessages().find((m) => m.id === assistantId);
		const alreadyLogged = latestMsg?.cliFileEdits?.some(
			(fe) => normalizePath(toVaultRelativePath(plugin, fe.path)) === normalizedPath,
		);
		if (!alreadyLogged) {
			addCliFileEdit(assistantId, {
				id: `fe-${Date.now()}-${checkedSnapshotPaths.size}`,
				path: normalizedPath,
				action,
				timestamp: Date.now(),
				beforeContent: snapshot,
				afterContent: currentContent ?? '',
			});
		}
	}
}

/**
 * CLI 파일 편집 로그 중 afterContent가 비어 있는 항목에 대해 최종 디스크 내용을 채워 보정합니다.
 */
export async function backfillCliFileEditContents(
	plugin: LuminaPlugin,
	assistantId: string,
): Promise<void> {
	const finalAssistantMsg = getMessages().find((m) => m.id === assistantId);
	if (!finalAssistantMsg?.cliFileEdits) return;

	for (const fe of finalAssistantMsg.cliFileEdits) {
		if (!fe.afterContent && fe.action !== 'delete') {
			const current = await getFileContentSafely(plugin, fe.path);
			if (current !== null) {
				updateCliFileEdit(assistantId, fe.id, { afterContent: current });
			}
		}
	}
}
