/**
 * approvalListener.test.ts
 * 편집 승인 대기 시 파일 열기 및 읽기 모드 -> 편집/소스 모드 자동 전환 검증
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import { setupApprovalListener, cleanupApprovalListener } from './approvalListener';
import { approvalStore } from './approvalManager';

function createMockApp(options: {
	file: TFile;
	isOpen?: boolean;
	initialState?: Record<string, unknown>;
}) {
	const setState = vi.fn().mockResolvedValue(undefined);
	const getState = vi.fn().mockReturnValue(options.initialState ?? { mode: 'preview', source: false });
	const openFile = vi.fn().mockResolvedValue(undefined);

	const mockLeaf = {
		view: {
			file: options.isOpen === false ? undefined : options.file,
			getState,
			setState,
		},
		openFile: async (f: TFile) => {
			await openFile(f);
			mockLeaf.view.file = f;
		},
	};

	const app = {
		vault: {
			getAbstractFileByPath: vi.fn().mockReturnValue(options.file),
		},
		workspace: {
			getLeavesOfType: vi.fn().mockImplementation(() => (options.isOpen === false ? [] : [mockLeaf])),
			getLeaf: vi.fn().mockReturnValue(mockLeaf),
		},
	} as unknown as App;

	return { app, mockLeaf, setState, getState, openFile };
}

describe('approvalListener', () => {
	beforeEach(() => {
		approvalStore.set({ queue: [], undoStack: [] });
	});

	afterEach(() => {
		cleanupApprovalListener();
		approvalStore.set({ queue: [], undoStack: [] });
	});

	it('읽기 모드(preview)로 열린 노트에서 edit 승인 요청 시 편집 모드로 자동 전환한다', async () => {
		const file = new TFile();
		file.path = 'note.md';
		const { app, setState } = createMockApp({
			file,
			initialState: { mode: 'preview', source: false },
		});

		setupApprovalListener(app);
		approvalStore.set({
			undoStack: [],
			queue: [
				{
					id: 'req-1',
					filePath: 'note.md',
					baseContent: 'a',
					proposedContent: 'b',
					allChanges: [],
					chunks: [{ id: 'c1', changes: [], status: 'pending', startLine: 1, isTable: false }],
					actionType: 'edit',
					resolve: vi.fn(),
				},
			],
		});

		await Promise.resolve();
		expect(setState).toHaveBeenCalledWith({ mode: 'source', source: false }, { history: false });
	});

	it('표 변경점이 포함된 읽기 모드 노트는 소스 모드(source: true)로 자동 전환한다', async () => {
		const file = new TFile();
		file.path = 'table.md';
		const { app, setState } = createMockApp({
			file,
			initialState: { mode: 'preview', source: false },
		});

		setupApprovalListener(app);
		approvalStore.set({
			undoStack: [],
			queue: [
				{
					id: 'req-table',
					filePath: 'table.md',
					baseContent: '| a |',
					proposedContent: '| b |',
					allChanges: [],
					chunks: [{ id: 'c1', changes: [], status: 'pending', startLine: 1, isTable: true }],
					actionType: 'edit',
					resolve: vi.fn(),
				},
			],
		});

		await Promise.resolve();
		expect(setState).toHaveBeenCalledWith({ mode: 'source', source: true }, { history: false });
	});

	it('이미 편집 모드(source)인 경우 setState를 호출하지 않는다', async () => {
		const file = new TFile();
		file.path = 'note.md';
		const { app, setState } = createMockApp({
			file,
			initialState: { mode: 'source', source: false },
		});

		setupApprovalListener(app);
		approvalStore.set({
			undoStack: [],
			queue: [
				{
					id: 'req-2',
					filePath: 'note.md',
					baseContent: 'a',
					proposedContent: 'b',
					allChanges: [],
					chunks: [{ id: 'c1', changes: [], status: 'pending', startLine: 1, isTable: false }],
					actionType: 'edit',
					resolve: vi.fn(),
				},
			],
		});

		await Promise.resolve();
		expect(setState).not.toHaveBeenCalled();
	});

	it('동일 요청 ID에 대해서는 1회만 자동 전환한다', async () => {
		const file = new TFile();
		file.path = 'note.md';
		const { app, setState } = createMockApp({
			file,
			initialState: { mode: 'preview', source: false },
		});

		setupApprovalListener(app);
		const req = {
			id: 'req-once',
			filePath: 'note.md',
			baseContent: 'a',
			proposedContent: 'b',
			allChanges: [],
			chunks: [{ id: 'c1', changes: [], status: 'pending' as const, startLine: 1, isTable: false }],
			actionType: 'edit' as const,
			resolve: vi.fn(),
		};

		approvalStore.set({ queue: [req], undoStack: [] });
		await Promise.resolve();
		approvalStore.set({ queue: [{ ...req }], undoStack: [] });
		await Promise.resolve();

		expect(setState).toHaveBeenCalledTimes(1);
	});

	it('파일이 열려 있지 않으면 새 탭으로 열고 읽기 모드인 경우 편집 모드로 전환한다', async () => {
		const file = new TFile();
		file.path = 'closed.md';
		const { app, openFile, setState } = createMockApp({
			file,
			isOpen: false,
			initialState: { mode: 'preview', source: false },
		});

		setupApprovalListener(app);
		approvalStore.set({
			undoStack: [],
			queue: [
				{
					id: 'req-open',
					filePath: 'closed.md',
					baseContent: 'a',
					proposedContent: 'b',
					allChanges: [],
					chunks: [{ id: 'c1', changes: [], status: 'pending', startLine: 1, isTable: false }],
					actionType: 'edit',
					resolve: vi.fn(),
				},
			],
		});

		await new Promise((r) => setTimeout(r, 0));
		expect(openFile).toHaveBeenCalledWith(file);
		expect(setState).toHaveBeenCalledWith({ mode: 'source', source: false }, { history: false });
	});
});
