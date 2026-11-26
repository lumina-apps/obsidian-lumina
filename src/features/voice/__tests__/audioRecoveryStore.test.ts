/**
 * audioRecoveryStore.test.ts
 *
 * IndexedDB 기반 미완료 녹음 백업 저장소(audioRecoveryStore)의
 * 저장/조회(ArrayBuffer 직렬화 및 레거시 chunks 호환)/존재 여부/삭제/에러 내성을 검증합니다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	clearBackupSession,
	hasBackupSession,
	loadBackupSession,
	saveBackupSession,
} from '../audio/audioRecoveryStore';

/** jsdom 테스트용 인메모리 IndexedDB 페이크 구현 */
function createFakeIndexedDb(options?: { failOpen?: boolean; failTx?: boolean }) {
	const stores = new Map<string, Map<string, unknown>>();

	const fakeDb = {
		objectStoreNames: {
			contains: (name: string) => stores.has(name),
		},
		createObjectStore: (name: string) => {
			if (!stores.has(name)) {
				stores.set(name, new Map());
			}
			return {};
		},
		transaction: (storeName: string) => {
			if (options?.failTx) {
				throw new Error('Transaction error');
			}
			const map = stores.get(storeName) ?? new Map<string, unknown>();
			stores.set(storeName, map);

			const tx: {
				oncomplete: (() => void) | null;
				onerror: (() => void) | null;
				error: Error | null;
				objectStore: () => {
					put: (val: { id: string }) => void;
					get: (key: string) => {
						result: unknown;
						onsuccess: (() => void) | null;
						onerror: (() => void) | null;
					};
					delete: (key: string) => void;
				};
			} = {
				oncomplete: null,
				onerror: null,
				error: null,
				objectStore: () => ({
					put: (val: { id: string }) => {
						map.set(val.id, val);
						queueMicrotask(() => tx.oncomplete?.());
					},
					get: (key: string) => {
						const req = {
							result: map.get(key) as unknown,
							onsuccess: null as (() => void) | null,
							onerror: null as (() => void) | null,
						};
						queueMicrotask(() => req.onsuccess?.());
						return req;
					},
					delete: (key: string) => {
						map.delete(key);
						queueMicrotask(() => tx.oncomplete?.());
					},
				}),
			};
			return tx;
		},
		close: () => {},
	};

	const factory = {
		open: () => {
			const req: {
				result: typeof fakeDb;
				error: Error | null;
				onupgradeneeded: (() => void) | null;
				onsuccess: (() => void) | null;
				onerror: (() => void) | null;
			} = {
				result: fakeDb,
				error: options?.failOpen ? new Error('Open failed') : null,
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
			};
			queueMicrotask(() => {
				if (options?.failOpen) {
					req.onerror?.();
				} else {
					req.onupgradeneeded?.();
					req.onsuccess?.();
				}
			});
			return req;
		},
	};

	return { factory, stores };
}

describe('audioRecoveryStore', () => {
	const origIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;

	beforeEach(() => {
		const { factory } = createFakeIndexedDb();
		Object.defineProperty(globalThis, 'indexedDB', {
			value: factory,
			configurable: true,
			writable: true,
		});
	});

	afterEach(() => {
		Object.defineProperty(globalThis, 'indexedDB', {
			value: origIndexedDb,
			configurable: true,
			writable: true,
		});
	});

	it('saveBackupSession은 Blob을 ArrayBuffer로 변환해 저장하고 loadBackupSession으로 복원한다', async () => {
		expect(await hasBackupSession()).toBe(false);
		expect(await loadBackupSession()).toBeNull();

		const chunk1 = new Blob([new Uint8Array([10, 20, 30])], { type: 'audio/webm' });
		const chunk2 = new Blob([new Uint8Array([40, 50])], { type: 'audio/webm' });

		await saveBackupSession({
			chunks: [chunk1, chunk2],
			mimeType: 'audio/webm;codecs=opus',
			elapsedSec: 42,
			targetFilePath: 'Notes/meeting.md',
			templateId: 'meeting',
		});

		expect(await hasBackupSession()).toBe(true);

		const loaded = await loadBackupSession();
		expect(loaded).not.toBeNull();
		expect(loaded?.elapsedSec).toBe(42);
		expect(loaded?.targetFilePath).toBe('Notes/meeting.md');
		expect(loaded?.templateId).toBe('meeting');
		expect(loaded?.mimeType).toBe('audio/webm;codecs=opus');
		expect(loaded?.chunks).toHaveLength(2);
		expect(loaded?.chunks[0].size).toBe(3);
		expect(loaded?.chunks[1].size).toBe(2);

		await clearBackupSession();
		expect(await hasBackupSession()).toBe(false);
		expect(await loadBackupSession()).toBeNull();
	});

	it('빈 chunks 배열을 전달하면 저장하지 않고 무시한다', async () => {
		await saveBackupSession({
			chunks: [],
			mimeType: 'audio/webm',
			elapsedSec: 0,
			targetFilePath: null,
			templateId: 'clean',
		});

		expect(await hasBackupSession()).toBe(false);
	});

	it('구버전(legacy chunks 배열) 포맷 레코드도 호환하여 복원하고 빈 버퍼 레코드는 null을 반환한다', async () => {
		const { factory, stores } = createFakeIndexedDb();
		Object.defineProperty(globalThis, 'indexedDB', {
			value: factory,
			configurable: true,
			writable: true,
		});

		const sessionMap = new Map<string, unknown>();
		sessionMap.set('active', {
			id: 'active',
			chunks: [new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mp4' })],
			mimeType: 'audio/mp4',
			elapsedSec: 15,
			targetFilePath: null,
			templateId: 'clean',
			updatedAt: 1000,
		});
		stores.set('sessions', sessionMap);

		const loaded = await loadBackupSession();
		expect(loaded?.chunks).toHaveLength(1);
		expect(loaded?.chunks[0].size).toBe(4);
		expect(loaded?.mimeType).toBe('audio/mp4');

		// 빈 청크 레코드는 null 처리
		sessionMap.set('active', {
			id: 'active',
			chunkBuffers: [],
			mimeType: '',
			elapsedSec: 0,
			targetFilePath: null,
			templateId: 'clean',
			updatedAt: 2000,
		});
		expect(await loadBackupSession()).toBeNull();
	});

	it('indexedDB 미지원 환경이나 DB open/transaction 실패 시에도 예외 없이 안전하게 폴백한다', async () => {
		// 1) indexedDB === undefined
		Object.defineProperty(globalThis, 'indexedDB', {
			value: undefined,
			configurable: true,
			writable: true,
		});
		await expect(
			saveBackupSession({
				chunks: [new Blob(['a'])],
				mimeType: 'audio/webm',
				elapsedSec: 1,
				targetFilePath: null,
				templateId: 'clean',
			}),
		).resolves.toBeUndefined();
		expect(await loadBackupSession()).toBeNull();
		expect(await hasBackupSession()).toBe(false);
		await expect(clearBackupSession()).resolves.toBeUndefined();

		// 2) DB open 실패
		const failOpen = createFakeIndexedDb({ failOpen: true });
		Object.defineProperty(globalThis, 'indexedDB', {
			value: failOpen.factory,
			configurable: true,
			writable: true,
		});
		expect(await loadBackupSession()).toBeNull();
		expect(await hasBackupSession()).toBe(false);

		// 3) transaction 실패
		const failTx = createFakeIndexedDb({ failTx: true });
		Object.defineProperty(globalThis, 'indexedDB', {
			value: failTx.factory,
			configurable: true,
			writable: true,
		});
		await expect(
			saveBackupSession({
				chunks: [new Blob(['b'])],
				mimeType: 'audio/webm',
				elapsedSec: 2,
				targetFilePath: null,
				templateId: 'clean',
			}),
		).resolves.toBeUndefined();
		expect(await loadBackupSession()).toBeNull();
	});
});
