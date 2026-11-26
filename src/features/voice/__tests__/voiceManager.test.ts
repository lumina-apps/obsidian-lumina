import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Platform, TFile } from 'obsidian';
import { get } from 'svelte/store';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import {
	resetEntitlementState,
	setEntitlementState,
	setReleasedFeatures,
} from '../../../core/store/entitlementStore';
import { resetVoiceStore, voiceStore } from '../../../core/store/voiceStore';
import * as llmProviders from '../../../core/llm-providers';
import type LuminaPlugin from '../../../main';
import * as audioChunker from '../audio/audioChunker';
import * as sttResolver from '../stt/sttResolver';
import * as recoveryStore from '../audio/audioRecoveryStore';
import { VoiceNoteManager } from '../voiceManager';

function grantVoiceEntitlement(): void {
	setEntitlementState({
		tier: 'pro',
		status: 'active',
		enabledFeatures: new Set(['voice-note']),
	});
}

describe('VoiceNoteManager', () => {
	const origMediaDevices = navigator.mediaDevices;
	const origMediaRecorder = globalThis.MediaRecorder;
	const origAudioContext = globalThis.AudioContext;

	let trackStopMock: ReturnType<typeof vi.fn>;
	let fakeDocContent: string;
	let fakeEditor: {
		getValue: () => string;
		getCursor: () => { line: number; ch: number };
		setCursor: ReturnType<typeof vi.fn>;
		replaceRange: (text: string, from: { line: number; ch: number }, to?: { line: number; ch: number }) => void;
	};
	let mockPlugin: LuminaPlugin;

	beforeEach(() => {
		resetEntitlementState();
		resetVoiceStore();
		trackStopMock = vi.fn();
		fakeDocContent = '# 회의 노트\n';

		// 단순 줄/문자 기반 에디터 모킹
		const posToOffset = (doc: string, pos: { line: number; ch: number }): number => {
			const lines = doc.split('\n');
			let offset = 0;
			for (let i = 0; i < Math.min(pos.line, lines.length); i++) {
				offset += lines[i].length + 1;
			}
			return offset + pos.ch;
		};

		fakeEditor = {
			getValue: () => fakeDocContent,
			getCursor: () => {
				const lines = fakeDocContent.split('\n');
				return { line: lines.length - 1, ch: lines[lines.length - 1].length };
			},
			setCursor: vi.fn(),
			replaceRange: (text, from, to) => {
				const startOff = posToOffset(fakeDocContent, from);
				const endOff = to ? posToOffset(fakeDocContent, to) : startOff;
				fakeDocContent = fakeDocContent.slice(0, startOff) + text + fakeDocContent.slice(endOff);
			},
		};

		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LuminaPlugin['settings'];
		settings.connections.providers = [
			{
				id: 'prov-1',
				type: 'openai',
				credential: 'sk-test',
				availableModels: ['gpt-4o-mini'],
				isVerified: true,
			},
		];
		settings.voiceNote = {
			audioStorageMode: 'discard',
			autoWikiLink: false,
		};

		const activeFile = new TFile();
		activeFile.path = 'Notes/Meeting.md';
		activeFile.name = 'Meeting.md';
		activeFile.basename = 'Meeting';
		activeFile.extension = 'md';

		mockPlugin = {
			settings,
			app: {
				vault: {
					read: vi.fn().mockResolvedValue(fakeDocContent),
					modify: vi.fn().mockResolvedValue(undefined),
					create: vi.fn(),
					createBinary: vi.fn(),
					createFolder: vi.fn().mockResolvedValue(undefined),
					delete: vi.fn(),
					getMarkdownFiles: vi.fn().mockReturnValue([activeFile]),
					getAbstractFileByPath: vi.fn().mockReturnValue(activeFile),
					adapter: { getBasePath: () => '' },
				},
				fileManager: {
					trashFile: vi.fn().mockResolvedValue(undefined),
				},
				workspace: {
					getActiveViewOfType: vi.fn().mockReturnValue({
						file: activeFile,
						editor: fakeEditor,
					}),
					getActiveFile: vi.fn().mockReturnValue(activeFile),
					getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() }),
				},
				metadataCache: {
					getFileCache: vi.fn().mockReturnValue(null),
				},
			},
		} as unknown as LuminaPlugin;

		// 브라우저 미디어 API 격리 모킹
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				getUserMedia: vi.fn().mockResolvedValue({
					getTracks: () => [{ stop: trackStopMock }],
				}),
			},
		});

		class MockMediaRecorder {
			static isTypeSupported = vi.fn().mockReturnValue(true);
			mimeType = 'audio/webm';
			state: 'inactive' | 'recording' | 'paused' = 'inactive';
			ondataavailable: ((ev: { data: Blob }) => void) | null = null;
			onstop: (() => void) | null = null;
			start() {
				this.state = 'recording';
				this.ondataavailable?.({
					data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }),
				});
			}
			pause() {
				this.state = 'paused';
			}
			resume() {
				this.state = 'recording';
			}
			stop() {
				this.state = 'inactive';
				this.onstop?.();
			}
		}
		globalThis.MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder;
		globalThis.AudioContext = undefined as unknown as typeof AudioContext;

		vi.spyOn(recoveryStore, 'hasBackupSession').mockResolvedValue(false);
		vi.spyOn(recoveryStore, 'saveBackupSession').mockResolvedValue(undefined);
		vi.spyOn(recoveryStore, 'clearBackupSession').mockResolvedValue(undefined);
	});

	afterEach(() => {
		document.querySelectorAll('.lumina-voice-overlay-root').forEach((el) => el.remove());
		document.querySelectorAll('.lumina-voice-file-input').forEach((el) => el.remove());
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: origMediaDevices,
		});
		globalThis.MediaRecorder = origMediaRecorder;
		globalThis.AudioContext = origAudioContext;
		resetEntitlementState();
		resetVoiceStore();
		vi.restoreAllMocks();
	});

	it('권한(voice-note) 비활성 상태에서는 녹음·변환 및 UI 마운트를 완전히 차단한다', async () => {
		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();
		await manager.toggleRecording();
		await manager.startRecording();
		await manager.transcribeVaultFile(new TFile());

		expect(get(voiceStore).status).toBe('idle');
		expect(document.querySelector('.lumina-voice-overlay-root')).toBeNull();
		expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

		manager.destroy();
	});

	it('권한 활성 시 녹음→전사→LLM 정리→템플릿 재정리→되돌리기 전체 플로우를 수행한다', async () => {
		grantVoiceEntitlement();

		const transcribeSpy = vi.fn().mockResolvedValue({
			text: '금요일까지 시안 리뷰 완료하기로 했습니다.',
			segments: [{ startSec: 2, endSec: 6, text: '금요일까지 시안 리뷰 완료하기로 했습니다.' }],
			engineLabel: 'OpenAI (whisper-1)',
		});
		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'mock-stt',
			label: 'Mock STT',
			transcribe: transcribeSpy,
		});

		const chatSpy = vi
			.fn()
			.mockResolvedValueOnce({ content: '> [!summary] 요약\n> - 금요일 시안 리뷰' })
			.mockResolvedValueOnce({ content: '## 회의록\n- [ ] 금요일까지 시안 리뷰' });
		vi.spyOn(llmProviders, 'createProvider').mockReturnValue({
			providerId: 'prov-1',
			listModels: vi.fn(),
			chat: chatSpy,
			stream: vi.fn(),
			embed: vi.fn(),
		});

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();

		// 1. 녹음 시작
		await manager.startRecording();
		expect(get(voiceStore).status).toBe('recording');
		expect(document.querySelector('.lumina-voice-overlay-root')).not.toBeNull();

		// 2. 일시정지 / 재개
		manager.pauseRecording();
		expect(get(voiceStore).status).toBe('paused');
		manager.resumeRecording();
		expect(get(voiceStore).status).toBe('recording');

		// 3. 완료 및 노트 반영
		await manager.stopAndProcess();
		expect(transcribeSpy).toHaveBeenCalledTimes(1);
		expect(chatSpy).toHaveBeenCalledTimes(1);
		expect(trackStopMock).toHaveBeenCalled();
		expect(get(voiceStore).status).toBe('review');
		expect(fakeDocContent).toContain('> [!summary] 요약');
		expect(fakeDocContent).toContain('**[00:02](#lumina-ts=2)** 금요일까지 시안 리뷰 완료하기로 했습니다.');

		// 4. 오디오 재전송 없이 다른 템플릿('meeting')으로 즉시 재정리
		await manager.reprocessWithTemplate('meeting');
		expect(transcribeSpy).toHaveBeenCalledTimes(1); // 재전송 없음!
		expect(chatSpy).toHaveBeenCalledTimes(2);
		expect(fakeDocContent).toContain('## 회의록');
		expect(fakeDocContent).not.toContain('> [!summary] 요약');

		// 5. 되돌리기
		await manager.undoReview();
		expect(get(voiceStore).status).toBe('idle');
		expect(fakeDocContent.trim()).toBe('# 회의 노트');
		expect(document.querySelector('.lumina-voice-overlay-root')).toBeNull();

		manager.destroy();
	});

	it('destroy() 호출 시 진행 중 마이크 트랙·오버레이 DOM·스토어를 완전히 정리한다', async () => {
		grantVoiceEntitlement();
		const headerHost = document.createElement('div');
		document.body.appendChild(headerHost);
		const addActionSpy = vi.fn((_icon: string, _title: string, _cb: () => void) => {
			const btn = document.createElement('button');
			headerHost.appendChild(btn);
			return btn;
		});
		(mockPlugin.app.workspace as unknown as { getLeavesOfType: ReturnType<typeof vi.fn> }).getLeavesOfType =
			vi.fn().mockReturnValue([{ view: { addAction: addActionSpy } }]);

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();
		expect(addActionSpy).toHaveBeenCalledTimes(1);
		expect(headerHost.querySelector('.lumina-voice-view-action')).not.toBeNull();

		await manager.startRecording();
		expect(
			headerHost.querySelector('.lumina-voice-view-action')?.classList.contains('is-active'),
		).toBe(true);
		expect(document.querySelector('.lumina-voice-overlay-root')).not.toBeNull();

		manager.destroy();

		expect(trackStopMock).toHaveBeenCalled();
		expect(headerHost.querySelector('.lumina-voice-view-action')).toBeNull();
		expect(document.querySelector('.lumina-voice-overlay-root')).toBeNull();
		expect(get(voiceStore).status).toBe('idle');
		headerHost.remove();
	});

	it('새 노트가 생성된 경우 undoReview()는 vault.delete 대신 fileManager.trashFile을 호출한다', async () => {
		grantVoiceEntitlement();

		const createdFile = new TFile();
		createdFile.path = 'Voice Note 2026-01-01.md';
		createdFile.name = 'Voice Note 2026-01-01.md';
		createdFile.basename = 'Voice Note 2026-01-01';
		createdFile.extension = 'md';

		(mockPlugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(null);
		(mockPlugin.app.workspace.getActiveFile as ReturnType<typeof vi.fn>).mockReturnValue(null);
		(mockPlugin.app.vault.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdFile);
		(mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(createdFile);

		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'mock-stt',
			label: 'Mock STT',
			transcribe: vi.fn().mockResolvedValue({
				text: '새 노트 테스트 음성입니다.',
				segments: [{ startSec: 0, endSec: 2, text: '새 노트 테스트 음성입니다.' }],
				engineLabel: 'Mock STT',
			}),
		});
		vi.spyOn(llmProviders, 'createProvider').mockReturnValue({
			providerId: 'prov-1',
			listModels: vi.fn(),
			chat: vi.fn().mockResolvedValue({ content: '정리된 새 노트 본문' }),
			stream: vi.fn(),
			embed: vi.fn(),
		});

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();
		await manager.startRecording();
		await manager.stopAndProcess();

		expect(get(voiceStore).reviewResult?.createdNewFile).toBe(true);

		await manager.undoReview();

		expect(mockPlugin.app.fileManager.trashFile).toHaveBeenCalledWith(createdFile);
		expect(mockPlugin.app.vault.delete).not.toHaveBeenCalled();
		expect(get(voiceStore).status).toBe('idle');

		manager.destroy();
	});

	it('openAudioFilePicker()는 인라인 스타일 대신 lumina-voice-file-input 클래스를 부여한다', async () => {
		grantVoiceEntitlement();
		const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();
		manager.openAudioFilePicker();

		const input = document.body.querySelector<HTMLInputElement>('input.lumina-voice-file-input');
		expect(input).not.toBeNull();
		expect(input?.type).toBe('file');
		expect(input?.accept).toBe('audio/*,.m4a,.mp3,.wav,.webm,.ogg');
		expect(input?.style.display).toBe('');
		expect(clickSpy).toHaveBeenCalledTimes(1);

		input?.dispatchEvent(new Event('cancel'));
		expect(document.body.querySelector('input.lumina-voice-file-input')).toBeNull();

		manager.destroy();
	});

	it('STT 파이프라인 실패 시 stopAndProcess()는 IndexedDB 백업을 삭제하지 않고 보존한다', async () => {
		grantVoiceEntitlement();
		vi.mocked(recoveryStore.hasBackupSession).mockResolvedValue(true);
		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'mock-stt',
			label: 'Mock STT',
			transcribe: vi.fn().mockRejectedValue(new Error('Network timeout')),
		});

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();
		await manager.startRecording();
		await manager.stopAndProcess();

		expect(recoveryStore.clearBackupSession).not.toHaveBeenCalled();
		expect(get(voiceStore).status).toBe('error');
		expect(get(voiceStore).hasRecoverableSession).toBe(true);

		manager.destroy();
	});

	it('모바일 환경에서 local-whisper 설정 시 에러 차단 대신 오디오를 볼트에 저장하고 대기 마커를 삽입한다', async () => {
		const origIsMobile = Platform.isMobile;
		grantVoiceEntitlement();
		mockPlugin.settings.voiceNote = {
			...(mockPlugin.settings.voiceNote ?? {}),
			sttMode: 'local-whisper',
			audioFolder: 'Attachments/Voice',
		};
		const createProviderSpy = vi.spyOn(llmProviders, 'createProvider');

		try {
			(Platform as { isMobile: boolean }).isMobile = true;
			const manager = new VoiceNoteManager(mockPlugin);
			await manager.init();
			await manager.startRecording();

			expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
			expect(get(voiceStore).status).toBe('recording');
			expect(get(voiceStore).isDeferredCapture).toBe(true);

			await manager.stopAndProcess();

			expect(mockPlugin.app.vault.createBinary).toHaveBeenCalledTimes(1);
			expect(createProviderSpy).not.toHaveBeenCalled();
			expect(fakeDocContent).toContain('<!-- lumina-voice:pending');
			expect(fakeDocContent).toContain('![[Attachments/Voice/recording_');
			expect(get(voiceStore).status).toBe('idle');
			expect(get(voiceStore).isDeferredCapture).toBe(false);
			manager.destroy();
		} finally {
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
	});

	it('모바일 환경에서 local-whisper 설정 시 openAudioFilePicker()로 선택한 오디오도 볼트에 저장하고 대기 마커를 삽입한다', async () => {
		const origIsMobile = Platform.isMobile;
		grantVoiceEntitlement();
		mockPlugin.settings.voiceNote = {
			...(mockPlugin.settings.voiceNote ?? {}),
			sttMode: 'local-whisper',
			audioFolder: 'Attachments/Voice',
		};
		const createProviderSpy = vi.spyOn(llmProviders, 'createProvider');

		try {
			(Platform as { isMobile: boolean }).isMobile = true;
			const manager = new VoiceNoteManager(mockPlugin);
			await manager.init();
			manager.openAudioFilePicker();

			const input = document.body.querySelector<HTMLInputElement>('input.lumina-voice-file-input');
			expect(input).not.toBeNull();

			const mockAudioFile = new File([new Uint8Array([10, 20, 30])], 'memo.m4a', {
				type: 'audio/mp4',
			});
			Object.defineProperty(input, 'files', {
				configurable: true,
				value: [mockAudioFile],
			});
			input?.dispatchEvent(new Event('change'));
			await new Promise((r) => setTimeout(r, 20));

			expect(mockPlugin.app.vault.createBinary).toHaveBeenCalledTimes(1);
			expect(createProviderSpy).not.toHaveBeenCalled();
			expect(fakeDocContent).toContain('<!-- lumina-voice:pending');
			expect(fakeDocContent).toContain('![[Attachments/Voice/memo');
			expect(get(voiceStore).status).toBe('idle');
			manager.destroy();
		} finally {
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
	});

	it('모바일에서 mobileCaptureMode=defer-to-desktop 설정 시 클라우드 STT가 있어도 즉시 변환하지 않고 볼트에 저장한다', async () => {
		const origIsMobile = Platform.isMobile;
		grantVoiceEntitlement();
		mockPlugin.settings.voiceNote = {
			...(mockPlugin.settings.voiceNote ?? {}),
			sttMode: 'auto',
			mobileCaptureMode: 'defer-to-desktop',
			audioFolder: 'Attachments/Voice',
		};
		const resolveSpy = vi.spyOn(sttResolver, 'resolveSttEngine');

		try {
			(Platform as { isMobile: boolean }).isMobile = true;
			const manager = new VoiceNoteManager(mockPlugin);
			await manager.init();
			await manager.startRecording();
			await manager.stopAndProcess();

			expect(resolveSpy).not.toHaveBeenCalled();
			expect(mockPlugin.app.vault.createBinary).toHaveBeenCalledTimes(1);
			expect(fakeDocContent).toContain('<!-- lumina-voice:pending');
			expect(get(voiceStore).status).toBe('idle');
			manager.destroy();
		} finally {
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
	});

	it('모바일에서 mobileCaptureMode=auto이고 클라우드 STT가 연결되어 있으면 기존대로 즉시 변환을 수행한다', async () => {
		const origIsMobile = Platform.isMobile;
		grantVoiceEntitlement();
		mockPlugin.settings.voiceNote = {
			...(mockPlugin.settings.voiceNote ?? {}),
			sttMode: 'auto',
			mobileCaptureMode: 'auto',
			audioStorageMode: 'discard',
		};
		const transcribeSpy = vi.fn().mockResolvedValue({
			text: '모바일 즉시 변환 테스트',
			segments: [{ startSec: 0, endSec: 2, text: '모바일 즉시 변환 테스트' }],
			engineLabel: 'OpenAI (whisper-1)',
		});
		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'mock-stt',
			label: 'Mock STT',
			transcribe: transcribeSpy,
		});
		vi.spyOn(llmProviders, 'createProvider').mockReturnValue({
			providerId: 'prov-1',
			chat: vi.fn().mockResolvedValue({ content: '모바일 정리 결과' }),
		} as unknown as ReturnType<typeof llmProviders.createProvider>);

		try {
			(Platform as { isMobile: boolean }).isMobile = true;
			const manager = new VoiceNoteManager(mockPlugin);
			await manager.init();
			await manager.startRecording();
			expect(get(voiceStore).isDeferredCapture).toBe(false);

			await manager.stopAndProcess();
			expect(transcribeSpy).toHaveBeenCalledTimes(1);
			expect(fakeDocContent).toContain('모바일 정리 결과');
			expect(fakeDocContent).not.toContain('lumina-voice:pending');
			manager.destroy();
		} finally {
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
	});

	it('데스크톱에서 동기화된 대기 음성 노트를 processAllPendingItems()로 변환해 마커 블록만 제자리 치환한다', async () => {
		grantVoiceEntitlement();

		const noteFile = new TFile();
		noteFile.path = 'Notes/SyncNote.md';
		noteFile.name = 'SyncNote.md';
		noteFile.basename = 'SyncNote';
		noteFile.extension = 'md';
		noteFile.stat = { size: 200, ctime: 1, mtime: 1 };

		const audioFile = new TFile();
		audioFile.path = 'Attachments/Voice/mobile_rec.m4a';
		audioFile.name = 'mobile_rec.m4a';
		audioFile.basename = 'mobile_rec';
		audioFile.extension = 'm4a';
		audioFile.stat = { size: 4096, ctime: 1, mtime: Date.now() - 10_000 };

		let syncedNoteContent = [
			'# 모바일 메모',
			'',
			'<!-- lumina-voice:pending id="v_sync_1" audio="Attachments/Voice/mobile_rec.m4a" template="clean" -->',
			'![[Attachments/Voice/mobile_rec.m4a]]',
			'> [!info] 대기 중',
			'<!-- /lumina-voice:pending -->',
			'',
			'기존 사용자 본문 유지',
		].join('\n');

		const vaultMock = mockPlugin.app.vault as unknown as {
			getMarkdownFiles: ReturnType<typeof vi.fn>;
			getAbstractFileByPath: ReturnType<typeof vi.fn>;
			cachedRead: ReturnType<typeof vi.fn>;
			readBinary: ReturnType<typeof vi.fn>;
			process: ReturnType<typeof vi.fn>;
		};
		vaultMock.getMarkdownFiles = vi.fn().mockReturnValue([noteFile]);
		vaultMock.getAbstractFileByPath = vi.fn((p: string) => {
			if (p === noteFile.path) return noteFile;
			if (p === audioFile.path) return audioFile;
			return null;
		});
		vaultMock.cachedRead = vi.fn().mockImplementation(async () => syncedNoteContent);
		vaultMock.readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(16));
		vaultMock.process = vi.fn(async (_file: TFile, fn: (data: string) => string) => {
			syncedNoteContent = fn(syncedNoteContent);
			return syncedNoteContent;
		});

		const transcribeSpy = vi.fn().mockResolvedValue({
			text: '데스크톱에서 로컬 변환한 내용입니다.',
			segments: [{ startSec: 0, endSec: 4, text: '데스크톱에서 로컬 변환한 내용입니다.' }],
			engineLabel: 'Local Whisper',
		});
		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'stt-local-whisper',
			label: 'Local Whisper',
			transcribe: transcribeSpy,
		});
		vi.spyOn(llmProviders, 'createProvider').mockReturnValue({
			providerId: 'prov-1',
			chat: vi.fn().mockResolvedValue({ content: '> [!summary] 요약\n> - 동기화 변환 완료' }),
		} as unknown as ReturnType<typeof llmProviders.createProvider>);

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();
		await manager.processAllPendingItems();

		expect(transcribeSpy).toHaveBeenCalledTimes(1);
		expect(vaultMock.process).toHaveBeenCalledTimes(1);
		expect(syncedNoteContent).toContain('# 모바일 메모');
		expect(syncedNoteContent).toContain('기존 사용자 본문 유지');
		expect(syncedNoteContent).toContain('![[Attachments/Voice/mobile_rec.m4a]]');
		expect(syncedNoteContent).toContain('> - 동기화 변환 완료');
		expect(syncedNoteContent).not.toContain('lumina-voice:pending');
		expect(get(voiceStore).pendingItems).toEqual([]);
		expect(get(voiceStore).status).toBe('review');

		manager.destroy();
	});

	it('Freemium(무료 노출) 상태에서는 LLM을 호출하지 않고 순수 받아쓰기만 반영하며 AI 템플릿 재정리를 차단한다', async () => {
		setReleasedFeatures(['voice-note']);

		const transcribeSpy = vi.fn().mockResolvedValue({
			text: '무료 받아쓰기 원문입니다.',
			segments: [{ startSec: 0, endSec: 3, text: '무료 받아쓰기 원문입니다.' }],
			engineLabel: 'OpenAI (whisper-1)',
		});
		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'mock-stt',
			label: 'Mock STT',
			transcribe: transcribeSpy,
		});
		const createProviderSpy = vi.spyOn(llmProviders, 'createProvider');

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();
		await manager.startRecording();
		expect(get(voiceStore).templateId).toBe('verbatim');

		manager.setTemplateId('clean');
		expect(get(voiceStore).templateId).toBe('verbatim');

		await manager.stopAndProcess();
		expect(transcribeSpy).toHaveBeenCalledTimes(1);
		expect(createProviderSpy).not.toHaveBeenCalled();
		expect(fakeDocContent).toContain('무료 받아쓰기 원문입니다.');

		await manager.reprocessWithTemplate('meeting');
		expect(createProviderSpy).not.toHaveBeenCalled();
		expect(get(voiceStore).reviewResult?.templateId).toBe('verbatim');

		manager.destroy();
	});

	it('Freemium 상태에서 녹음 시간이 5분(300초)에 도달하면 자동 완료되고, 5분 초과 파일 변환은 차단된다', async () => {
		setReleasedFeatures(['voice-note']);
		vi.useFakeTimers();

		const transcribeSpy = vi.fn().mockResolvedValue({
			text: '5분 자동 종료 받아쓰기',
			segments: [{ startSec: 0, endSec: 300, text: '5분 자동 종료 받아쓰기' }],
			engineLabel: 'Mock STT',
		});
		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'mock-stt',
			label: 'Mock STT',
			transcribe: transcribeSpy,
		});

		const manager = new VoiceNoteManager(mockPlugin);
		try {
			await manager.init();
			await manager.startRecording();
			await vi.advanceTimersByTimeAsync(300_000);

			expect(transcribeSpy).toHaveBeenCalledTimes(1);
			expect(get(voiceStore).status).toBe('review');

			// 5분 초과 오디오 파일 차단 검증
			await manager.applyReview();
			vi.spyOn(audioChunker, 'measureAudioBlobDurationSec').mockResolvedValue(305);
			(mockPlugin.app.vault as unknown as { readBinary: ReturnType<typeof vi.fn> }).readBinary =
				vi.fn().mockResolvedValue(new ArrayBuffer(16));

			const longAudioFile = new TFile();
			longAudioFile.path = 'Recordings/long.m4a';
			longAudioFile.name = 'long.m4a';
			longAudioFile.extension = 'm4a';

			await manager.transcribeVaultFile(longAudioFile);
			expect(transcribeSpy).toHaveBeenCalledTimes(1);
			expect(get(voiceStore).status).toBe('idle');
		} finally {
			manager.destroy();
			vi.useRealTimers();
		}
	});

	it('미완료 녹음 백업 복구(recoverUnfinishedSession)와 폐기(discardUnfinishedSession)가 정상 동작한다', async () => {
		grantVoiceEntitlement();
		const chunk = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });

		vi.spyOn(recoveryStore, 'hasBackupSession').mockResolvedValue(true);
		vi.spyOn(recoveryStore, 'loadBackupSession').mockResolvedValueOnce({
			id: 'active',
			chunks: [chunk],
			mimeType: 'audio/webm',
			elapsedSec: 25,
			targetFilePath: 'Notes/Meeting.md',
			templateId: 'clean',
			updatedAt: Date.now(),
		});

		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'mock-stt',
			label: 'Mock STT',
			transcribe: vi.fn().mockResolvedValue({
				text: '복구된 녹음 전사 텍스트입니다.',
				segments: [{ startSec: 0, endSec: 5, text: '복구된 녹음 전사 텍스트입니다.' }],
				engineLabel: 'Mock STT',
			}),
		});
		vi.spyOn(llmProviders, 'createProvider').mockReturnValue({
			providerId: 'prov-1',
			chat: vi.fn().mockResolvedValue({ content: '복구된 요약 노트' }),
		} as unknown as ReturnType<typeof llmProviders.createProvider>);

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();
		expect(get(voiceStore).hasRecoverableSession).toBe(true);

		await manager.recoverUnfinishedSession();
		expect(get(voiceStore).status).toBe('review');
		expect(get(voiceStore).hasRecoverableSession).toBe(false);
		expect(recoveryStore.clearBackupSession).toHaveBeenCalledTimes(1);
		expect(fakeDocContent).toContain('복구된 요약 노트');

		// discardUnfinishedSession 테스트
		await manager.applyReview();
		await manager.discardUnfinishedSession();
		expect(recoveryStore.clearBackupSession).toHaveBeenCalledTimes(2);
		expect(get(voiceStore).hasRecoverableSession).toBe(false);
		expect(document.querySelector('.lumina-voice-overlay-root')).toBeNull();

		manager.destroy();
	});

	it('replaceWithRawTranscriptOnly, transcribeVaultFile 정상 경로, saveAudioToVault 충돌 회피를 검증한다', async () => {
		grantVoiceEntitlement();
		mockPlugin.settings.voiceNote = {
			audioStorageMode: 'vault',
			audioFolder: 'Attachments/Voice',
			autoWikiLink: false,
		};

		const audioFile = new TFile();
		audioFile.path = 'Recordings/clip.m4a';
		audioFile.name = 'clip.m4a';
		audioFile.extension = 'm4a';
		(mockPlugin.app.vault as unknown as { readBinary: ReturnType<typeof vi.fn> }).readBinary =
			vi.fn().mockResolvedValue(new ArrayBuffer(32));

		vi.spyOn(sttResolver, 'resolveSttEngine').mockReturnValue({
			id: 'mock-stt',
			label: 'Mock STT',
			transcribe: vi.fn().mockResolvedValue({
				text: '원본 전사 텍스트 그대로',
				segments: [{ startSec: 0, endSec: 3, text: '원본 전사 텍스트 그대로' }],
				engineLabel: 'Mock STT',
			}),
		});
		const chatSpy = vi.fn().mockResolvedValue({ content: 'LLM 가공 결과' });
		vi.spyOn(llmProviders, 'createProvider').mockReturnValue({
			providerId: 'prov-1',
			chat: chatSpy,
		} as unknown as ReturnType<typeof llmProviders.createProvider>);

		const manager = new VoiceNoteManager(mockPlugin);
		try {
			await manager.init();

			// 1) transcribeVaultFile 정상 변환 후 replaceWithRawTranscriptOnly 호출
			await manager.transcribeVaultFile(audioFile);
			expect(get(voiceStore).status).toBe('review');
			expect(fakeDocContent).toContain('LLM 가공 결과');

			await manager.replaceWithRawTranscriptOnly();
			expect(chatSpy).toHaveBeenCalledTimes(1); // 추가 LLM 호출 없음
			expect(get(voiceStore).templateId).toBe('verbatim');
			expect(fakeDocContent).toContain('원본 전사 텍스트 그대로');

			// 2) audioStorageMode='vault' 저장 시 동일 파일명이 이미 있으면 타임스탬프 접미사 부여
			await manager.applyReview();
			const createBinarySpy = mockPlugin.app.vault.createBinary as ReturnType<typeof vi.fn>;
			(mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation(
				(p: string) => {
					if (p.startsWith('Attachments/Voice/recording_')) return new TFile();
					return null;
				},
			);
			await manager.startRecording();
			await manager.stopAndProcess();
			expect(createBinarySpy).toHaveBeenCalledTimes(1);
			const savedPath = createBinarySpy.mock.calls[0][0] as string;
			expect(savedPath).toMatch(/^Attachments\/Voice\/recording_.*_\d+\./);
		} finally {
			manager.destroy();
		}
	});

	it('노트 내 #lumina-ts=초 링크 클릭 시 오디오 재생 시점을 이동하고, 마이크 권한 거부 시 error 상태 후 dismissError로 복구한다', async () => {
		grantVoiceEntitlement();

		const manager = new VoiceNoteManager(mockPlugin);
		await manager.init();

		// 1) #lumina-ts=75 클릭 -> audio.currentTime = 75 & play()
		const viewWrap = document.createElement('div');
		viewWrap.className = 'markdown-reading-view';
		const audioEl = document.createElement('audio');
		const playSpy = vi.fn().mockResolvedValue(undefined);
		audioEl.play = playSpy;
		const linkEl = document.createElement('a');
		linkEl.setAttribute('href', '#lumina-ts=75');
		viewWrap.appendChild(audioEl);
		viewWrap.appendChild(linkEl);
		document.body.appendChild(viewWrap);

		linkEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(audioEl.currentTime).toBe(75);
		expect(playSpy).toHaveBeenCalledTimes(1);
		viewWrap.remove();

		// 2) getUserMedia 권한 거부(NotAllowedError) -> status: 'error' -> dismissError() 복구
		const deniedErr = new Error('Permission denied');
		deniedErr.name = 'NotAllowedError';
		(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(deniedErr);

		await manager.startRecording();
		expect(get(voiceStore).status).toBe('error');
		expect(get(voiceStore).errorMessage).toBeTruthy();

		manager.dismissError();
		expect(get(voiceStore).status).toBe('idle');
		expect(get(voiceStore).errorMessage).toBeNull();

		manager.destroy();
	});
});
