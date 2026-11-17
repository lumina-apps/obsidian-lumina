import { normalizePath } from 'obsidian';
import type { ChatSettings } from '../../../core/settings/settings.types';
import type { ProjectConfig } from '../../../shared/types/project.types';

/** 히스토리 저장·탐색 시 전달하는 경로 옵션 */
export interface HistoryLocationOptions {
	/** 날짜 하위 폴더 템플릿 (빈 문자열이면 루트 평면 저장) */
	folderFormat: string;
	/** 재귀 스캔에서 제외할 하위 폴더 경로 목록 (vault 상대 경로) */
	excludeFolders: string[];
}

/** 활성 프로젝트와 설정을 반영해 계산된 히스토리 위치 */
export interface ResolvedHistoryLocation {
	/** 활성 프로젝트 기준 히스토리 루트 경로 */
	basePath: string;
	/** 날짜 폴더 포맷 및 제외 폴더 옵션 */
	options: HistoryLocationOptions;
}

function normalizeRelativeSegment(raw: string | undefined): string {
	if (!raw) return '';
	const cleaned = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	return cleaned ? normalizePath(cleaned) : '';
}

/**
 * 채팅 설정과 프로젝트 목록/활성 프로젝트를 바탕으로
 * 히스토리 루트 경로(basePath), 날짜 폴더 포맷, 제외할 타 프로젝트 폴더 목록을 계산합니다.
 */
export function resolveHistoryLocation(
	chat: Pick<ChatSettings, 'historyPath'> & Partial<Pick<ChatSettings, 'historyFolderFormat'>>,
	projects: readonly ProjectConfig[] | undefined,
	activeProject: ProjectConfig | undefined,
): ResolvedHistoryLocation {
	const rootPath = normalizeRelativeSegment(chat.historyPath) || 'chatHistory';
	const activeSub = normalizeRelativeSegment(activeProject?.historySubfolder);
	const basePath = activeSub ? normalizePath(`${rootPath}/${activeSub}`) : rootPath;

	const baseLower = basePath.toLowerCase();
	const excludeFolders: string[] = [];
	const seenLower = new Set<string>();

	for (const project of projects ?? []) {
		if (activeProject && project.id === activeProject.id) {
			continue;
		}
		const sub = normalizeRelativeSegment(project.historySubfolder);
		if (!sub) {
			continue;
		}
		const projectFolder = normalizePath(`${rootPath}/${sub}`);
		const projectLower = projectFolder.toLowerCase();

		// 현재 스코프의 하위 폴더이면서, 동일 폴더를 공유하는 경우가 아닐 때만 제외
		if (projectLower !== baseLower && projectLower.startsWith(`${baseLower}/`) && !seenLower.has(projectLower)) {
			seenLower.add(projectLower);
			excludeFolders.push(projectFolder);
		}
	}

	return {
		basePath,
		options: {
			folderFormat: chat.historyFolderFormat ?? '',
			excludeFolders,
		},
	};
}
