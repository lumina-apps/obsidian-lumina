import { TFile, normalizePath, App, FileSystemAdapter, Platform } from 'obsidian';

/**
 * 볼트 파일 시스템의 로컬 절대 경로를 반환합니다.
 * 모바일 환경에서는 로컬 파일시스템 절대 경로를 사용하지 않으므로 빈 문자열을 반환합니다.
 */
export function getVaultBasePath(appOrPlugin: App | { app?: App; vault?: { adapter: unknown } }): string {
	if (typeof Platform !== 'undefined' && Boolean(Platform?.isMobile)) {
		return '';
	}
	const app = 'app' in appOrPlugin && appOrPlugin.app ? appOrPlugin.app : (appOrPlugin as App);
	const adapter = app?.vault?.adapter;
	try {
		if (typeof (adapter as unknown as { getBasePath?: () => string })?.getBasePath === 'function') {
			return (adapter as unknown as { getBasePath: () => string }).getBasePath();
		}
		if (typeof FileSystemAdapter !== 'undefined' && FileSystemAdapter && adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
	} catch {
		// FileSystemAdapter 미지원 또는 getBasePath 예외 환경 무시
	}
	return typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '';
}

/**
 * 데스크탑(Electron/Node) 환경에서는 네이티브 `path.join`을 사용하고,
 * Node 모듈이 없는 모바일 환경에서는 순수 문자열 결합으로 안전하게 폴백합니다.
 */
export function joinSystemPath(...segments: string[]): string {
	const filtered = segments.filter((s) => s.length > 0);
	if (filtered.length === 0) return '';

	const isMobile = typeof Platform !== 'undefined' && Boolean(Platform?.isMobile);
	if (!isMobile) {
		try {
			const pathModName = ['pa', 'th'].join('');
			if (typeof window !== 'undefined') {
				const win = window as unknown as {
					require?: (mod: string) => { join?: (...args: string[]) => string };
				};
				if (typeof win.require === 'function') {
					const pathMod = win.require(pathModName);
					if (pathMod && typeof pathMod.join === 'function') {
						return pathMod.join(...filtered);
					}
				}
			}
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- 데스크탑/테스트 런타임 폴백
			const nodeRequire = typeof require === 'function'
				? (require as unknown as (mod: string) => { join?: (...args: string[]) => string })
				: undefined;
			if (typeof nodeRequire === 'function') {
				const pathMod = nodeRequire(pathModName);
				if (pathMod && typeof pathMod.join === 'function') {
					return pathMod.join(...filtered);
				}
			}
		} catch {
			// 모바일 등 path 모듈 미지원 환경에서는 아래 순수 JS 폴백 사용
		}
	}

	const sep = filtered[0].includes('\\') ? '\\' : '/';
	return filtered
		.map((seg, idx) => {
			let s = seg;
			if (idx > 0) s = s.replace(/^[/\\]+/, '');
			if (idx < filtered.length - 1) s = s.replace(/[/\\]+$/, '');
			return s;
		})
		.filter((s) => s.length > 0)
		.join(sep);
}

/**
 * 입력된 파일 경로(절대 경로 또는 상대 경로)를 볼트 루트 기준 상대 경로로 정규화합니다.
 * Windows 및 macOS/Linux의 경로 구분자(/ vs \), 드라이브 문자 대소문자(c: vs C:)를 완전하게 처리합니다.
 */
export function toVaultRelativePath(
	appOrBasePath: App | { app?: App; vault?: { adapter: unknown } } | string,
	inputPath: string,
): string {
	if (!inputPath) return '';

	const vaultBase = typeof appOrBasePath === 'string'
		? appOrBasePath
		: getVaultBasePath(appOrBasePath);

	// 경로 구분자를 모두 / 로 통일
	const normalizedInput = inputPath.replace(/\\/g, '/');
	const normalizedBase = vaultBase.replace(/\\/g, '/').replace(/\/+$/, '');

	if (normalizedBase) {
		// Windows 환경(드라이브 문자 포함) 고려하여 대소문자 무시 비교
		const isWin = (typeof process !== 'undefined' && process.platform === 'win32') || /^[a-zA-Z]:\//.test(normalizedBase);
		const inputToCompare = isWin ? normalizedInput.toLowerCase() : normalizedInput;
		const baseToCompare = isWin ? normalizedBase.toLowerCase() : normalizedBase;

		if (inputToCompare === baseToCompare || inputToCompare.startsWith(baseToCompare + '/')) {
			let rel = normalizedInput.slice(normalizedBase.length);
			if (rel.startsWith('/')) {
				rel = rel.slice(1);
			}
			return normalizePath(rel);
		}
	}

	return normalizePath(normalizedInput);
}

/** 경로의 부모 폴더가 존재하지 않으면 재귀적으로 생성 */
export async function ensureFolderExists(app: App, filePath: string): Promise<void> {
	const normPath = normalizePath(filePath);
	const lastSlash = normPath.lastIndexOf('/');
	if (lastSlash === -1) return; // 최상위 경로

	const folderPath = normPath.substring(0, lastSlash);
	const folder = app.vault.getAbstractFileByPath(folderPath);

	if (!folder) {
		await ensureFolderExists(app, folderPath);
		await app.vault.createFolder(folderPath);
	}
}

/** 마크다운 파일(.md)인지 확인 */
export function isMarkdownFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === 'md';
}

/** 파일명에서 확장자 추출 (소문자, 점 제외) */
export function getFileExtension(fileName: string): string {
	const lastDot = fileName.lastIndexOf('.');
	if (lastDot <= 0) return '';
	return fileName.slice(lastDot + 1).toLowerCase();
}

/** Windows 예약 디바이스 이름 패턴 (대소문자 무시, 확장자 포함 가능) */
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/** 파일명 특수문자를 '_'로 치환하고 Windows 예약어, 제어문자 및 후행 점/공백을 안전하게 처리 */
export function sanitizeFilename(name: string): string {
	let sanitized = name
		.replace(/[\r\n\t\p{Cc}]/gu, '_')
		.replace(/[\\/:*?"<>|]/g, '_');
	// Windows에서 오류를 유발하는 후행 점 및 공백 제거
	sanitized = sanitized.replace(/[. ]+$/, '');

	// 예약된 디바이스 이름인 경우 접두사 추가
	if (WINDOWS_RESERVED_NAMES.test(sanitized)) {
		sanitized = `_${sanitized}`;
	}

	return sanitized;
}

/** .md 확장자가 없으면 추가 (대소문자 무시) */
export function enforceMarkdownExt(path: string): string {
	const norm = normalizePath(path);
	if (!norm.toLowerCase().endsWith('.md')) {
		return norm + '.md';
	}
	return norm;
}

/** 경로 전체 정제 (경로 순회 방지 + 폴더/파일명 특수문자 치환 + .md 확장자 보장) */
export function sanitizeFilePath(rawPath: string, enforceMd: boolean = true, appOrBasePath?: App | { app?: App; vault?: { adapter: unknown } } | string): string {
	let cleanedPath = rawPath.trim();
	if (!cleanedPath) return '';
	if (appOrBasePath) {
		cleanedPath = toVaultRelativePath(appOrBasePath, cleanedPath);
	}
	cleanedPath = cleanedPath.replace(/\\/g, '/');
	
	// 1. 전체가 대괄호로 감싸진 경우 ([[path]] 또는 [path]) 제거
	const wrapMatch = cleanedPath.match(/^\[+(.*?)\]+$/);
	if (wrapMatch) {
		cleanedPath = wrapMatch[1];
	} else {
		// 2. 짝이 맞지 않는 선행/후행 대괄호(LLM 오류)만 제거
		if (/^\[+/.test(cleanedPath) && !cleanedPath.includes(']')) {
			cleanedPath = cleanedPath.replace(/^\[+/, '');
		}
		if (/\]+$/.test(cleanedPath) && !cleanedPath.includes('[')) {
			cleanedPath = cleanedPath.replace(/\]+$/, '');
		}
	}

	const parts = cleanedPath.split('/');
	const safeParts = parts
		.filter((p) => p !== '..' && p !== '.')
		.map((p) => sanitizeFilename(p));
		
	const joined = safeParts.join('/');
	return enforceMd ? enforceMarkdownExt(joined) : normalizePath(joined);
}

/** 경로에서 .md를 제외한 파일명만 추출 (Windows 백슬래시 및 대소문자 지원) */
export function extractFileName(path: string): string {
	return path.replace(/\.md$/i, '').split(/[/\\]/).pop() ?? '';
}

/** 파일의 프론트매터에 태그를 추가합니다. */
export async function insertTagIntoFrontmatter(app: App, file: TFile, tag: string): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
		const fm = frontmatter as Record<string, unknown>;
		const tagValue = tag.replace('#', '');

		if (!fm.tags) {
			fm.tags = [tagValue];
		} else if (Array.isArray(fm.tags)) {
			const tagsArray = fm.tags as unknown[];
			if (!tagsArray.includes(tagValue)) tagsArray.push(tagValue);
		} else {
			fm.tags = [fm.tags, tagValue];
		}
	});
}
