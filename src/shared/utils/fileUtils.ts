import { TFile, normalizePath } from 'obsidian';

/** 마크다운 파일(.md)인지 확인 */
export function isMarkdownFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === 'md';
}

/** 파일명에서 확장자 추출 (소문자, 점 제외) */
export function getFileExtension(fileName: string): string {
	return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/** 파일명 특수문자를 '_'로 치환 (경로 구분자 /는 보존) */
export function sanitizeFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '_');
}

/** .md 확장자가 없으면 추가 */
export function enforceMarkdownExt(path: string): string {
	const norm = normalizePath(path);
	if (!norm.toLowerCase().endsWith('.md')) {
		return norm + '.md';
	}
	return norm;
}

/** 경로 전체 정제 (파일명 특수문자 치환 + .md 확장자 보장) */
export function sanitizeFilePath(rawPath: string): string {
	const parts = rawPath.split('/');
	const sanitizedParts = parts.map((p, i) =>
		i === parts.length - 1 ? sanitizeFilename(p) : p
	);
	return enforceMarkdownExt(sanitizedParts.join('/'));
}

/** 경로에서 .md를 제외한 파일명만 추출 */
export function extractFileName(path: string): string {
	return path.replace(/\.md$/, '').split('/').pop() ?? '';
}
