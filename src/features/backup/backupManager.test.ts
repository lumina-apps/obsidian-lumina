import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';
import { createBackup, createBackupFromContent, listBackupsForFile, restoreBackup, formatBackupTimestamp } from './backupManager';

describe('backupManager - createBackup & Retention Policy', () => {
	let mockApp: App;
	let mockVault: {
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		createFolder: ReturnType<typeof vi.fn>;
		read: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		modify: ReturnType<typeof vi.fn>;
	};
	let mockFileManager: {
		trashFile: ReturnType<typeof vi.fn>;
	};
	let backupFolder: TFolder;

	beforeEach(() => {
		vi.clearAllMocks();

		backupFolder = new TFolder();
		backupFolder.path = 'backups';
		backupFolder.name = 'backups';
		backupFolder.children = [];

		mockVault = {
			getAbstractFileByPath: vi.fn(),
			createFolder: vi.fn().mockResolvedValue(backupFolder),
			read: vi.fn().mockResolvedValue('# Test Note Content'),
			create: vi.fn().mockResolvedValue(new TFile()),
			modify: vi.fn().mockResolvedValue(undefined),
		};

		mockFileManager = {
			trashFile: vi.fn().mockResolvedValue(undefined),
		};

		mockApp = {
			vault: mockVault,
			fileManager: mockFileManager,
		} as unknown as App;
	});

	it('대상 파일이 존재하지 않으면 백업을 생성하지 않고 조용히 종료한다', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);

		await createBackup(mockApp, 'missing.md');

		expect(mockVault.create).not.toHaveBeenCalled();
		expect(mockVault.read).not.toHaveBeenCalled();
	});

	it('백업 폴더(backups)가 없으면 폴더를 자동 생성하고 .bak 확장자로 백업 파일을 저장한다', async () => {
		const targetFile = new TFile();
		targetFile.path = 'Note.md';
		targetFile.name = 'Note.md';

		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'Note.md') return targetFile;
			if (path === 'backups') return null; // 아직 백업 폴더 없음
			return null;
		});

		await createBackup(mockApp, 'Note.md');

		expect(mockVault.createFolder).toHaveBeenCalledWith('backups');
		expect(mockVault.read).toHaveBeenCalledWith(targetFile);
		expect(mockVault.create).toHaveBeenCalledWith(
			expect.stringMatching(/^backups\/\d{8}_\d{6}_Note\.md\.bak$/),
			'# Test Note Content',
		);
	});

	it('백업 폴더 경로에 폴더가 아닌 일반 파일이 존재하면 백업을 중단한다', async () => {
		const targetFile = new TFile();
		targetFile.path = 'Note.md';

		const dummyFile = new TFile();
		dummyFile.path = 'backups'; // 폴더가 아니라 파일

		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'Note.md') return targetFile;
			if (path === 'backups') return dummyFile;
			return null;
		});

		await createBackup(mockApp, 'Note.md');

		expect(mockVault.create).not.toHaveBeenCalled();
	});

	it('경로에 포함된 특수문자(< > : " / \\ | ? *)를 언더스코어로 안전하게 치환하고 .bak으로 저장한다', async () => {
		const targetFile = new TFile();
		targetFile.path = 'sub/folder/file:name*test.md';

		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path.includes('sub/folder')) return targetFile;
			if (path === 'backups') return backupFolder;
			return null;
		});

		await createBackup(mockApp, 'sub/folder/file:name*test.md');

		expect(mockVault.create).toHaveBeenCalledWith(
			expect.stringMatching(/^backups\/\d{8}_\d{6}_sub_folder_file_name_test\.md\.bak$/),
			'# Test Note Content',
		);
	});

	it('보존 정책(Retention Policy): 백업(.bak 및 레거시 .md 포함)이 10개를 초과할 때 가장 오래된 백업을 휴지통(trashFile)으로 삭제한다', async () => {
		const targetFile = new TFile();
		targetFile.path = 'Project.md';

		// 11개의 기존 백업 파일 목록 준비 (레거시 .md와 신규 .bak 혼합)
		const existingBackups: TFile[] = [];
		for (let i = 1; i <= 11; i++) {
			const bf = new TFile();
			const day = String(i).padStart(2, '0');
			bf.name = i <= 5 ? `202601${day}_120000_Project.md` : `202601${day}_120000_Project.md.bak`;
			bf.path = `backups/${bf.name}`;
			existingBackups.push(bf);
		}
		backupFolder.children = [...existingBackups];

		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'Project.md') return targetFile;
			if (path === 'backups') return backupFolder;
			return null;
		});

		await createBackup(mockApp, 'Project.md');

		expect(mockFileManager.trashFile).toHaveBeenCalledTimes(1);
		expect(mockFileManager.trashFile).toHaveBeenCalledWith(existingBackups[0]); // 가장 오래된 20260101 백업
	});

	it('listBackupsForFile은 해당 노트의 백업(.bak, .md)을 최신순으로 반환한다', () => {
		const older = new TFile();
		older.name = '20260101_100000_docs_Guide.md';
		older.path = `backups/${older.name}`;

		const newer = new TFile();
		newer.name = '20260102_100000_docs_Guide.md.bak';
		newer.path = `backups/${newer.name}`;

		const otherNote = new TFile();
		otherNote.name = '20260103_100000_Other.md.bak';
		otherNote.path = `backups/${otherNote.name}`;

		backupFolder.children = [older, otherNote, newer];
		mockVault.getAbstractFileByPath.mockReturnValue(backupFolder);

		const list = listBackupsForFile(mockApp, 'docs/Guide.md');
		expect(list.map((f) => f.name)).toEqual([newer.name, older.name]);
	});

	it('restoreBackup은 복원 전 현재 상태를 백업한 뒤 대상 노트를 백업 내용으로 수정한다', async () => {
		const targetFile = new TFile();
		targetFile.path = 'Note.md';

		const backupFile = new TFile();
		backupFile.name = '20260101_120000_Note.md.bak';
		backupFile.path = `backups/${backupFile.name}`;

		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'Note.md') return targetFile;
			if (path === 'backups') return backupFolder;
			return null;
		});
		mockVault.read.mockImplementation(async (f: TFile) => {
			if (f === backupFile) return '# Restored Content';
			return '# Modified Current Content';
		});

		const ok = await restoreBackup(mockApp, 'Note.md', backupFile);

		expect(ok).toBe(true);
		// 복원 전 현재 내용을 백업으로 저장
		expect(mockVault.create).toHaveBeenCalledWith(
			expect.stringMatching(/^backups\/\d{8}_\d{6}_Note\.md\.bak$/),
			'# Modified Current Content',
		);
		expect(mockVault.modify).toHaveBeenCalledWith(targetFile, '# Restored Content');
	});

	it('formatBackupTimestamp는 파일명의 타임스탬프를 읽기 쉬운 형식으로 변환한다', () => {
		expect(formatBackupTimestamp('20261117_163045_Note.md.bak')).toBe('2026-11-17 16:30:45');
	});

	it('createBackupFromContent는 디스크를 다시 읽지 않고 전달된 원본 문자열로 .bak 백업을 저장한다', async () => {
		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'backups') return backupFolder;
			return null;
		});

		await createBackupFromContent(mockApp, 'docs/PreSnapshot.md', '# Original Snapshot Content');

		expect(mockVault.read).not.toHaveBeenCalled();
		expect(mockVault.create).toHaveBeenCalledWith(
			expect.stringMatching(/^backups\/\d{8}_\d{6}_docs_PreSnapshot\.md\.bak$/),
			'# Original Snapshot Content',
		);
	});
});
