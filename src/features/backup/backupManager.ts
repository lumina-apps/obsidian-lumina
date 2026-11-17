import { App, FuzzySuggestModal, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import { t } from '../../shared/locales/helpers';

export const BACKUP_FOLDER = 'backups';
const MAX_BACKUPS_PER_FILE = 10;

/**
 * Windows 및 기타 OS 파일 시스템에서 허용되지 않는 문자를 언더스코어로 치환합니다.
 * 허용되지 않는 문자: < > : " / \ | ? *
 */
function sanitizeFileName(name: string): string {
	return name.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * 백업 파일이 지정된 원본 경로(평탄화된 문자열)에 해당하는지 판별합니다.
 * 신규(.bak) 및 레거시(.md) 백업 파일명을 모두 호환 지원합니다.
 */
function isBackupForTarget(fileName: string, flatOriginalPath: string): boolean {
	const suffix = `_${flatOriginalPath}`;
	return (
		fileName.endsWith(`${suffix}.bak`) ||
		fileName.endsWith(suffix) ||
		fileName.endsWith(`${suffix}.md`)
	);
}

/**
 * 백업 파일명 앞의 타임스탬프(YYYYMMDD_HHMMSS)를 읽기 쉬운 형식으로 포맷팅합니다.
 */
export function formatBackupTimestamp(fileName: string): string {
	const match = fileName.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
	if (!match) return fileName;
	const [, y, m, d, hh, mm, ss] = match;
	return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

/**
 * 지정된 원본 문자열 내용을 기반으로 백업 파일을 생성합니다.
 * Obsidian 코어 인덱서(백링크, 태그, 그래프 뷰) 오염을 막기 위해 .bak 확장자로 저장하며,
 * 파일당 최근 MAX_BACKUPS_PER_FILE(10개)만 유지합니다.
 */
export async function createBackupFromContent(app: App, targetPath: string, content: string): Promise<void> {
	try {
		const vault = app.vault;

		// 1. 백업 폴더 확인/생성
		let backupFolder = vault.getAbstractFileByPath(BACKUP_FOLDER);
		if (!backupFolder) {
			backupFolder = await vault.createFolder(BACKUP_FOLDER);
		} else if (!(backupFolder instanceof TFolder)) {
			debugLogger.logError('backup', `Path '${BACKUP_FOLDER}' exists but is not a folder.`);
			return;
		}

		// 2. 백업 파일명 생성 (YYYYMMDD_HHMMSS_<flatOriginalPath>.bak)
		const now = new Date();
		const timestamp = now.getFullYear().toString() +
			(now.getMonth() + 1).toString().padStart(2, '0') +
			now.getDate().toString().padStart(2, '0') + '_' +
			now.getHours().toString().padStart(2, '0') +
			now.getMinutes().toString().padStart(2, '0') +
			now.getSeconds().toString().padStart(2, '0');

		const flatOriginalPath = sanitizeFileName(targetPath);
		const backupFileName = `${timestamp}_${flatOriginalPath}`;
		const finalBackupName = backupFileName.endsWith('.bak') ? backupFileName : `${backupFileName}.bak`;
		let backupFilePath = normalizePath(`${BACKUP_FOLDER}/${finalBackupName}`);

		// 같은 초에 연속 수정 시 파일명 충돌 방지
		if (vault.getAbstractFileByPath(backupFilePath)) {
			const ms = now.getMilliseconds().toString().padStart(3, '0');
			backupFilePath = normalizePath(`${BACKUP_FOLDER}/${timestamp}${ms}_${flatOriginalPath}.bak`);
		}

		// 3. 백업 저장
		await vault.create(backupFilePath, content);

		// 4. 보존 정책 적용
		const prunedCount = await enforceRetentionPolicy(app, flatOriginalPath);

		debugLogger.logSystem(
			'backup',
			`createBackup completed (target=${targetPath}, backup=${backupFilePath}${prunedCount > 0 ? `, pruned=${prunedCount}` : ''})`,
		);
	} catch (error) {
		debugLogger.logError('backup', normalizeError(error, `Failed to create backup for ${targetPath}: ${error}`));
		new Notice(`${t('common.error')}: Failed to create backup for ${targetPath}`);
	}
}

/**
 * 대상 파일이 존재하면 백업을 생성합니다.
 * Obsidian 코어 인덱서(백링크, 태그, 그래프 뷰) 오염을 막기 위해 .bak 확장자로 저장하며,
 * 파일당 최근 MAX_BACKUPS_PER_FILE(10개)만 유지합니다.
 */
export async function createBackup(app: App, targetPath: string): Promise<void> {
	let content: string;
	try {
		const vault = app.vault;

		// 1. 대상 파일 존재 여부 확인
		const file = vault.getAbstractFileByPath(normalizePath(targetPath));
		if (!(file instanceof TFile)) {
			debugLogger.logSystem('backup', `createBackup: file not found (${targetPath}), skipping.`);
			return;
		}

		// 2. 원본 내용 읽기
		content = await vault.read(file);
	} catch (error) {
		debugLogger.logError('backup', normalizeError(error, `Failed to create backup for ${targetPath}: ${error}`));
		new Notice(`${t('common.error')}: Failed to create backup for ${targetPath}`);
		return;
	}

	await createBackupFromContent(app, targetPath, content);
}

async function enforceRetentionPolicy(app: App, flatOriginalPath: string): Promise<number> {
	const vault = app.vault;
	const backupFolder = vault.getAbstractFileByPath(BACKUP_FOLDER);
	if (!(backupFolder instanceof TFolder)) return 0;

	const backupFiles = backupFolder.children.filter((child): child is TFile => {
		return child instanceof TFile && isBackupForTarget(child.name, flatOriginalPath);
	});

	if (backupFiles.length <= MAX_BACKUPS_PER_FILE) {
		return 0;
	}

	// 타임스탬프 오름차순 정렬 (가장 오래된 것부터 삭제)
	backupFiles.sort((a, b) => a.name.localeCompare(b.name));

	const numToDelete = backupFiles.length - MAX_BACKUPS_PER_FILE;
	const filesToDelete = backupFiles.slice(0, numToDelete);
	let deletedCount = 0;

	for (const file of filesToDelete) {
		try {
			await app.fileManager.trashFile(file);
			deletedCount++;
		} catch (e) {
			debugLogger.logError('backup', normalizeError(e, `Failed to delete old backup ${file.path}`));
		}
	}
	return deletedCount;
}

/**
 * 특정 노트에 대한 백업 파일 목록을 최신순으로 반환합니다.
 */
export function listBackupsForFile(app: App, targetPath: string): TFile[] {
	const backupFolder = app.vault.getAbstractFileByPath(BACKUP_FOLDER);
	if (!(backupFolder instanceof TFolder)) return [];

	const flatOriginalPath = sanitizeFileName(normalizePath(targetPath));
	return backupFolder.children
		.filter((child): child is TFile => child instanceof TFile && isBackupForTarget(child.name, flatOriginalPath))
		.sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * 선택한 백업 파일의 내용으로 원본 노트를 복원합니다.
 * 복원 전 현재 상태도 안전하게 백업합니다.
 */
export async function restoreBackup(app: App, targetPath: string, backupFile: TFile): Promise<boolean> {
	try {
		const normTarget = normalizePath(targetPath);
		const targetFile = app.vault.getAbstractFileByPath(normTarget);
		if (!(targetFile instanceof TFile)) {
			new Notice(t('uiMessages.fileNotFound'));
			return false;
		}

		const backupContent = await app.vault.read(backupFile);
		const currentContent = await app.vault.read(targetFile);

		if (currentContent !== backupContent) {
			await createBackup(app, normTarget);
			await app.vault.modify(targetFile, backupContent);
		}

		const formattedTime = formatBackupTimestamp(backupFile.name);
		debugLogger.logSystem('backup', `restoreBackup completed (target=${normTarget}, backup=${backupFile.path})`);
		new Notice(t('uiMessages.backupRestoreDone', { time: formattedTime }), 4000);
		return true;
	} catch (error) {
		debugLogger.logError('backup', normalizeError(error, `Failed to restore backup for ${targetPath}: ${error}`));
		new Notice(t('uiMessages.backupRestoreFailed'));
		return false;
	}
}

/**
 * 노트의 백업 시점을 선택하여 복원할 수 있는 모달.
 */
export class RestoreBackupModal extends FuzzySuggestModal<TFile> {
	private targetPath: string;
	private backups: TFile[];

	constructor(app: App, targetPath: string, backups: TFile[]) {
		super(app);
		this.targetPath = targetPath;
		this.backups = backups;
		this.setPlaceholder(t('uiMessages.backupRestorePlaceholder'));
	}

	getItems(): TFile[] {
		return this.backups;
	}

	getItemText(item: TFile): string {
		const timeLabel = formatBackupTimestamp(item.name);
		return `${timeLabel} (${item.name})`;
	}

	onChooseItem(item: TFile): void {
		void restoreBackup(this.app, this.targetPath, item);
	}
}

/**
 * 특정 노트에 대한 백업 복원 모달을 엽니다. 백업이 없으면 알림을 표시합니다.
 */
export function openRestoreBackupModal(app: App, targetFile: TFile): void {
	const backups = listBackupsForFile(app, targetFile.path);
	if (backups.length === 0) {
		new Notice(t('uiMessages.backupRestoreNone'));
		return;
	}
	new RestoreBackupModal(app, targetFile.path, backups).open();
}
