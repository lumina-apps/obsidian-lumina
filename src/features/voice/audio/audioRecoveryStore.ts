/**
 * audioRecoveryStore.ts
 *
 * 긴 녹음 도중 앱 강제 종료나 크래시가 발생해도 오디오가 유실되지 않도록
 * IndexedDB에 녹음 청크를 주기적으로 임시 백업하고 복구하는 저장소입니다.
 */

import { debugLogger } from '../../../shared/debugLogger';
import type { VoiceTemplateId } from '../../../shared/types/voice.types';

const DB_NAME = 'lumina-voice-recovery-v1';
const STORE_NAME = 'sessions';
const ACTIVE_SESSION_KEY = 'active';

/** IndexedDB에 저장되는 미완료 녹음 백업 레코드 */
export interface VoiceRecoveryRecord {
	id: string;
	chunks: Blob[];
	mimeType: string;
	elapsedSec: number;
	targetFilePath: string | null;
	templateId: VoiceTemplateId;
	updatedAt: number;
}

/** IndexedDB에 저장되는 내부 원시 레코드 (iOS WKWebView Blob 직렬화 오류 회피용 ArrayBuffer 저장) */
interface StoredVoiceRecoveryRecord {
	id: string;
	chunkBuffers?: ArrayBuffer[];
	chunks?: Blob[];
	mimeType: string;
	elapsedSec: number;
	targetFilePath: string | null;
	templateId: VoiceTemplateId;
	updatedAt: number;
}

function openRecoveryDb(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === 'undefined') {
		return Promise.resolve(null);
	}

	return new Promise((resolve) => {
		try {
			const req = indexedDB.open(DB_NAME, 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => {
				debugLogger.logWarn('voice', `Recovery DB open failed: ${req.error?.message ?? 'unknown'}`);
				resolve(null);
			};
		} catch (err) {
			debugLogger.logWarn('voice', `Recovery DB unavailable: ${String(err)}`);
			resolve(null);
		}
	});
}

/**
 * 진행 중인 녹음 청크 스냅샷을 백업합니다.
 */
export async function saveBackupSession(record: Omit<VoiceRecoveryRecord, 'id' | 'updatedAt'>): Promise<void> {
	if (record.chunks.length === 0) return;

	// iOS WKWebView에서 MediaRecorder Blob 직렬화 시 발생하는 DataCloneError 방지를 위해 ArrayBuffer로 변환
	let chunkBuffers: ArrayBuffer[];
	try {
		chunkBuffers = await Promise.all(record.chunks.map((c) => c.arrayBuffer()));
	} catch (err: unknown) {
		debugLogger.logWarn('voice', `Recovery chunk conversion failed: ${String(err)}`);
		return;
	}

	const db = await openRecoveryDb();
	if (!db) return;

	try {
		await new Promise<void>((resolve) => {
			try {
				const tx = db.transaction(STORE_NAME, 'readwrite');
				const store = tx.objectStore(STORE_NAME);
				const payload: StoredVoiceRecoveryRecord = {
					id: ACTIVE_SESSION_KEY,
					chunkBuffers,
					mimeType: record.mimeType,
					elapsedSec: record.elapsedSec,
					targetFilePath: record.targetFilePath,
					templateId: record.templateId,
					updatedAt: Date.now(),
				};
				store.put(payload);
				tx.oncomplete = () => resolve();
				tx.onerror = () => {
					debugLogger.logWarn('voice', `Recovery backup tx failed: ${tx.error?.message ?? 'unknown'}`);
					resolve();
				};
			} catch (err: unknown) {
				debugLogger.logWarn('voice', `Recovery backup put failed: ${String(err)}`);
				resolve();
			}
		});
	} finally {
		db.close();
	}
}

/**
 * 저장된 미완료 녹음 백업 세션을 조회합니다.
 */
export async function loadBackupSession(): Promise<VoiceRecoveryRecord | null> {
	const db = await openRecoveryDb();
	if (!db) return null;

	try {
		return await new Promise<VoiceRecoveryRecord | null>((resolve) => {
			try {
				const tx = db.transaction(STORE_NAME, 'readonly');
				const store = tx.objectStore(STORE_NAME);
				const req = store.get(ACTIVE_SESSION_KEY);
				req.onsuccess = () => {
					const data = req.result as StoredVoiceRecoveryRecord | undefined;
					if (!data) {
						resolve(null);
						return;
					}
					const mimeType = data.mimeType || 'audio/webm';
					let chunks: Blob[] = [];
					if (Array.isArray(data.chunkBuffers) && data.chunkBuffers.length > 0) {
						chunks = data.chunkBuffers.map((buf) => new Blob([buf], { type: mimeType }));
					} else if (Array.isArray(data.chunks) && data.chunks.length > 0) {
						chunks = data.chunks;
					}
					if (chunks.length === 0) {
						resolve(null);
						return;
					}
					resolve({
						id: data.id,
						chunks,
						mimeType,
						elapsedSec: data.elapsedSec,
						targetFilePath: data.targetFilePath,
						templateId: data.templateId,
						updatedAt: data.updatedAt,
					});
				};
				req.onerror = () => resolve(null);
			} catch (err: unknown) {
				debugLogger.logWarn('voice', `Recovery backup load failed: ${String(err)}`);
				resolve(null);
			}
		});
	} finally {
		db.close();
	}
}

/**
 * 복구 가능한 백업 세션이 있는지 확인합니다.
 */
export async function hasBackupSession(): Promise<boolean> {
	const rec = await loadBackupSession();
	return rec !== null;
}

/**
 * 저장된 녹음 백업 세션을 삭제합니다.
 */
export async function clearBackupSession(): Promise<void> {
	const db = await openRecoveryDb();
	if (!db) return;

	try {
		await new Promise<void>((resolve) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			store.delete(ACTIVE_SESSION_KEY);
			tx.oncomplete = () => resolve();
			tx.onerror = () => resolve();
		});
	} finally {
		db.close();
	}
}
