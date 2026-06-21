import { App, TFile } from 'obsidian';
import { detectDeletedPaths } from '../fileFilter';

export interface IndexDiffResult {
	pathsToDelete: Set<string>;
	changedFiles: TFile[];
}

/**
 * 현재 타겟 파일들과 기존에 인덱싱된 파일들의 상태를 비교하여
 * 삭제할 파일 경로와 새로/변경되어 추가로 인덱싱할 파일들을 반환합니다.
 */
export async function calculateIndexDiff(
	app: App,
	currentFiles: TFile[],
	indexedFileMtimes: Record<string, number>
): Promise<IndexDiffResult> {
	const currentPaths = new Set(currentFiles.map(f => f.path));
	const indexedPathsArray = Object.keys(indexedFileMtimes);

	// 디스크에서 실제로 삭제된 파일 감지
	const pathsToDelete = await detectDeletedPaths(app, currentPaths, indexedPathsArray);

	// 설정 변경으로 인해 더 이상 인덱싱 대상이 아닌 파일 제거 (currentPaths에 없는 기존 인덱싱 파일)
	for (const indexedPath of indexedPathsArray) {
		if (!currentPaths.has(indexedPath)) {
			pathsToDelete.add(indexedPath);
		}
	}

	// mtime 기반 변경된 파일 감지 (새로 생성된 파일 포함)
	const changedFiles = currentFiles.filter(f => {
		const prevMtime = indexedFileMtimes[f.path];
		return prevMtime === undefined || f.stat.mtime !== prevMtime;
	});

	return {
		pathsToDelete,
		changedFiles,
	};
}
