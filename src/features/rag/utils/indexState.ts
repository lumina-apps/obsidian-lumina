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

	public get indexedFileCount(): number {
		return Object.keys(this.fileMtimes).length;
	}
}
