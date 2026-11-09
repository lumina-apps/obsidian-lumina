import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';
import { createBackup } from './backupManager';

describe('backupManager - createBackup & Retention Policy', () => {
	let mockApp: App;
	let mockVault: {
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		createFolder: ReturnType<typeof vi.fn>;
		read: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
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

	it('백업 폴더(backups)가 없으면 폴더를 자동 생성하고 백업 파일을 저장한다', async () => {
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
			expect.stringMatching(/^backups\/\d{8}_\d{6}_Note\.md$/),
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

	it('경로에 포함된 특수문자(< > : " / \\ | ? *)를 언더스코어로 안전하게 치환한다', async () => {
		const targetFile = new TFile();
		targetFile.path = 'sub/folder/file:name*test.md';

		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path.includes('sub/folder')) return targetFile;
			if (path === 'backups') return backupFolder;
			return null;
		});

		await createBackup(mockApp, 'sub/folder/file:name*test.md');

		expect(mockVault.create).toHaveBeenCalledWith(
			expect.stringMatching(/^backups\/\d{8}_\d{6}_sub_folder_file_name_test\.md$/),
			'# Test Note Content',
		);
	});

	it('보존 정책(Retention Policy): 백업이 10개를 초과할 때 가장 오래된 백업을 휴지통(trashFile)으로 삭제한다', async () => {
		const targetFile = new TFile();
		targetFile.path = 'Project.md';

		// 11개의 기존 백업 파일 목록 준비
		const existingBackups: TFile[] = [];
		for (let i = 1; i <= 11; i++) {
			const bf = new TFile();
			const day = String(i).padStart(2, '0');
			bf.name = `202601${day}_120000_Project.md`;
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

		// 11개 + 새 백업 = 11개 이상이므로, MAX_BACKUPS_PER_FILE(10)을 초과한 분량(11 - 10 = 1개)의 가장 오래된 백업이 삭제되어야 함
		expect(mockFileManager.trashFile).toHaveBeenCalledTimes(1);
		expect(mockFileManager.trashFile).toHaveBeenCalledWith(existingBackups[0]); // 가장 오래된 20260101 백업
	});
});
