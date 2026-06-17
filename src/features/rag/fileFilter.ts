/**
 * fileFilter.ts
 *
 * 인덱싱 대상 파일 필터링 유틸.
 *
 * - 지원 확장자 필터링
 * - 포함/제외 경로 기반 화이트리스트/블랙리스트 적용
 * - 삭제된 파일 감지 (볼트에서 제거되었지만 인덱스에 남아있는 파일)
 */

import { App, TFile } from 'obsidian';
import type { RagSettings } from '../../core/settings/settings.types';
import { SUPPORTED_EXTENSIONS } from './parsers/DocumentParserRouter';
import { isExcluded, isIncluded } from './exclusions';
import { debugLogger } from '../../shared/debugLogger';

/**
 * 인덱싱 대상 파일 목록을 반환합니다.
 * 지원 확장자 + 포함/제외 경로 필터를 적용합니다.
 */
export function getTargetFiles(
	app: App,
	settings: RagSettings,
): TFile[] {
	const { excludedPaths, includedPaths } = settings;
	const configDir = app.vault.configDir;
	const finalExcludedPaths = [...excludedPaths];
	if (configDir && !finalExcludedPaths.includes(configDir)) {
		finalExcludedPaths.push(configDir);
	}

	const files = app.vault.getFiles().filter(f => {
		return SUPPORTED_EXTENSIONS.has(f.extension.toLowerCase());
	});

	const maxSizeBytes = settings.maxFileSizeMB > 0 ? settings.maxFileSizeMB * 1024 * 1024 : 0;

	return files.filter(f => {
		if (!isIncluded(f.path, includedPaths)) return false;
		if (isExcluded(f.path, finalExcludedPaths)) return false;
		if (maxSizeBytes > 0 && f.stat.size > maxSizeBytes) {
			debugLogger.logSystem('rag', `대용량 파일 제외됨 (${(f.stat.size / (1024 * 1024)).toFixed(1)}MB > ${settings.maxFileSizeMB}MB): ${f.path}`);
			return false;
		}
		return true;
	});
}

/**
 * 삭제된 파일 경로 Set을 반환합니다.
 *
 * 볼트에서 제거되었지만 인덱스(fileMtimes)에 남아있는 파일을 감지합니다.
 * 옵시디언 캐시 로딩 지연으로 인한 false-positive를 방지하기 위해
 * `app.vault.adapter.exists()`로 실제 파일 존재 여부를 확인합니다.
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