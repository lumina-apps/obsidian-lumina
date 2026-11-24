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

	it('모바일 환경에서 local-whisper 설정 시 녹음 시작 전 사전 차단한다', async () => {
		const origIsMobile = Platform.isMobile;
		grantVoiceEntitlement();
		mockPlugin.settings.voiceNote = {
			...(mockPlugin.settings.voiceNote ?? {}),
			sttMode: 'local-whisper',
		};

		try {
			(Platform as { isMobile: boolean }).isMobile = true;
			const manager = new VoiceNoteManager(mockPlugin);
			await manager.init();
			await manager.startRecording();

			expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
			expect(get(voiceStore).status).toBe('error');
			manager.destroy();
		} finally {
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
	});

	it('모바일 환경에서 local-whisper 설정 시 openAudioFilePicker()도 파일 선택기를 열기 전 사전 차단한다', async () => {
		const origIsMobile = Platform.isMobile;
		grantVoiceEntitlement();
		mockPlugin.settings.voiceNote = {
			...(mockPlugin.settings.voiceNote ?? {}),
			sttMode: 'local-whisper',
		};

		const createElSpy = vi.spyOn(document.body, 'createEl');
		try {
			(Platform as { isMobile: boolean }).isMobile = true;
			const manager = new VoiceNoteManager(mockPlugin);
			await manager.init();
			manager.openAudioFilePicker();

			expect(createElSpy).not.toHaveBeenCalled();
			expect(get(voiceStore).status).toBe('error');
			manager.destroy();
		} finally {
			createElSpy.mockRestore();
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
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
});
