interface NodeFS {
	promises: {
		readFile(path: string, encoding: string): Promise<string>;
		writeFile(path: string, data: string, encoding: string): Promise<void>;
		mkdir(path: string, options?: { recursive: boolean }): Promise<void>;
	};
}

interface NodePath {
	dirname(path: string): string;
}

import { debugLogger } from '../../../shared/debugLogger';

/** 디스크 캐시 파일의 각 항목 타입 */
type CacheEntry = [string, number[] | undefined, number];

export class EmbeddingCacheManager {
	// 텍스트 → 임베딩 메모리 캐시 (Worker 간 공유)
	private embedCache = new Map<string, number[]>();
	private readonly MAX_CACHE_ENTRIES = 100_000;

	// LRU 접근 기록
	private embedAccess = new Map<string, number>();
	private accessCounter = 1;

	private cacheFilePath: string | null = null;

	private saveInProgress = false;
	private pendingSave = false;
	private saveWaiters: Array<() => void> = [];

	public init(cacheDir: string, modelName: string): void {
		try {
			const safeName = modelName.replace(/[^a-zA-Z0-9._-]/g, '_');
			this.cacheFilePath = `${cacheDir.replace(/\\/g, '/')}/embed_cache_${safeName}.json`;
			void this.loadEmbedCache().catch((err: unknown) => {
				console.warn('[EmbeddingWorker] embed cache load failed:', err);
			});
		} catch {
			this.cacheFilePath = null;
		}
	}

	public get(key: string): number[] | undefined {
		const v = this.embedCache.get(key);
		if (!v) return undefined;
		this.embedAccess.set(key, this.accessCounter++);
		return v;
	}

	public set(key: string, embedding: number[]): void {
		try {
			this.embedCache.set(key, embedding);
			this.embedAccess.set(key, this.accessCounter++);
		} catch {
			// 맵 용량 초과 등으로 set 실패 시 무시 (LRU 정리가 이후 처리)
		}
	}

	public trimCacheIfNecessary(): void {
		if (this.embedCache.size > this.MAX_CACHE_ENTRIES) {
			const entries = Array.from(this.embedCache.keys()).map((k) => ({
				k,
				access: this.embedAccess.get(k) ?? 0,
			}));
			// 접근 순서가 낮은(오래된/적게 쓰인) 순으로 정렬
			entries.sort((a, b) => a.access - b.access);
			
			let toRemove = Math.floor(this.MAX_CACHE_ENTRIES / 2);
			for (let i = 0; i < toRemove && i < entries.length; i++) {
				const key = entries[i].k;
				this.embedCache.delete(key);
				this.embedAccess.delete(key);
			}
		}
	}

	/** 디스크에서 임베딩 캐시 로드 */
	private async loadEmbedCache(): Promise<void> {
		if (!this.cacheFilePath) return;
		let nodeFS: NodeFS;
		try {
			const win = window as unknown as Record<string, unknown>;
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian 데스크탑 환경의 Node.js require 사용
			const requireFn = (typeof win.require === 'function' ? win.require : require) as (id: string) => unknown;
			nodeFS = requireFn('fs') as NodeFS;
		} catch {
			return;
		}
		try {
			const data = await nodeFS.promises.readFile(this.cacheFilePath, 'utf-8');
			const parsed: unknown = JSON.parse(data);
			if (!Array.isArray(parsed)) return;
			for (const entry of parsed) {
				if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
				const key: string = entry[0];
				const rawEmbedding: unknown[] = entry[1];
				if (!rawEmbedding.every((v): v is number => typeof v === 'number')) continue;
				const embedding: number[] = rawEmbedding;
				this.embedCache.set(key, embedding);
				const accessVal: number = typeof entry[2] === 'number' ? entry[2] : this.accessCounter++;
				this.embedAccess.set(key, accessVal);
			}
			let max = 0;
			for (const v of this.embedAccess.values()) {
				if (v > max) max = v;
			}
			this.accessCounter = max + 1;
		} catch (e: unknown) {
			if ((e as { code?: string })?.code !== 'ENOENT') {
				debugLogger.logWarn('rag', `[EmbeddingWorker] loadEmbedCache failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}

	/** 디스크에 임베딩 캐시 저장 */
	private async saveEmbedCache(): Promise<void> {
		if (!this.cacheFilePath) return;
		let nodeFS: NodeFS;
		let nodePath: NodePath;
		try {
			const win = window as unknown as Record<string, unknown>;
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian 데스크탑 환경의 Node.js require 사용
			const requireFn = (typeof win.require === 'function' ? win.require : require) as (id: string) => unknown;
			nodeFS = requireFn('fs') as NodeFS;
			nodePath = requireFn('path') as NodePath;
		} catch {
			return;
		}
		try {
			const entries = Array.from(this.embedCache.keys()).map((k) => ({
				k,
				access: this.embedAccess.get(k) ?? 0,
			}));
			entries.sort((a, b) => b.access - a.access);
			const toSaveKeys = entries.slice(0, this.MAX_CACHE_ENTRIES).map((e) => e.k);
			const out: CacheEntry[] = [];
			for (const k of toSaveKeys) {
				out.push([k, this.embedCache.get(k), this.embedAccess.get(k) ?? 0]);
			}
			const dir = nodePath.dirname(this.cacheFilePath);
			await nodeFS.promises.mkdir(dir, { recursive: true });
			await nodeFS.promises.writeFile(this.cacheFilePath, JSON.stringify(out), 'utf-8');
		} catch (e: unknown) {
			debugLogger.logWarn('rag', `[EmbeddingWorker] saveEmbedCache failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** 메모리 캐시 → 디스크 영속화 */
	public async persistCache(): Promise<void> {
		if (!this.cacheFilePath) return;
		if (this.saveInProgress) {
			this.pendingSave = true;
			return new Promise<void>((resolve) => {
				this.saveWaiters.push(resolve);
			});
		}

		this.saveInProgress = true;
		try {
			await this.saveEmbedCache();
			while (this.pendingSave) {
				this.pendingSave = false;
				await this.saveEmbedCache();
			}
		} finally {
			this.saveInProgress = false;
			const waiters = this.saveWaiters.splice(0);
			for (const w of waiters) {
				try {
					w();
				} catch {
					// waiter 실행 실패는 무시
				}
			}
		}
	}
}
