/**
 * 인덱싱 대상 파일 필터링 유틸.
 * 지원 확장자, 포함/제외 경로 필터, 삭제된 파일 감지를 수행합니다.
 */

import { App, TFile } from 'obsidian';
import type { RagSettings } from '../../core/settings/settings.types';
import { SUPPORTED_EXTENSIONS } from './parsers/DocumentParserRouter';
import { isExcluded, isIncluded } from './exclusions';

/**
 * 지원 확장자 + 포함/제외 경로 필터를 적용해 인덱싱 대상 파일 목록을 반환합니다.
 */
export function getTargetFiles(
	app: App,
	settings: RagSettings,
	chatHistoryPath: string,
	includedPaths: string[],
	excludedPaths: string[],
): TFile[] {
	const configDir = app.vault.configDir;
	const finalExcludedPaths = [...excludedPaths];
	if (configDir && !finalExcludedPaths.includes(configDir)) {
		finalExcludedPaths.push(configDir);
	}
	if (chatHistoryPath && !finalExcludedPaths.includes(chatHistoryPath)) {
		finalExcludedPaths.push(chatHistoryPath);
	}

	const files = app.vault.getFiles().filter(f => {
		return SUPPORTED_EXTENSIONS.has(f.extension.toLowerCase());
	});

	const maxSizeBytes = settings.maxFileSizeMB > 0 ? settings.maxFileSizeMB * 1024 * 1024 : 0;

	return files.filter(f => {
		if (f.path.startsWith('.') || f.path.includes('/.')) return false;
		if (!isIncluded(f.path, includedPaths)) return false;
		if (isExcluded(f.path, finalExcludedPaths)) return false;
		if (maxSizeBytes > 0 && f.stat.size > maxSizeBytes) {
			return false;
		}
		return true;
	});
}

/**
 * 볼트에서 삭제되었으나 인덱스에 남아있는 파일 경로를 감지합니다.
 * 옵시디언 캐시 지연으로 인한 오탐지를 막기 위해 adapter.exists()로 확인합니다.
 */
export async function detectDeletedPaths(
	app: App,
	currentPaths: Set<string>,
	indexedPaths: string[],
): Promise<Set<string>> {
	const pathsToDelete = new Set<string>();

	for (const path of indexedPaths) {
		if (!currentPaths.has(path)) {
			const actuallyExists = await app.vault.adapter.exists(path);
			if (!actuallyExists) {
				pathsToDelete.add(path);
			}
		}
	}

	return pathsToDelete;
}
