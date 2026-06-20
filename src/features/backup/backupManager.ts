import { App, TFile, TFolder, normalizePath } from 'obsidian';

const BACKUP_FOLDER = 'backups';
const MAX_BACKUPS_PER_FILE = 10;

/**
 * Replaces characters that are invalid in Windows and other OS file systems with underscores.
 * Invalid characters typically include: < > : " / \ | ? *
 */
function sanitizeFileName(name: string): string {
	return name.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * Creates a backup of the target file if it exists.
 * Follows a retention policy to keep only the last MAX_BACKUPS_PER_FILE backups per file.
 */
export async function createBackup(app: App, targetPath: string): Promise<void> {
	try {
		const vault = app.vault;
		
		// 1. Check if the file exists
		const file = vault.getAbstractFileByPath(normalizePath(targetPath));
		if (!(file instanceof TFile)) {
			return; // File doesn't exist, nothing to backup
		}

		// 2. Ensure backup folder exists
		let backupFolder = vault.getAbstractFileByPath(BACKUP_FOLDER);
		if (!backupFolder) {
			backupFolder = await vault.createFolder(BACKUP_FOLDER);
		} else if (!(backupFolder instanceof TFolder)) {
			console.error(`[Backup] Path '${BACKUP_FOLDER}' exists but is not a folder.`);
			return;
		}

		// 3. Read original content
		const content = await vault.read(file);

		// 4. Generate backup file name
		const now = new Date();
		// Format: YYYYMMDD_HHMMSS
		const timestamp = now.getFullYear().toString() +
			(now.getMonth() + 1).toString().padStart(2, '0') +
			now.getDate().toString().padStart(2, '0') + '_' +
			now.getHours().toString().padStart(2, '0') +
			now.getMinutes().toString().padStart(2, '0') +
			now.getSeconds().toString().padStart(2, '0');

		// Extract just the file name with its logical path flattened
		const flatOriginalPath = sanitizeFileName(targetPath);
		const backupFileName = `${timestamp}_${flatOriginalPath}`;
		
		// Note: we append .md if it's not there, but targetPath should already have extension.
		const finalBackupName = backupFileName.endsWith('.md') ? backupFileName : backupFileName + '.md';
		const backupFilePath = normalizePath(`${BACKUP_FOLDER}/${finalBackupName}`);

		// 5. Save the backup
		await vault.create(backupFilePath, content);

		// 6. Enforce Retention Policy
		await enforceRetentionPolicy(app, flatOriginalPath);

	} catch (error) {
		console.error(`[Backup] Failed to create backup for ${targetPath}:`, error);
	}
}

async function enforceRetentionPolicy(app: App, flatOriginalPath: string): Promise<void> {
	const vault = app.vault;
	const backupFolder = vault.getAbstractFileByPath(BACKUP_FOLDER);
	if (!(backupFolder instanceof TFolder)) return;

	// Find all backups for this specific flatOriginalPath
	const suffix = `_${flatOriginalPath}`;
	const backupFiles = backupFolder.children.filter((child): child is TFile => {
		return child instanceof TFile && (child.name.endsWith(suffix) || child.name.endsWith(suffix + '.md'));
	});

	if (backupFiles.length <= MAX_BACKUPS_PER_FILE) {
		return;
	}

	// Sort backups by timestamp (which is at the beginning of the file name)
	// Example: 20260620_114220_folder_note.md
	backupFiles.sort((a, b) => a.name.localeCompare(b.name));

	// Delete the oldest backups
	const numToDelete = backupFiles.length - MAX_BACKUPS_PER_FILE;
	const filesToDelete = backupFiles.slice(0, numToDelete);

	for (const file of filesToDelete) {
		try {
			await app.fileManager.trashFile(file); // Use system trash
		} catch (e) {
			console.error(`[Backup] Failed to delete old backup ${file.path}:`, e);
		}
	}
}
