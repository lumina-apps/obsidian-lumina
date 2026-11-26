import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type EventRef, Platform, TFile } from 'obsidian';
import type { PendingVoiceItem } from '../../../shared/types/voice.types';
import { buildPendingVoiceBlock } from '../deferred/pendingVoiceMarker';
import { PendingVoiceScanner } from '../deferred/pendingVoiceScanner';

type VaultListener = (...args: unknown[]) => void;

function createMockApp(files: TFile[], contents: Map<string, string>) {
	const listeners = new Map<string, Set<VaultListener>>();
	const fileMap = new Map<string, TFile>();
	for (const f of files) {
		fileMap.set(f.path, f);
	}

	const app = {
		vault: {
			getMarkdownFiles: () => Array.from(fileMap.values()).filter((f) => f.extension === 'md'),
			getAbstractFileByPath: (p: string) => fileMap.get(p) ?? null,
			cachedRead: vi.fn(async (f: TFile) => contents.get(f.path) ?? ''),
			read: vi.fn(async (f: TFile) => contents.get(f.path) ?? ''),
			on: vi.fn((event: string, cb: VaultListener) => {
				let set = listeners.get(event);
				if (!set) {
					set = new Set();
					listeners.set(event, set);
				}
				set.add(cb);
				return { event, cb } as unknown as EventRef;
			}),
			offref: vi.fn((ref: EventRef) => {
				const raw = ref as unknown as { event?: string; cb?: VaultListener };
				if (raw.event && raw.cb) {
					listeners.get(raw.event)?.delete(raw.cb);
				}
			}),
		},
	} as unknown as App;

	const emit = (event: string, ...args: unknown[]) => {
		const set = listeners.get(event);
		if (!set) return;
		for (const cb of set) {
			cb(...args);
		}
	};

	return { app, emit, fileMap, listeners };
}

function makeFile(path: string, size = 1024, mtime = Date.now() - 10_000): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split('/').pop() ?? path;
	f.basename = f.name.replace(/\.[^.]+$/, '');
	f.extension = f.name.includes('.') ? f.name.split('.').pop() ?? '' : '';
	f.stat = { size, ctime: mtime, mtime };
	return f;
}

describe('PendingVoiceScanner', () => {
	const origIsMobile = Platform.isMobile;

	beforeEach(() => {
		(Platform as { isMobile: boolean }).isMobile = false;
	});

	afterEach(() => {
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('모바일 환경에서는 볼트 리스너를 등록하지 않고 즉시 반환한다', async () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		const note = makeFile('Note.md');
		const contents = new Map([[note.path, '']]);
		const { app } = createMockApp([note], contents);
		const onChange = vi.fn();

		const scanner = new PendingVoiceScanner(app, onChange);
		await scanner.start();

		expect(app.vault.on).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
		scanner.destroy();
	});

	it('초기 스캔 시 오디오 파일 유무에 따라 ready / waiting-audio를 구분하고, 도착 후 안정화되면 ready로 전환한다', async () => {
		vi.useFakeTimers();

		const readyNote = makeFile('Notes/Ready.md');
		const waitingNote = makeFile('Notes/Waiting.md');
		const readyAudio = makeFile('Attachments/Voice/ready.m4a', 2048, Date.now() - 10_000);

		const readyBlock = buildPendingVoiceBlock({
			id: 'v_ready',
			audioVaultPath: readyAudio.path,
			templateId: 'clean',
			pendingNoticeText: '대기 중',
		});
		const waitingBlock = buildPendingVoiceBlock({
			id: 'v_wait',
			audioVaultPath: 'Attachments/Voice/late.m4a',
			templateId: 'meeting',
			pendingNoticeText: '대기 중',
		});

		const contents = new Map<string, string>([
			[readyNote.path, readyBlock],
			[waitingNote.path, waitingBlock],
		]);

		const { app, emit, fileMap, listeners } = createMockApp(
			[readyNote, waitingNote, readyAudio],
			contents,
		);
		let latestItems: PendingVoiceItem[] = [];
		const scanner = new PendingVoiceScanner(
			app,
			(items) => {
				latestItems = items;
			},
			{ settleDelayMs: 3000 },
		);

		await scanner.start();
		expect(latestItems).toEqual([
			{
				id: 'v_ready',
				notePath: 'Notes/Ready.md',
				audioPath: 'Attachments/Voice/ready.m4a',
				templateId: 'clean',
				status: 'ready',
			},
			{
				id: 'v_wait',
				notePath: 'Notes/Waiting.md',
				audioPath: 'Attachments/Voice/late.m4a',
				templateId: 'meeting',
				status: 'waiting-audio',
			},
		]);

		// 늦게 도착한 오디오 생성 이벤트 발생 -> 즉시에는 waiting-audio 유지, 3초 안정화 후 ready 전환
		const lateAudio = makeFile('Attachments/Voice/late.m4a', 4096, Date.now());
		fileMap.set(lateAudio.path, lateAudio);
		emit('create', lateAudio);

		expect(latestItems.find((i) => i.id === 'v_wait')?.status).toBe('waiting-audio');

		await vi.advanceTimersByTimeAsync(3000);
		expect(latestItems.find((i) => i.id === 'v_wait')?.status).toBe('ready');

		// 노트에서 마커 제거 시 대기 목록에서도 즉시 제거
		contents.set(waitingNote.path, '변환 완료됨');
		emit('modify', waitingNote);
		for (let i = 0; i < 6; i++) {
			await Promise.resolve();
		}

		expect(latestItems.map((i) => i.id)).toEqual(['v_ready']);

		scanner.destroy();
		const totalRemainingListeners = Array.from(listeners.values()).reduce(
			(acc, set) => acc + set.size,
			0,
		);
		expect(totalRemainingListeners).toBe(0);
	});
});
