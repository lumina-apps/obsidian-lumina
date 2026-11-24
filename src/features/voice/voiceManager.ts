/**
 * voiceManager.ts
 *
 * AI Voice-to-Note 도메인 전체 오케스트레이터 매니저.
 * - 권한(canUseFeature('voice-note')) 활성 시에만 main.ts에서 지연 로드됨
 * - 실시간 녹음(플로팅 위젯), 파일 업로드 변환, 대용량 분할, LLM 정리,
 *   원클릭 재정리/되돌리기, 타임스탬프 오디오 싱크 재생, 미완료 녹음 복구 담당
 */

import { Editor, type EventRef, MarkdownView, Notice, Platform, TFile, normalizePath } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LuminaPlugin from '../../main';
import {
	canUseFeature,
	canUseProFeature,
	FREE_MAX_VOICE_DURATION_SEC,
} from '../../core/store/entitlementStore';
import { notifyProFeatureLocked } from '../../shared/utils/proUpgradeModal';
import {
	appendLiveSegment,
	getVoiceState,
	patchVoiceState,
	resetVoiceStore,
	voiceStore,
} from '../../core/store/voiceStore';
import { debugLogger } from '../../shared/debugLogger';
import { t } from '../../shared/locales/helpers';
import type {
	SttTranscriptionResult,
	TranscriptSegment,
	VoiceEditorPosition,
	VoiceReviewResult,
	VoiceTemplateId,
} from '../../shared/types/voice.types';
import { normalizeError } from '../../shared/utils/errorUtils';
import { ensureFolderExists, sanitizeFilePath, sanitizeFilename } from '../../shared/utils/fileUtils';
import { measureAudioBlobDurationSec, splitAudioBlobForApi } from './audio/audioChunker';
import {
	clearBackupSession,
	hasBackupSession,
	loadBackupSession,
	saveBackupSession,
} from './audio/audioRecoveryStore';
import { extensionForMimeType, VoiceAudioRecorder } from './audio/audioRecorder';
import { assembleVoiceNoteMarkdown, extractUserMemoDiff } from './llm/voicePrompts';
import { processTranscriptToNote } from './llm/voiceNoteProcessor';
import { resolveSttEngine } from './stt/sttResolver';
import type { ISttEngine } from './stt/sttTypes';
import VoicePostActionBar from './ui/VoicePostActionBar.svelte';
import VoiceRecorderPill from './ui/VoiceRecorderPill.svelte';
import { getVoicePreferences } from './voicePreferences';

function formatDateStampForFile(date: Date): string {
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	const hh = String(date.getHours()).padStart(2, '0');
	const min = String(date.getMinutes()).padStart(2, '0');
	const ss = String(date.getSeconds()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}_${hh}${min}${ss}`;
}

function mimeFromAudioExtension(ext: string): string {
	switch (ext.toLowerCase()) {
		case 'm4a':
		case 'mp4':
			return 'audio/mp4';
		case 'mp3':
			return 'audio/mpeg';
		case 'wav':
			return 'audio/wav';
		case 'ogg':
			return 'audio/ogg';
		case 'webm':
		default:
			return 'audio/webm';
	}
}

/**
 * Voice-to-Note 전체 세션 및 UI 라이프사이클 매니저
 */
export class VoiceNoteManager {
	private plugin: LuminaPlugin;
	private recorder: VoiceAudioRecorder | null = null;
	private activeSttEngine: ISttEngine | null = null;
	private abortController: AbortController | null = null;
	private liveQueuePromise: Promise<void> = Promise.resolve();

	// 녹음 세션 컨텍스트 스냅샷
	private targetFile: TFile | null = null;
	private targetEditor: Editor | null = null;
	private initialNoteContent = '';
	private liveInsertStart: VoiceEditorPosition | null = null;
	private liveInsertEnd: VoiceEditorPosition | null = null;

	// 오버레이 UI 마운트 관리
	private overlayContainerEl: HTMLElement | null = null;
	private pillHostEl: HTMLElement | null = null;
	private reviewHostEl: HTMLElement | null = null;
	private mountedPill: Record<string, unknown> | null = null;
	private mountedReview: Record<string, unknown> | null = null;

	private boundTimestampClickHandler: ((ev: MouseEvent) => void) | null = null;
	private decoratedViews = new WeakSet<object>();
	private injectedActionBtns = new Set<HTMLElement>();
	private layoutChangeRef: EventRef | null = null;
	private unsubVoiceStore: (() => void) | null = null;
	private isDestroyed = false;
	private autoStoppingOnLimit = false;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	/**
	 * 매니저 초기화: 타임스탬프 싱크 리스너 등록, 마크다운 뷰 헤더 버튼 주입 및 미완료 녹음 백업 확인
	 */
	async init(): Promise<void> {
		if (this.isDestroyed || !canUseFeature('voice-note')) return;

		if (!this.boundTimestampClickHandler && typeof document !== 'undefined') {
			this.boundTimestampClickHandler = (ev: MouseEvent) => {
				this.handleDocumentClickForTimestamp(ev);
			};
			document.addEventListener('click', this.boundTimestampClickHandler, true);
		}

		this.syncMarkdownViewActions();
		if (!this.layoutChangeRef && typeof this.plugin.app.workspace.on === 'function') {
			this.layoutChangeRef = this.plugin.app.workspace.on('layout-change', () => {
				this.syncMarkdownViewActions();
			});
		}

		if (!this.unsubVoiceStore) {
			this.unsubVoiceStore = voiceStore.subscribe((s) => {
				const isActive = s.status === 'recording' || s.status === 'paused';
				for (const btn of this.injectedActionBtns) {
					btn.classList.toggle('is-active', isActive);
				}
			});
		}

		const recoverable = await hasBackupSession();
		if (this.isDestroyed || !canUseFeature('voice-note')) return;

		if (recoverable) {
			patchVoiceState({ hasRecoverableSession: true });
			this.ensureOverlayMounted();
		}
	}

	/**
	 * 열린 모든 마크다운 노트의 우측 상단 헤더 액션 바에 마이크 버튼을 중복 없이 주입합니다.
	 */
	syncMarkdownViewActions(): void {
		if (this.isDestroyed || !canUseFeature('voice-note')) return;
		const leaves = this.plugin.app.workspace.getLeavesOfType?.('markdown') ?? [];
		const s = getVoiceState();
		const isActive = s.status === 'recording' || s.status === 'paused';

		for (const leaf of leaves) {
			const view = leaf?.view as unknown as {
				addAction?: (icon: string, title: string, callback: (evt: MouseEvent) => void) => HTMLElement;
			} | null;
			if (!view || typeof view.addAction !== 'function' || this.decoratedViews.has(view)) {
				continue;
			}
			this.decoratedViews.add(view);
			const btn = view.addAction('lumina-voice-note', t('voiceNote.cmdToggleRecord'), () => {
				void this.toggleRecording();
			});
			if (btn) {
				btn.classList.add('lumina-voice-view-action');
				btn.classList.toggle('is-active', isActive);
				this.injectedActionBtns.add(btn);
			}
		}
	}

	/**
	 * 녹음 상태를 토글합니다 (대기/오류/검토 중이면 시작, 녹음/일시정지 중이면 완료 및 정리).
	 */
	async toggleRecording(): Promise<void> {
		if (!canUseFeature('voice-note')) return;
		const { status } = getVoiceState();
		if (status === 'recording' || status === 'paused') {
			await this.stopAndProcess();
			return;
		}
		if (status === 'transcribing' || status === 'processing') {
			return;
		}
		await this.startRecording();
	}

	/**
	 * 실시간 마이크 녹음을 시작합니다.
	 */
	async startRecording(): Promise<void> {
		if (!canUseFeature('voice-note') || this.isDestroyed) return;
		const current = getVoiceState().status;
		if (current === 'recording' || current === 'paused' || current === 'transcribing' || current === 'processing') {
			return;
		}

		const prefs = getVoicePreferences(this.plugin.settings);
		if (!this.preflightMobileStt(prefs)) {
			return;
		}

		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		this.targetFile = view?.file ?? this.plugin.app.workspace.getActiveFile() ?? null;
		this.targetEditor = view?.editor ?? null;
		this.initialNoteContent = this.targetEditor
			? this.targetEditor.getValue()
			: this.targetFile
				? await this.plugin.app.vault.read(this.targetFile)
				: '';

		const isProVoice = canUseProFeature('voice-note');
		this.autoStoppingOnLimit = false;
		this.liveInsertStart = this.targetEditor ? this.targetEditor.getCursor() : null;
		this.liveInsertEnd = this.liveInsertStart ? { ...this.liveInsertStart } : null;
		this.liveQueuePromise = Promise.resolve();

		patchVoiceState({
			status: 'recording',
			elapsedSec: 0,
			audioLevel: 0,
			templateId: isProVoice ? prefs.defaultTemplate : 'verbatim',
			recordMode: prefs.recordMode,
			liveSegments: [],
			progressStep: 0,
			progressDetail: '',
			errorMessage: null,
			reviewResult: null,
		});

		this.ensureOverlayMounted();
		this.abortController = new AbortController();

		const recorder = new VoiceAudioRecorder({
			onLevel: (audioLevel) => {
				patchVoiceState({ audioLevel });
			},
			onElapsed: (elapsedSec) => {
				patchVoiceState({ elapsedSec });
				if (
					!canUseProFeature('voice-note') &&
					elapsedSec >= FREE_MAX_VOICE_DURATION_SEC &&
					!this.autoStoppingOnLimit
				) {
					this.autoStoppingOnLimit = true;
					notifyProFeatureLocked(
						this.plugin.app,
						'voice-note',
						t('voiceNote.proMaxDurationReachedNotice'),
					);
					void this.stopAndProcess();
				}
			},
			onBackupTick: (chunks, mimeType, elapsedSec) => {
				void saveBackupSession({
					chunks,
					mimeType,
					elapsedSec,
					targetFilePath: this.targetFile?.path ?? null,
					templateId: getVoiceState().templateId,
				});
			},
			onSpeechChunk: (chunk) => {
				this.enqueueLiveChunkTranscription(chunk.wavBlob, chunk.offsetSec);
			},
		});

		this.recorder = recorder;

		try {
			await recorder.start();
		} catch (err: unknown) {
			debugLogger.logError('voice', normalizeError(err, `Microphone start failed: ${err}`));
			this.recorder = null;
			const msg = t('voiceNote.notices.micPermissionDenied');
			new Notice(msg);
			patchVoiceState({
				status: 'error',
				errorMessage: msg,
				audioLevel: 0,
			});
		}
	}

	/** 녹음 일시정지 */
	pauseRecording(): void {
		if (!this.recorder || getVoiceState().status !== 'recording') return;
		this.recorder.pause();
		patchVoiceState({ status: 'paused', audioLevel: 0 });
	}

	/** 일시정지된 녹음 재개 */
	resumeRecording(): void {
		if (!this.recorder || getVoiceState().status !== 'paused') return;
		this.recorder.resume();
		patchVoiceState({ status: 'recording' });
	}

	/** 녹음 중 출력 템플릿 변경 */
	setTemplateId(templateId: VoiceTemplateId): void {
		if (!canUseProFeature('voice-note') && templateId !== 'verbatim') {
			notifyProFeatureLocked(this.plugin.app, 'voice-note', t('voiceNote.proTemplateNotice'));
			return;
		}
		patchVoiceState({ templateId });
	}

	/**
	 * 녹음을 취소하고 마이크/임시 데이터를 즉시 정리합니다.
	 */
	cancelRecording(): void {
		this.autoStoppingOnLimit = false;
		this.abortController?.abort();
		this.abortController = null;
		this.recorder?.cancel();
		this.recorder = null;
		void clearBackupSession();
		patchVoiceState({
			status: 'idle',
			elapsedSec: 0,
			audioLevel: 0,
			liveSegments: [],
			errorMessage: null,
			hasRecoverableSession: false,
		});
		this.unmountOverlayIfIdle();
	}

	/**
	 * 진행 중인 녹음을 완료하고 STT + LLM 정리 및 노트 반영을 수행합니다.
	 */
	async stopAndProcess(): Promise<void> {
		if (!this.recorder || !canUseFeature('voice-note')) return;

		const prefs = getVoicePreferences(this.plugin.settings);
		const templateId = canUseProFeature('voice-note') ? getVoiceState().templateId : 'verbatim';
		const recorder = this.recorder;
		this.recorder = null;
		this.autoStoppingOnLimit = false;

		const recorded = await recorder.stop();
		await this.liveQueuePromise;

		const currentNoteContent = this.targetEditor
			? this.targetEditor.getValue()
			: this.targetFile
				? await this.plugin.app.vault.read(this.targetFile).catch(() => '')
				: '';
		const userMemoDiff =
			prefs.recordMode === 'post-process'
				? extractUserMemoDiff(this.initialNoteContent, currentNoteContent)
				: '';

		const filename = `recording_${formatDateStampForFile(new Date())}.${recorded.extension}`;
		const precomputedSegments =
			prefs.recordMode === 'live-insert' ? getVoiceState().liveSegments : [];

		const succeeded = await this.runTranscriptionAndFormattingPipeline({
			blob: recorded.fullBlob,
			filename,
			templateId,
			userMemoDiff,
			precomputedSegments,
			existingAudioVaultPath: null,
		});

		if (succeeded) {
			await clearBackupSession();
			patchVoiceState({ hasRecoverableSession: false });
		} else if (await hasBackupSession()) {
			patchVoiceState({ hasRecoverableSession: true });
		}
	}

	/**
	 * 볼트에 이미 존재하는 오디오 파일을 스마트 노트로 변환합니다.
	 */
	async transcribeVaultFile(file: TFile): Promise<void> {
		if (!canUseFeature('voice-note') || this.isDestroyed) return;
		const prefs = getVoicePreferences(this.plugin.settings);

		// 현재 열려있는 마크다운 노트가 있으면 그곳에 삽입, 없으면 새 노트 생성
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		this.targetFile = view?.file && view.file.extension === 'md' ? view.file : null;
		this.targetEditor = view?.editor ?? null;
		this.liveInsertStart = null;
		this.liveInsertEnd = null;

		this.ensureOverlayMounted();
		this.abortController = new AbortController();

		try {
			const binary = await this.plugin.app.vault.readBinary(file);
			const blob = new Blob([binary], { type: mimeFromAudioExtension(file.extension) });
			const allowed = await this.checkFreeAudioDurationAllowed(blob);
			if (!allowed) return;

			await this.runTranscriptionAndFormattingPipeline({
				blob,
				filename: file.name,
				templateId: canUseProFeature('voice-note') ? prefs.defaultTemplate : 'verbatim',
				userMemoDiff: '',
				precomputedSegments: [],
				existingAudioVaultPath: file.path,
			});
		} catch (err: unknown) {
			this.handlePipelineError(err);
		}
	}

	/**
	 * 모바일 환경에서 로컬 Whisper 또는 유효하지 않은 STT 설정이 선택되었는지 사전 점검합니다.
	 */
	private preflightMobileStt(prefs: ReturnType<typeof getVoicePreferences>): boolean {
		if (!Platform.isMobile) return true;
		try {
			resolveSttEngine(this.plugin.app, this.plugin.settings.connections.providers, prefs);
			return true;
		} catch (err: unknown) {
			const msg = normalizeError(err).message;
			new Notice(msg);
			patchVoiceState({
				status: 'error',
				errorMessage: msg,
				audioLevel: 0,
			});
			return false;
		}
	}

	/**
	 * 시스템 파일 선택기를 열어 로컬 오디오 파일을 업로드·변환합니다.
	 */
	openAudioFilePicker(): void {
		if (!canUseFeature('voice-note') || this.isDestroyed || typeof document === 'undefined') return;

		const prefs = getVoicePreferences(this.plugin.settings);
		if (!this.preflightMobileStt(prefs)) {
			return;
		}

		const input = document.body.createEl('input', {
			cls: 'lumina-voice-file-input',
			attr: {
				type: 'file',
				accept: 'audio/*,.m4a,.mp3,.wav,.webm,.ogg',
			},
		});

		let fallbackTimerId: number | null = null;
		const cleanupPicker = () => {
			if (fallbackTimerId !== null && typeof window !== 'undefined') {
				window.clearTimeout(fallbackTimerId);
				fallbackTimerId = null;
			}
			if (typeof window !== 'undefined') {
				window.removeEventListener('focus', handleWindowFocus);
			}
			input.remove();
		};
		const handleWindowFocus = () => {
			if (typeof window === 'undefined') return;
			// cancel 이벤트를 지원하지 않는 구형 모바일 WebView 대비 300ms 후 미선택 <input> 정리
			fallbackTimerId = window.setTimeout(() => {
				fallbackTimerId = null;
				if (input.isConnected && (!input.files || input.files.length === 0)) {
					cleanupPicker();
				}
			}, 300);
		};

		input.addEventListener('cancel', cleanupPicker);
		if (typeof window !== 'undefined') {
			window.addEventListener('focus', handleWindowFocus, { once: true });
		}

		input.addEventListener('change', () => {
			const file = input.files?.[0];
			cleanupPicker();
			if (!file) return;

			void (async () => {
				const allowed = await this.checkFreeAudioDurationAllowed(file);
				if (!allowed) return;

				const latestPrefs = getVoicePreferences(this.plugin.settings);
				const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				this.targetFile = view?.file && view.file.extension === 'md' ? view.file : null;
				this.targetEditor = view?.editor ?? null;
				this.liveInsertStart = null;
				this.liveInsertEnd = null;

				this.ensureOverlayMounted();
				this.abortController = new AbortController();

				await this.runTranscriptionAndFormattingPipeline({
					blob: file,
					filename: file.name || `upload_${formatDateStampForFile(new Date())}.m4a`,
					templateId: canUseProFeature('voice-note') ? latestPrefs.defaultTemplate : 'verbatim',
					userMemoDiff: '',
					precomputedSegments: [],
					existingAudioVaultPath: null,
				});
			})();
		});

		input.click();
	}

	/**
	 * 비정상 종료로 남은 미완료 녹음 백업을 복구해 노트로 변환합니다.
	 */
	async recoverUnfinishedSession(): Promise<void> {
		if (!canUseFeature('voice-note') || this.isDestroyed) return;
		const backup = await loadBackupSession();
		if (!backup) {
			patchVoiceState({ hasRecoverableSession: false });
			this.unmountOverlayIfIdle();
			return;
		}

		const fullBlob = new Blob(backup.chunks, { type: backup.mimeType });
		const allowed = await this.checkFreeAudioDurationAllowed(fullBlob, backup.elapsedSec);
		if (!allowed) return;

		const ext = extensionForMimeType(backup.mimeType);
		const filename = `recovered_${formatDateStampForFile(new Date(backup.updatedAt))}.${ext}`;

		if (backup.targetFilePath) {
			const abs = this.plugin.app.vault.getAbstractFileByPath(backup.targetFilePath);
			this.targetFile = abs instanceof TFile ? abs : null;
		} else {
			this.targetFile = null;
		}
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		this.targetEditor =
			view && this.targetFile && view.file?.path === this.targetFile.path ? view.editor : null;
		this.liveInsertStart = null;
		this.liveInsertEnd = null;

		this.ensureOverlayMounted();
		this.abortController = new AbortController();

		const succeeded = await this.runTranscriptionAndFormattingPipeline({
			blob: fullBlob,
			filename,
			templateId: canUseProFeature('voice-note') ? backup.templateId : 'verbatim',
			userMemoDiff: '',
			precomputedSegments: [],
			existingAudioVaultPath: null,
		});

		if (succeeded) {
			await clearBackupSession();
			patchVoiceState({ hasRecoverableSession: false });
			new Notice(t('voiceNote.notices.recoveredSuccess'));
		}
	}

	/** 미완료 백업 세션 폐기 */
	async discardUnfinishedSession(): Promise<void> {
		await clearBackupSession();
		patchVoiceState({ hasRecoverableSession: false });
		this.unmountOverlayIfIdle();
	}

	/**
	 * 생성 직후 검토 바에서 다른 템플릿으로 즉시 재정리합니다 (오디오 재전송 없음).
	 */
	async reprocessWithTemplate(templateId: VoiceTemplateId): Promise<void> {
		const review = getVoiceState().reviewResult;
		if (!review || !canUseFeature('voice-note')) return;
		if (!canUseProFeature('voice-note')) {
			if (templateId !== 'verbatim') {
				notifyProFeatureLocked(this.plugin.app, 'voice-note', t('voiceNote.proTemplateNotice'));
				return;
			}
			await this.replaceWithRawTranscriptOnly();
			return;
		}

		const prefs = getVoicePreferences(this.plugin.settings);
		this.abortController = new AbortController();

		patchVoiceState({
			status: 'processing',
			templateId,
			progressStep: 2,
			progressDetail: t('voiceNote.progress.stepFormatting'),
		});

		try {
			const targetFile = review.targetFilePath
				? this.plugin.app.vault.getAbstractFileByPath(review.targetFilePath)
				: null;
			const resolvedFile = targetFile instanceof TFile ? targetFile : null;

			const output = await processTranscriptToNote({
				plugin: this.plugin,
				prefs,
				templateId,
				rawTranscript: review.rawTranscript,
				segments: review.segments,
				targetFile: resolvedFile,
				userMemoDiff: review.userMemoSnapshot,
				signal: this.abortController.signal,
				onStage: (step) => {
					patchVoiceState({
						progressStep: step,
						progressDetail:
							step === 2
								? t('voiceNote.progress.stepLinking')
								: t('voiceNote.progress.stepFormatting'),
					});
				},
			});

			const nextMarkdown = assembleVoiceNoteMarkdown({
				formattedBody: output.formattedBody,
				segments: review.segments,
				rawTranscript: review.rawTranscript,
				audioVaultPath: review.audioVaultPath,
				includeRawTranscript: prefs.includeRawTranscript,
			});

			const nextRange = await this.replaceInsertedOutput(review, nextMarkdown);
			patchVoiceState({
				status: 'review',
				templateId,
				reviewResult: {
					...review,
					templateId,
					formattedMarkdown: nextMarkdown,
					insertedRange: nextRange ?? review.insertedRange,
				},
			});
			new Notice(t('voiceNote.review.reformattedNotice'));
		} catch (err: unknown) {
			this.handlePipelineError(err);
		}
	}

	/**
	 * 현재 검토 결과를 최종 확정하고 후처리 바를 닫습니다.
	 */
	applyReview(): void {
		patchVoiceState({ status: 'idle', reviewResult: null });
		new Notice(t('voiceNote.review.appliedNotice'));
		this.unmountOverlayIfIdle();
	}

	/**
	 * AI 요약 없이 원본 전사 텍스트만 남기도록 교체합니다.
	 */
	async replaceWithRawTranscriptOnly(): Promise<void> {
		const review = getVoiceState().reviewResult;
		if (!review) return;
		const rawMarkdown = assembleVoiceNoteMarkdown({
			formattedBody: review.rawTranscript,
			segments: review.segments,
			rawTranscript: review.rawTranscript,
			audioVaultPath: review.audioVaultPath,
			includeRawTranscript: false,
		});

		const nextRange = await this.replaceInsertedOutput(review, rawMarkdown);
		patchVoiceState({
			status: 'review',
			templateId: 'verbatim',
			reviewResult: {
				...review,
				templateId: 'verbatim',
				formattedMarkdown: rawMarkdown,
				insertedRange: nextRange ?? review.insertedRange,
			},
		});
	}

	/**
	 * 방금 삽입·생성한 음성 노트 결과를 완전히 되돌립니다.
	 */
	async undoReview(): Promise<void> {
		const review = getVoiceState().reviewResult;
		if (!review) return;

		if (review.createdNewFile && review.targetFilePath) {
			const file = this.plugin.app.vault.getAbstractFileByPath(review.targetFilePath);
			if (file instanceof TFile) {
				await this.plugin.app.fileManager.trashFile(file);
			}
		} else if (review.insertedRange && this.targetEditor) {
			this.targetEditor.replaceRange('', review.insertedRange.from, review.insertedRange.to);
		} else if (review.targetFilePath) {
			const file = this.plugin.app.vault.getAbstractFileByPath(review.targetFilePath);
			if (file instanceof TFile) {
				const content = await this.plugin.app.vault.read(file);
				const updated = content.replace(review.formattedMarkdown, '').trimEnd();
				await this.plugin.app.vault.modify(file, updated);
			}
		}

		patchVoiceState({ status: 'idle', reviewResult: null });
		new Notice(t('voiceNote.review.undoneNotice'));
		this.unmountOverlayIfIdle();
	}

	/** 오류 배너 닫기 */
	dismissError(): void {
		patchVoiceState({ status: 'idle', errorMessage: null });
		this.unmountOverlayIfIdle();
	}

	/**
	 * 매니저의 모든 리소스(마이크, 네트워크 요청, 워커, DOM, 리스너)를 즉시 해제합니다.
	 */
	destroy(): void {
		this.isDestroyed = true;
		this.autoStoppingOnLimit = false;
		this.abortController?.abort();
		this.abortController = null;
		this.recorder?.cancel();
		this.recorder = null;
		this.activeSttEngine?.destroy?.();
		this.activeSttEngine = null;

		if (this.boundTimestampClickHandler && typeof document !== 'undefined') {
			document.removeEventListener('click', this.boundTimestampClickHandler, true);
			this.boundTimestampClickHandler = null;
		}

		this.unsubVoiceStore?.();
		this.unsubVoiceStore = null;

		if (this.layoutChangeRef) {
			this.plugin.app.workspace.offref?.(this.layoutChangeRef);
			this.layoutChangeRef = null;
		}

		for (const btn of this.injectedActionBtns) {
			btn.remove();
		}
		this.injectedActionBtns.clear();
		this.decoratedViews = new WeakSet<object>();

		this.unmountOverlay();
		resetVoiceStore();
	}

	// ─── Internal Helpers ──────────────────────────────────────────────────────

	private enqueueLiveChunkTranscription(wavBlob: Blob, offsetSec: number): void {
		const prefs = getVoicePreferences(this.plugin.settings);
		const signal = this.abortController?.signal;

		this.liveQueuePromise = this.liveQueuePromise
			.then(async () => {
				if (this.isDestroyed || signal?.aborted) return;
				const engine = this.getOrCreateSttEngine(prefs);
				const vocab = canUseProFeature('voice-note') ? prefs.customVocabulary : [];
				const promptHint = [this.targetFile?.basename, ...vocab]
					.filter(Boolean)
					.join(', ');
				const res = await engine.transcribe(wavBlob, `live_${Math.floor(offsetSec)}.wav`, {
					language: prefs.language,
					promptHint,
					offsetSec,
					signal,
				});
				if (!res.text.trim() || this.isDestroyed || signal?.aborted) return;

				if (res.segments.length > 0) {
					for (const seg of res.segments) {
						appendLiveSegment(seg);
					}
				} else {
					appendLiveSegment({
						startSec: offsetSec,
						endSec: offsetSec,
						text: res.text.trim(),
					});
				}

				if (prefs.recordMode === 'live-insert' && this.targetEditor && this.liveInsertEnd) {
					const prefix =
						this.liveInsertStart &&
						(this.liveInsertEnd.line !== this.liveInsertStart.line ||
							this.liveInsertEnd.ch !== this.liveInsertStart.ch)
							? ' '
							: '';
					const insertChunk = `${prefix}${res.text.trim()}`;
					const fromPos = { ...this.liveInsertEnd };
					this.targetEditor.replaceRange(insertChunk, fromPos);
					const lines = insertChunk.split('\n');
					if (lines.length === 1) {
						this.liveInsertEnd = {
							line: fromPos.line,
							ch: fromPos.ch + lines[0].length,
						};
					} else {
						this.liveInsertEnd = {
							line: fromPos.line + lines.length - 1,
							ch: lines[lines.length - 1].length,
						};
					}
					this.targetEditor.setCursor(this.liveInsertEnd);
				}
			})
			.catch((err: unknown) => {
				if ((err as { name?: string })?.name === 'AbortError') return;
				debugLogger.logWarn('voice', `Live chunk STT skipped: ${normalizeError(err).message}`);
			});
	}

	private getOrCreateSttEngine(prefs: ReturnType<typeof getVoicePreferences>): ISttEngine {
		const resolved = resolveSttEngine(this.plugin.app, this.plugin.settings.connections.providers, prefs);
		if (this.activeSttEngine && this.activeSttEngine.id === resolved.id) {
			return this.activeSttEngine;
		}
		this.activeSttEngine?.destroy?.();
		this.activeSttEngine = resolved;
		return resolved;
	}

	private async runTranscriptionAndFormattingPipeline(params: {
		blob: Blob;
		filename: string;
		templateId: VoiceTemplateId;
		userMemoDiff: string;
		precomputedSegments: TranscriptSegment[];
		existingAudioVaultPath: string | null;
	}): Promise<boolean> {
		const prefs = getVoicePreferences(this.plugin.settings);
		const signal = this.abortController?.signal;

		patchVoiceState({
			status: 'transcribing',
			audioLevel: 0,
			progressStep: 1,
			progressDetail: t('voiceNote.progress.stepTranscribing'),
		});

		try {
			let segments: TranscriptSegment[] = [...params.precomputedSegments];
			let rawTranscript = segments.map((s) => s.text).join(' ').trim();

			if (segments.length === 0) {
				if (params.blob.size === 0) {
					patchVoiceState({ status: 'idle' });
					new Notice(t('voiceNote.notices.noAudioRecorded'));
					this.unmountOverlayIfIdle();
					return true;
				}

				const engine = this.getOrCreateSttEngine(prefs);
				const chunks = await splitAudioBlobForApi(params.blob, params.filename);
				if (chunks.length === 0) {
					patchVoiceState({ status: 'idle' });
					new Notice(t('voiceNote.notices.noAudioRecorded'));
					this.unmountOverlayIfIdle();
					return true;
				}

				const isProVoice = canUseProFeature('voice-note');
				const vocab = isProVoice ? prefs.customVocabulary : [];
				const promptHint = [this.targetFile?.basename, ...vocab]
					.filter(Boolean)
					.join(', ');

				const allResults: SttTranscriptionResult[] = [];
				for (let i = 0; i < chunks.length; i++) {
					if (signal?.aborted || this.isDestroyed) return false;
					if (chunks.length > 1) {
						patchVoiceState({
							progressDetail: t('voiceNote.progress.chunkProgress', {
								current: i + 1,
								total: chunks.length,
							}),
						});
					}
					const chunk = chunks[i];
					const result = await engine.transcribe(chunk.blob, chunk.filename, {
						language: prefs.language,
						promptHint,
						offsetSec: chunk.offsetSec,
						signal,
						onProgress: (pct) => {
							patchVoiceState({
								progressDetail: t('voiceNote.progress.loadingLocalModel', {
									pct: Math.round(pct * 100),
								}),
							});
						},
					});
					allResults.push(result);
				}

				segments = allResults.flatMap((r) => r.segments);
				rawTranscript = allResults
					.map((r) => r.text.trim())
					.filter(Boolean)
					.join('\n')
					.trim();
			}

			if (!rawTranscript.trim()) {
				patchVoiceState({ status: 'idle' });
				new Notice(t('voiceNote.notices.noAudioRecorded'));
				this.unmountOverlayIfIdle();
				return true;
			}

			// 볼트에 오디오 파일 저장 (옵션 활성 시)
			let audioVaultPath: string | null = params.existingAudioVaultPath;
			if (!audioVaultPath && prefs.audioStorageMode === 'vault' && params.blob.size > 0) {
				audioVaultPath = await this.saveAudioToVault(params.blob, params.filename, prefs.audioFolder);
			}

			const isProVoice = canUseProFeature('voice-note');
			let finalMarkdown: string;
			let effectiveTemplateId: VoiceTemplateId = params.templateId;

			if (isProVoice) {
				patchVoiceState({
					status: 'processing',
					progressStep: 2,
					progressDetail: t('voiceNote.progress.stepLinking'),
				});

				const llmOutput = await processTranscriptToNote({
					plugin: this.plugin,
					prefs,
					templateId: params.templateId,
					rawTranscript,
					segments,
					targetFile: this.targetFile,
					userMemoDiff: params.userMemoDiff,
					signal,
					onStage: (step) => {
						patchVoiceState({
							progressStep: step,
							progressDetail:
								step === 2
									? t('voiceNote.progress.stepLinking')
									: t('voiceNote.progress.stepFormatting'),
						});
					},
				});

				if (!llmOutput.usedLlm) {
					new Notice(t('voiceNote.notices.noLlmAvailable'));
				}

				finalMarkdown = assembleVoiceNoteMarkdown({
					formattedBody: llmOutput.formattedBody,
					segments,
					rawTranscript,
					audioVaultPath,
					includeRawTranscript: prefs.includeRawTranscript,
				});
			} else {
				// 무료 모드: LLM 정리·자동 위키링크 없이 순수 STT 받아쓰기만 반영
				effectiveTemplateId = 'verbatim';
				finalMarkdown = assembleVoiceNoteMarkdown({
					formattedBody: rawTranscript.trim(),
					segments,
					rawTranscript,
					audioVaultPath,
					includeRawTranscript:
						Boolean(audioVaultPath) && prefs.includeRawTranscript && segments.length > 0,
				});
			}

			const writeResult = await this.writeResultToNote(finalMarkdown);

			const reviewResult: VoiceReviewResult = {
				targetFilePath: writeResult.targetFilePath,
				rawTranscript,
				segments,
				formattedMarkdown: finalMarkdown,
				audioVaultPath,
				templateId: effectiveTemplateId,
				userMemoSnapshot: params.userMemoDiff,
				insertedRange: writeResult.insertedRange,
				createdNewFile: writeResult.createdNewFile,
			};

			patchVoiceState({
				status: 'review',
				reviewResult,
				progressStep: 0,
				progressDetail: '',
			});
			return true;
		} catch (err: unknown) {
			this.handlePipelineError(err);
			return false;
		}
	}

	private async checkFreeAudioDurationAllowed(
		blob: Blob,
		knownDurationSec?: number,
	): Promise<boolean> {
		if (canUseProFeature('voice-note')) return true;

		const durationSec =
			knownDurationSec !== undefined && knownDurationSec > 0
				? knownDurationSec
				: await measureAudioBlobDurationSec(blob);

		if (durationSec !== null && durationSec > FREE_MAX_VOICE_DURATION_SEC) {
			patchVoiceState({ status: 'idle', progressStep: 0, progressDetail: '' });
			this.unmountOverlayIfIdle();
			notifyProFeatureLocked(this.plugin.app, 'voice-note', t('voiceNote.proFileTooLongNotice'));
			return false;
		}
		return true;
	}

	private async saveAudioToVault(
		blob: Blob,
		filename: string,
		folderSetting: string,
	): Promise<string> {
		const safeFolder = sanitizeFilePath(folderSetting || 'Attachments/Voice', false);
		const safeName = sanitizeFilename(filename) || `recording_${Date.now()}.webm`;
		let targetPath = normalizePath(safeFolder ? `${safeFolder}/${safeName}` : safeName);

		// 동일 파일명 충돌 방지
		if (this.plugin.app.vault.getAbstractFileByPath(targetPath)) {
			const dotIdx = safeName.lastIndexOf('.');
			const base = dotIdx > 0 ? safeName.slice(0, dotIdx) : safeName;
			const ext = dotIdx > 0 ? safeName.slice(dotIdx) : '';
			targetPath = normalizePath(
				safeFolder ? `${safeFolder}/${base}_${Date.now()}${ext}` : `${base}_${Date.now()}${ext}`,
			);
		}

		await ensureFolderExists(this.plugin.app, targetPath);
		const buffer = await blob.arrayBuffer();
		await this.plugin.app.vault.createBinary(targetPath, buffer);
		new Notice(t('voiceNote.notices.audioSaved', { path: targetPath }));
		return targetPath;
	}

	private async writeResultToNote(markdown: string): Promise<{
		targetFilePath: string | null;
		insertedRange?: VoiceReviewResult['insertedRange'];
		createdNewFile: boolean;
	}> {
		// 1. live-insert 모드에서 이미 에디터에 삽입된 구간이 있으면 해당 범위를 정리된 마크다운으로 교체
		if (this.targetEditor && this.liveInsertStart && this.liveInsertEnd) {
			const from = { ...this.liveInsertStart };
			this.targetEditor.replaceRange(markdown, from, this.liveInsertEnd);
			const to = this.computeEndPosition(from, markdown);
			this.liveInsertEnd = to;
			return {
				targetFilePath: this.targetFile?.path ?? null,
				insertedRange: { from, to },
				createdNewFile: false,
			};
		}

		// 2. 활성 에디터가 있으면 현재 커서 위치에 삽입
		if (this.targetEditor) {
			const from = this.targetEditor.getCursor();
			const prefix = from.ch > 0 ? '\n\n' : '';
			const textToInsert = `${prefix}${markdown}\n`;
			this.targetEditor.replaceRange(textToInsert, from);
			const to = this.computeEndPosition(from, textToInsert);
			return {
				targetFilePath: this.targetFile?.path ?? null,
				insertedRange: { from, to },
				createdNewFile: false,
			};
		}

		// 3. 대상 파일은 있지만 에디터 참조가 없으면 파일 끝에 추가
		if (this.targetFile) {
			const existing = await this.plugin.app.vault.read(this.targetFile);
			const separator = existing.trim() ? '\n\n' : '';
			await this.plugin.app.vault.modify(this.targetFile, `${existing}${separator}${markdown}\n`);
			return {
				targetFilePath: this.targetFile.path,
				createdNewFile: false,
			};
		}

		// 4. 열린 노트가 없으면 새 음성 노트 생성 후 열기
		const noteName = sanitizeFilename(`Voice Note ${formatDateStampForFile(new Date())}.md`);
		const notePath = normalizePath(noteName);
		const created = await this.plugin.app.vault.create(notePath, `${markdown}\n`);
		const leaf = this.plugin.app.workspace.getLeaf(false);
		await leaf?.openFile?.(created);
		new Notice(t('voiceNote.notices.createdNote', { path: created.path }));

		return {
			targetFilePath: created.path,
			createdNewFile: true,
		};
	}

	private async replaceInsertedOutput(
		review: VoiceReviewResult,
		nextMarkdown: string,
	): Promise<VoiceReviewResult['insertedRange'] | undefined> {
		if (review.insertedRange && this.targetEditor) {
			const from = review.insertedRange.from;
			this.targetEditor.replaceRange(nextMarkdown, from, review.insertedRange.to);
			return {
				from,
				to: this.computeEndPosition(from, nextMarkdown),
			};
		}

		if (review.targetFilePath) {
			const file = this.plugin.app.vault.getAbstractFileByPath(review.targetFilePath);
			if (file instanceof TFile) {
				const content = await this.plugin.app.vault.read(file);
				if (content.includes(review.formattedMarkdown)) {
					await this.plugin.app.vault.modify(
						file,
						content.replace(review.formattedMarkdown, nextMarkdown),
					);
				} else if (review.createdNewFile) {
					await this.plugin.app.vault.modify(file, `${nextMarkdown}\n`);
				}
			}
		}
		return undefined;
	}

	private computeEndPosition(from: VoiceEditorPosition, text: string): VoiceEditorPosition {
		const lines = text.split('\n');
		if (lines.length === 1) {
			return { line: from.line, ch: from.ch + lines[0].length };
		}
		return {
			line: from.line + lines.length - 1,
			ch: lines[lines.length - 1].length,
		};
	}

	private handlePipelineError(err: unknown): void {
		if ((err as { name?: string })?.name === 'AbortError') {
			patchVoiceState({ status: 'idle', progressStep: 0, progressDetail: '' });
			this.unmountOverlayIfIdle();
			return;
		}
		const normalized = normalizeError(err, String(err));
		debugLogger.logError('voice', normalized);
		const msg = t('voiceNote.notices.transcribeFailed', { error: normalized.message });
		new Notice(msg, 6000);
		patchVoiceState({
			status: 'error',
			errorMessage: normalized.message,
			progressStep: 0,
			progressDetail: '',
		});
	}

	/**
	 * 노트 내 타임스탬프 링크(#lumina-ts=초) 클릭 시 임베드된 <audio> 요소를 찾아 해당 시점부터 재생합니다.
	 */
	private handleDocumentClickForTimestamp(ev: MouseEvent): void {
		if (!canUseFeature('voice-note')) return;
		const target = ev.target as HTMLElement | null;
		const link = target?.closest?.('a') as HTMLAnchorElement | null;
		if (!link) return;

		const href = link.getAttribute('href') || link.getAttribute('data-href') || '';
		const match = href.match(/#lumina-ts=(\d+)/);
		if (!match) return;

		const seekSec = parseInt(match[1], 10);
		if (Number.isNaN(seekSec)) return;

		const viewEl =
			link.closest('.markdown-reading-view, .markdown-source-view, .view-content') ??
			document;
		const audioEl = viewEl.querySelector<HTMLAudioElement>('audio');
		if (!audioEl) return;

		ev.preventDefault();
		ev.stopPropagation();

		try {
			audioEl.currentTime = seekSec;
			void audioEl.play();
		} catch {
			// 오디오 재생 불가 환경 무시
		}
	}

	private ensureOverlayMounted(): void {
		if (typeof document === 'undefined' || this.isDestroyed) return;
		if (!this.overlayContainerEl) {
			const root = document.body.createDiv({ cls: 'lumina-voice-overlay-root' });
			this.overlayContainerEl = root;

			this.pillHostEl = root.createDiv();
			this.reviewHostEl = root.createDiv();

			this.mountedPill = mount(VoiceRecorderPill, {
				target: this.pillHostEl,
				props: { manager: this },
			});
			this.mountedReview = mount(VoicePostActionBar, {
				target: this.reviewHostEl,
				props: { manager: this },
			});
		}
	}

	private unmountOverlayIfIdle(): void {
		const s = getVoiceState();
		if (s.status === 'idle' && !s.hasRecoverableSession) {
			this.unmountOverlay();
		}
	}

	private unmountOverlay(): void {
		if (this.mountedPill) {
			try {
				void unmount(this.mountedPill);
			} catch {
				// unmount 예외 무시
			}
			this.mountedPill = null;
		}
		if (this.mountedReview) {
			try {
				void unmount(this.mountedReview);
			} catch {
				// unmount 예외 무시
			}
			this.mountedReview = null;
		}
		if (this.overlayContainerEl) {
			this.overlayContainerEl.remove();
			this.overlayContainerEl = null;
		}
		this.pillHostEl = null;
		this.reviewHostEl = null;
	}
}
