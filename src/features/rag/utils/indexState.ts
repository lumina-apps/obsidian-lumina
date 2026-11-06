import type { ParentChunk, ChildChunk } from '../../../shared/types/rag.types';
import type { LoadResult } from '../indexPersistence';

export class IndexState {
	public parentChunks: ParentChunk[] = [];
	public childChunks: ChildChunk[] = [];
	public indexedPaths: Set<string> = new Set();
	public fileMtimes: Record<string, number> = {};
	public fileHashes: Record<string, number> = {};

	public clear(): void {
		this.parentChunks.length = 0;
		this.childChunks.length = 0;
		this.indexedPaths.clear();
		this.fileMtimes = {};
		this.fileHashes = {};
	}

	public loadFrom(loadResult: LoadResult): void {
		this.parentChunks.length = 0;
		this.parentChunks.push(...loadResult.chunks);
		
		this.childChunks.length = 0;
		this.childChunks.push(...loadResult.childChunks);
		
		this.indexedPaths = loadResult.indexedPaths;
		this.fileMtimes = loadResult.fileMtimes;
		this.fileHashes = loadResult.fileHashes;
	}

	public getRemovedChildChunks(paths: Set<string>): ChildChunk[] {
		return this.childChunks.filter(c => paths.has(c.path));
	}

	public removePaths(paths: Set<string>): void {
		for (let i = this.parentChunks.length - 1; i >= 0; i--) {
			if (paths.has(this.parentChunks[i].path)) {
				this.parentChunks.splice(i, 1);
			}
		}
		
		for (let i = this.childChunks.length - 1; i >= 0; i--) {
			if (paths.has(this.childChunks[i].path)) {
				this.childChunks.splice(i, 1);
			}
		}
		
		paths.forEach(p => {
			this.indexedPaths.delete(p);
			delete this.fileMtimes[p];
			delete this.fileHashes[p];
		});
	}

	/** 임베딩 벡터가 누락된 청크를 보유한 파일 경로 집합을 반환합니다 (자가 복구용). */
	public getPathsWithMissingEmbeddings(): Set<string> {
		const missingPaths = new Set<string>();
		const pathsWithValidChild = new Set<string>();

		for (const c of this.childChunks) {
			if (!c.embedding || c.embedding.length === 0) {
				missingPaths.add(c.path);
			} else {
				pathsWithValidChild.add(c.path);
			}
		}

		for (const p of this.parentChunks) {
			if (p.text && p.text.trim().length > 0 && !pathsWithValidChild.has(p.path)) {
				missingPaths.add(p.path);
			}
		}

		return missingPaths;
	}

	/** 지정된 경로들의 mtime/hash/indexedPaths 기록을 무효화하여 다음 증분 업데이트에서 재임베딩되도록 합니다. */
	public invalidatePathsForReembed(paths: Iterable<string>): void {
		for (const p of paths) {
			this.indexedPaths.delete(p);
			delete this.fileMtimes[p];
			delete this.fileHashes[p];
		}
	}

	public get indexedFileCount(): number {
		return Object.keys(this.fileMtimes).length;
	}
}
