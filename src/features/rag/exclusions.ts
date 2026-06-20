/**
 * 인덱싱 제외/포함 경로 관리.
 */

/** 기본 제외 경로 프리픽스 */
export const DEFAULT_EXCLUDED_PATHS: readonly string[] = [
	'templates',
	'Templates',
	'_templates',
	'chatHistory',
	'backups',
];

/**
 * 파일 경로가 제외 대상인지 확인합니다.
 * @param filePath  볼트 내 상대 경로
 * @param userPaths 사용자 설정 제외 경로 목록
 */
export function isExcluded(filePath: string, userPaths: string[]): boolean {
	const allExclusions = [...DEFAULT_EXCLUDED_PATHS, ...userPaths];
	return allExclusions.some(ex => {
		const normalized = ex.trim();
		if (!normalized) return false;
		return filePath === normalized
			|| filePath.startsWith(normalized + '/')
			|| filePath.startsWith(normalized + '\\');
	});
}

/**
 * 파일 경로가 포함 대상인지 확인합니다. (White List)
 * @param filePath  볼트 내 상대 경로
 * @param includePaths 사용자 설정 포함 경로 목록
 * @returns includePaths가 비어있으면 항상 true, 아니면 매칭 시 true
 */
export function isIncluded(filePath: string, includePaths: string[]): boolean {
	if (!includePaths || includePaths.length === 0) {
		return true; // 설정이 없으면 전체 포함
	}

	return includePaths.some(inc => {
		const normalized = inc.trim();
		if (!normalized) return false;
		return filePath === normalized
			|| filePath.startsWith(normalized + '/')
			|| filePath.startsWith(normalized + '\\');
	});
}
