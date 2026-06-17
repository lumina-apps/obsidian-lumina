import { TAbstractFile, TFile, Workspace } from 'obsidian';

/**
 * 리프 선택 전략:
 * 1. 새 탭(newLeaf)이 요청되면 'tab' 리프
 * 2. 아니면 가장 최근 마크다운 리프를 찾고, 없으면 'tab' 리프
 */
function resolveTargetLeaf(workspace: Workspace, newLeaf: boolean) {
	if (newLeaf) {
		return workspace.getLeaf('tab');
	}

	const recentLeaf = workspace.getMostRecentLeaf();
	if (recentLeaf?.getViewState().type === 'markdown') {
		return recentLeaf;
	}

	const mdLeaves = workspace.getLeavesOfType('markdown');
	if (mdLeaves.length > 0) {
		return mdLeaves[0];
	}

	return workspace.getLeaf('tab');
}

/**
 * chunkText의 앞 30글자를 파일 내용에서 찾아 라인 번호를 반환합니다.
 */
async function findTextLine(
	vault: { read(file: TFile): Promise<string> },
	file: TFile,
	chunkText: string,
): Promise<number> {
	try {
		const content = await vault.read(file);
		const searchStr = chunkText.substring(0, 30);
		const index = content.indexOf(searchStr);
		if (index !== -1) {
			return content.substring(0, index).split('\n').length - 1;
		}
	} catch (err) {
		console.error('[Lumina] 스크롤 위치 탐색 실패', err);
	}
	return 0;
}

export interface OpenNoteFileParams {
	workspace: Workspace;
	vault: { read(file: TFile): Promise<string>; getAbstractFileByPath(path: string): TAbstractFile | null };
	path: string;
	newLeaf?: boolean;
	chunkText?: string;
}

/**
 * 노트 파일을 열고, 청크 텍스트 기반 스크롤 위치까지 이동합니다.
 */
export async function openNoteFile({
	workspace,
	vault,
	path,
	newLeaf = false,
	chunkText,
}: OpenNoteFileParams): Promise<void> {
	const abstractFile = vault.getAbstractFileByPath(path);

	if (!abstractFile) {
		workspace.openLinkText(path, '', newLeaf);
		return;
	}

	if (!(abstractFile instanceof TFile)) {
		workspace.openLinkText(path, '', newLeaf);
		return;
	}

	const targetLeaf = resolveTargetLeaf(workspace, newLeaf);

	let line = 0;
	if (chunkText && abstractFile.extension === 'md') {
		line = await findTextLine(vault, abstractFile, chunkText);
	}

	await targetLeaf.openFile(abstractFile, { eState: { line } });
}
