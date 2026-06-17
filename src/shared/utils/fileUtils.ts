import { TFile, normalizePath } from 'obsidian';

/**
 * Obsidian 마크다운 파일인지 확인합니다.
 * main.ts, history.ts, ChatAttachmentHandler.ts 등에서 중복 사용되던 로직 통합.
 */
export function isMarkdownFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === 'md';
}

/**
 * 파일명에서 확장자를 추출합니다 (소문자, 점 제외).
 * fileAttachmentUtils.ts, ChatAttachmentHandler.ts 등에서 중복 사용되던 로직 통합.
 */
export function getFileExtension(fileName: string): string {
	return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * 파일명에서 Obsidian/OS에서 문제가 될 수 있는 특수문자를 '_'로 치환합니다.
 * 경로 구분자(/)는 보존합니다.
 * luminaMcpServer.ts에서 사용되던 로직을 공통 유틸로 추출.
 */
export function sanitizeFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * 경로가 .md 확장자로 끝나는지 확인하고, 없으면 추가합니다.
 * luminaMcpServer.ts에서 사용되던 로직을 공통 유틸로 추출.
 */
export function enforceMarkdownExt(path: string): string {
	const norm = normalizePath(path);
	if (!norm.toLowerCase().endsWith('.md')) {
		return norm + '.md';
	}
	return norm;
}

/**
 * 전체 경로 문자열에서 파일명 특수문자를 정제하고 .md 확장자를 보장합니다.
 * 경로 구분자(/) 전후의 마지막 세그먼트만 sanitizeFilename을 적용합니다.
 */
export function sanitizeFilePath(rawPath: string): string {
	const parts = rawPath.split('/');
	const sanitizedParts = parts.map((p, i) =>
		i === parts.length - 1 ? sanitizeFilename(p) : p
	);
	return enforceMarkdownExt(sanitizedParts.join('/'));
}

/**
 * 파일 경로에서 확장자를 제외한 파일명만 추출합니다.
 * 예: "folder/my note.md" → "my note"
 */
export function extractFileName(path: string): string {
	return path.replace(/\.md$/, '').split('/').pop() ?? '';
}
