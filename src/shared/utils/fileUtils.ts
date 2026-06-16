import { TFile } from 'obsidian';

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