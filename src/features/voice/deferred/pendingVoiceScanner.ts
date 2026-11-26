/**
 * pendingVoiceScanner.ts
 *
 * 데스크톱 환경에서 볼트 내 마크다운 노트의 `lumina-voice:pending` 마커를 감지하고,
 * 동기화 중인 오디오 파일의 크기 안정화를 디바운스로 확인한 뒤 준비 상태를 알리는 감지기입니다.
 */

import { App, type EventRef, Platform, TAbstractFile, TFile, normalizePath } from 'obsidian';
import type { PendingVoiceItem } from '../../../shared/types/voice.types';
import {
	PENDING_VOICE_MARKER_PREFIX,
	type ParsedPendingVoiceMarker,
	parsePendingVoiceMarkers,
} from './pendingVoiceMarker';

const DEFAULT_SETTLE_DELAY_MS = 3000;
const DEFAULT_SCAN_BATCH_SIZE = 40;

/** PendingVoiceScanner 동작 옵션 */
export interface PendingVoiceScannerOptions {
	/** 오디오 동기화 완료(크기 안정화) 판정 대기 시간 (ms) */
	settleDelayMs?: number;
	/** 초기 전체 스캔 시 UI 블로킹 방지를 위한 배치 크기 */
	scanBatchSize?: number;
}

/**
 * 데스크톱 전용 동기화 대기 음성 노트 스캐너
 */
export class PendingVoiceScanner {
	private app: App;
	private onChange: (items: PendingVoiceItem[]) => void;
	private settleDelayMs: number;
	private scanBatchSize: number;

	private markersByNote = new Map<string, ParsedPendingVoiceMarker[]>();
	private audioSettleTimers = new Map<string, number>();
	private audioLastSeenSize = new Map<string, number>();
	private settledAudioPaths = new Set<string>();
	private eventRefs: EventRef[] = [];
	private isDestroyed = false;

	constructor(
		app: App,
		onChange: (items: PendingVoiceItem[]) => void,
		options: PendingVoiceScannerOptions = {},
	) {
		this.app = app;
		this.onChange = onChange;
		this.settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
		this.scanBatchSize = options.scanBatchSize ?? DEFAULT_SCAN_BATCH_SIZE;
	}

	/**
	 * 데스크톱 환경에서 볼트 이벤트 감시와 초기 스캔을 시작합니다.
	 * 모바일에서는 아무 동작도 수행하지 않습니다.
	 */
	async start(): Promise<void> {
		if (Platform.isMobile || this.isDestroyed) return;
		this.registerVaultListeners();
		await this.scanAllMarkdownFiles();
	}

	/**
	 * 현재 볼트 전체를 즉시 다시 스캔하고 최신 대기 항목 목록을 반환합니다.
	 */
	async refreshNow(): Promise<PendingVoiceItem[]> {
		if (Platform.isMobile || this.isDestroyed) {
			return [];
		}
		await this.scanAllMarkdownFiles();
		return this.getItems();
	}

	/**
	 * 현재 추적 중인 대기 음성 항목 목록을 정렬된 배열로 반환합니다.
	 */
	getItems(): PendingVoiceItem[] {
		const items: PendingVoiceItem[] = [];
		const sortedPaths = Array.from(this.markersByNote.keys()).sort();

		for (const notePath of sortedPaths) {
			const markers = this.markersByNote.get(notePath);
			if (!markers) continue;
			for (const marker of markers) {
				items.push({
					id: marker.id,
					notePath: marker.notePath,
					audioPath: marker.audioPath,
					templateId: marker.templateId,
					status: this.settledAudioPaths.has(marker.audioPath) ? 'ready' : 'waiting-audio',
				});
			}
		}

		return items;
	}

	/**
	 * 등록된 볼트 이벤트와 대기 타이머를 모두 정리합니다.
	 */
	destroy(): void {
		this.isDestroyed = true;

		for (const ref of this.eventRefs) {
			this.app.vault.offref?.(ref);
		}
		this.eventRefs = [];

		for (const timerId of this.audioSettleTimers.values()) {
			if (typeof window !== 'undefined') {
				window.clearTimeout(timerId);
			}
		}
		this.audioSettleTimers.clear();
		this.audioLastSeenSize.clear();
		this.settledAudioPaths.clear();
		this.markersByNote.clear();
	}

	// ─── Internal Helpers ──────────────────────────────────────────────────────

	private registerVaultListeners(): void {
		if (this.eventRefs.length > 0 || typeof this.app.vault.on !== 'function') return;

		this.eventRefs.push(
			this.app.vault.on('create', (file) => {
				void this.handleVaultFileCreatedOrModified(file, false);
			}),
		);
		this.eventRefs.push(
			this.app.vault.on('modify', (file) => {
				void this.handleVaultFileCreatedOrModified(file, false);
			}),
		);
		this.eventRefs.push(
			this.app.vault.on('delete', (file) => {
				this.handleVaultFileDeleted(file);
			}),
		);
		this.eventRefs.push(
			this.app.vault.on('rename', (file, oldPath) => {
				void this.handleVaultFileRenamed(file, oldPath);
			}),
		);
	}

	private async scanAllMarkdownFiles(): Promise<void> {
		if (this.isDestroyed) return;
		const mdFiles = this.app.vault.getMarkdownFiles?.() ?? [];
		const nextMap = new Map<string, ParsedPendingVoiceMarker[]>();

		for (let i = 0; i < mdFiles.length; i += this.scanBatchSize) {
			if (this.isDestroyed) return;
			const batch = mdFiles.slice(i, i + this.scanBatchSize);

			for (const file of batch) {
				if (this.isDestroyed) return;
				const content = await this.readNoteSafely(file);
				if (!content || !content.includes(PENDING_VOICE_MARKER_PREFIX)) continue;

				const markers = parsePendingVoiceMarkers(file.path, content);
				if (markers.length > 0) {
					nextMap.set(file.path, markers);
				}
			}

			if (i + this.scanBatchSize < mdFiles.length && typeof window !== 'undefined') {
				await new Promise<void>((resolve) => {
					window.setTimeout(resolve, 0);
				});
			}
		}

		if (this.isDestroyed) return;
		this.markersByNote = nextMap;
		this.reconcileAllTrackedAudio(true);
		this.emitChange();
	}

	private async readNoteSafely(file: TFile): Promise<string> {
		try {
			if (typeof this.app.vault.cachedRead === 'function') {
				return await this.app.vault.cachedRead(file);
			}
			return await this.app.vault.read(file);
		} catch {
			return '';
		}
	}

	private async handleVaultFileCreatedOrModified(
		abstractFile: TAbstractFile,
		isInitialScan: boolean,
	): Promise<void> {
		if (this.isDestroyed || !(abstractFile instanceof TFile)) return;

		if (abstractFile.extension.toLowerCase() === 'md') {
			const changed = await this.rescanSingleNote(abstractFile, isInitialScan);
			if (changed) {
				this.emitChange();
			}
			return;
		}

		const normalizedPath = normalizePath(abstractFile.path);
		if (this.isAudioPathReferenced(normalizedPath)) {
			// 오디오 파일이 생성/수정될 때마다 크기 안정화 타이머를 재시작해 부분 동기화 오탐 방지
			this.settledAudioPaths.delete(normalizedPath);
			this.scheduleAudioSettleCheck(normalizedPath, abstractFile);
			this.emitChange();
		}
	}

	private handleVaultFileDeleted(abstractFile: TAbstractFile): void {
		if (this.isDestroyed) return;
		const normalizedPath = normalizePath(abstractFile.path);

		if (this.markersByNote.delete(normalizedPath)) {
			this.pruneUnusedAudioTracking();
			this.emitChange();
			return;
		}

		if (this.isAudioPathReferenced(normalizedPath)) {
			this.clearAudioTimer(normalizedPath);
			this.audioLastSeenSize.delete(normalizedPath);
			this.settledAudioPaths.delete(normalizedPath);
			this.emitChange();
		}
	}

	private async handleVaultFileRenamed(
		abstractFile: TAbstractFile,
		oldPath: string,
	): Promise<void> {
		if (this.isDestroyed) return;
		const normalizedOld = normalizePath(oldPath);

		if (abstractFile instanceof TFile && abstractFile.extension.toLowerCase() === 'md') {
			this.markersByNote.delete(normalizedOld);
			await this.rescanSingleNote(abstractFile, false);
			this.pruneUnusedAudioTracking();
			this.emitChange();
			return;
		}

		const normalizedNew = normalizePath(abstractFile.path);
		let affected = false;
		if (this.isAudioPathReferenced(normalizedOld)) {
			this.clearAudioTimer(normalizedOld);
			this.audioLastSeenSize.delete(normalizedOld);
			this.settledAudioPaths.delete(normalizedOld);
			affected = true;
		}
		if (abstractFile instanceof TFile && this.isAudioPathReferenced(normalizedNew)) {
			this.settledAudioPaths.delete(normalizedNew);
			this.scheduleAudioSettleCheck(normalizedNew, abstractFile);
			affected = true;
		}
		if (affected) {
			this.emitChange();
		}
	}

	private async rescanSingleNote(file: TFile, isInitialScan: boolean): Promise<boolean> {
		const content = await this.readNoteSafely(file);
		if (this.isDestroyed) return false;

		const prev = this.markersByNote.get(file.path);
		const markers = parsePendingVoiceMarkers(file.path, content);

		if (markers.length === 0) {
			const deleted = this.markersByNote.delete(file.path);
			if (deleted) {
				this.pruneUnusedAudioTracking();
			}
			return deleted;
		}

		this.markersByNote.set(file.path, markers);
		for (const marker of markers) {
			this.evaluateAudioPath(marker.audioPath, isInitialScan);
		}
		this.pruneUnusedAudioTracking();

		if (!prev || prev.length !== markers.length) return true;
		return prev.some(
			(m, idx) =>
				m.id !== markers[idx].id ||
				m.audioPath !== markers[idx].audioPath ||
				m.templateId !== markers[idx].templateId,
		);
	}

	private reconcileAllTrackedAudio(isInitialScan: boolean): void {
		const referenced = this.collectReferencedAudioPaths();
		for (const audioPath of referenced) {
			this.evaluateAudioPath(audioPath, isInitialScan);
		}
		this.pruneUnusedAudioTracking();
	}

	private evaluateAudioPath(audioPath: string, isInitialScan: boolean): void {
		const file = this.app.vault.getAbstractFileByPath(audioPath);
		if (!(file instanceof TFile)) {
			this.clearAudioTimer(audioPath);
			this.audioLastSeenSize.delete(audioPath);
			this.settledAudioPaths.delete(audioPath);
			return;
		}

		const size = file.stat?.size;
		if (typeof size === 'number' && size <= 0) {
			this.settledAudioPaths.delete(audioPath);
			this.scheduleAudioSettleCheck(audioPath, file);
			return;
		}

		// 이미 이전 스캔에서 안정화 완료된 경로이고 크기가 변하지 않았으면 유지
		if (this.settledAudioPaths.has(audioPath)) {
			return;
		}

		// 초기 스캔 시 이미 충분한 시간 전에 동기화가 완료된 파일은 즉시 ready로 표시
		if (isInitialScan) {
			const mtime = file.stat?.mtime;
			const isAlreadySettled =
				typeof mtime !== 'number' || Date.now() - mtime >= this.settleDelayMs;
			if (isAlreadySettled) {
				this.clearAudioTimer(audioPath);
				if (typeof size === 'number') {
					this.audioLastSeenSize.set(audioPath, size);
				}
				this.settledAudioPaths.add(audioPath);
				return;
			}
		}

		this.scheduleAudioSettleCheck(audioPath, file);
	}

	private scheduleAudioSettleCheck(audioPath: string, file: TFile): void {
		if (this.isDestroyed || typeof window === 'undefined') return;

		this.clearAudioTimer(audioPath);
		const currentSize = file.stat?.size ?? -1;
		this.audioLastSeenSize.set(audioPath, currentSize);

		const timerId = window.setTimeout(() => {
			this.audioSettleTimers.delete(audioPath);
			if (this.isDestroyed) return;

			const latest = this.app.vault.getAbstractFileByPath(audioPath);
			if (!(latest instanceof TFile)) {
				this.settledAudioPaths.delete(audioPath);
				this.audioLastSeenSize.delete(audioPath);
				this.emitChange();
				return;
			}

			const latestSize = latest.stat?.size;
			const prevSize = this.audioLastSeenSize.get(audioPath);

			// 파일 크기가 0이거나 직전 확인 이후 계속 증가 중이면 다시 대기
			if (typeof latestSize === 'number' && latestSize <= 0) {
				this.scheduleAudioSettleCheck(audioPath, latest);
				return;
			}
			if (
				typeof latestSize === 'number' &&
				typeof prevSize === 'number' &&
				prevSize >= 0 &&
				latestSize !== prevSize
			) {
				this.scheduleAudioSettleCheck(audioPath, latest);
				return;
			}

			this.settledAudioPaths.add(audioPath);
			this.emitChange();
		}, this.settleDelayMs);

		this.audioSettleTimers.set(audioPath, timerId);
	}

	private clearAudioTimer(audioPath: string): void {
		const timerId = this.audioSettleTimers.get(audioPath);
		if (timerId !== undefined) {
			if (typeof window !== 'undefined') {
				window.clearTimeout(timerId);
			}
			this.audioSettleTimers.delete(audioPath);
		}
	}

	private collectReferencedAudioPaths(): Set<string> {
		const paths = new Set<string>();
		for (const markers of this.markersByNote.values()) {
			for (const marker of markers) {
				paths.add(marker.audioPath);
			}
		}
		return paths;
	}

	private isAudioPathReferenced(audioPath: string): boolean {
		for (const markers of this.markersByNote.values()) {
			if (markers.some((m) => m.audioPath === audioPath)) {
				return true;
			}
		}
		return false;
	}

	private pruneUnusedAudioTracking(): void {
		const referenced = this.collectReferencedAudioPaths();
		for (const audioPath of Array.from(this.audioSettleTimers.keys())) {
			if (!referenced.has(audioPath)) {
				this.clearAudioTimer(audioPath);
			}
		}
		for (const audioPath of Array.from(this.audioLastSeenSize.keys())) {
			if (!referenced.has(audioPath)) {
				this.audioLastSeenSize.delete(audioPath);
			}
		}
		for (const audioPath of Array.from(this.settledAudioPaths)) {
			if (!referenced.has(audioPath)) {
				this.settledAudioPaths.delete(audioPath);
			}
		}
	}

	private emitChange(): void {
		if (this.isDestroyed) return;
		this.onChange(this.getItems());
	}
}
